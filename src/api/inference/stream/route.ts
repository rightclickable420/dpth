/**
 * dpth.io Streaming Inference API
 * 
 * Provides Server-Sent Events (SSE) streaming for inference responses.
 * 
 * Flow:
 * 1. Client creates inference request (POST /api/dpth/inference)
 * 2. Client connects to SSE stream (GET /api/dpth/inference/stream?id=xxx)
 * 3. Agent pushes tokens (POST /api/dpth/inference/stream?action=push)
 * 4. Client receives tokens in real-time via SSE
 * 5. Agent signals completion (POST /api/dpth/inference/stream?action=done)
 * 
 * GET /api/dpth/inference/stream?id=xxx - SSE stream for a request
 * POST /api/dpth/inference/stream?action=push - Push tokens (agent)
 * POST /api/dpth/inference/stream?action=done - Signal completion (agent)
 */

import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs/promises';
import * as path from 'path';

// ─── Types ───────────────────────────────────────────

interface StreamChunk {
  index: number;
  text: string;
  timestamp: string;
}

interface StreamState {
  requestId: string;
  agentId: string;
  modelId: string;
  status: 'streaming' | 'completed' | 'error';
  chunks: StreamChunk[];
  /** Full accumulated text */
  fullText: string;
  /** Tokens generated so far */
  tokensGenerated: number;
  startedAt: string;
  completedAt?: string;
  error?: string;
  /** Stats */
  stats?: {
    tokensPerSecond: number;
    totalLatencyMs: number;
    firstTokenMs: number;
  };
}

interface StreamRegistry {
  streams: Record<string, StreamState>;
}

// ─── Storage ─────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR || 'data';
const STREAMS_FILE = path.join(DATA_DIR, 'dpth', 'streams.json');

async function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

async function loadStreams(): Promise<StreamRegistry> {
  try {
    const data = await fs.readFile(STREAMS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { streams: {} };
  }
}

async function saveStreams(registry: StreamRegistry): Promise<void> {
  await ensureDir(STREAMS_FILE);
  await fs.writeFile(STREAMS_FILE, JSON.stringify(registry, null, 2));
}

/**
 * Clean up old streams (keep last 100, remove completed > 5 min ago)
 */
function cleanupStreams(registry: StreamRegistry): void {
  const now = Date.now();
  const fiveMinAgo = now - 5 * 60 * 1000;
  
  const entries = Object.entries(registry.streams);
  
  // Remove old completed/error streams
  for (const [id, stream] of entries) {
    if (
      (stream.status === 'completed' || stream.status === 'error') &&
      stream.completedAt &&
      new Date(stream.completedAt).getTime() < fiveMinAgo
    ) {
      delete registry.streams[id];
    }
  }
  
  // If still too many, keep only the 100 most recent
  const remaining = Object.entries(registry.streams);
  if (remaining.length > 100) {
    remaining
      .sort((a, b) => new Date(a[1].startedAt).getTime() - new Date(b[1].startedAt).getTime())
      .slice(0, remaining.length - 100)
      .forEach(([id]) => delete registry.streams[id]);
  }
}

// ─── SSE Stream Handler ─────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const requestId = searchParams.get('id');
  
  if (!requestId) {
    return NextResponse.json({ error: 'Missing request id' }, { status: 400 });
  }
  
  // Create SSE stream
  const encoder = new TextEncoder();
  let closed = false;
  
  const stream = new ReadableStream({
    async start(controller) {
      // Send initial connection event
      controller.enqueue(
        encoder.encode(`event: connected\ndata: ${JSON.stringify({ requestId })}\n\n`)
      );
      
      let lastChunkIndex = -1;
      let pollCount = 0;
      const maxPollCount = 600; // 5 minutes at 500ms intervals
      
      const poll = async () => {
        if (closed) return;
        
        try {
          const registry = await loadStreams();
          const stream = registry.streams[requestId];
          
          if (!stream) {
            // Stream not yet created — waiting for agent to start
            pollCount++;
            if (pollCount > maxPollCount) {
              controller.enqueue(
                encoder.encode(`event: error\ndata: ${JSON.stringify({ error: 'Stream timeout' })}\n\n`)
              );
              controller.close();
              closed = true;
              return;
            }
            setTimeout(poll, 500);
            return;
          }
          
          // Send any new chunks
          const newChunks = stream.chunks.filter(c => c.index > lastChunkIndex);
          for (const chunk of newChunks) {
            controller.enqueue(
              encoder.encode(`event: token\ndata: ${JSON.stringify({
                index: chunk.index,
                text: chunk.text,
                tokensGenerated: stream.tokensGenerated,
              })}\n\n`)
            );
            lastChunkIndex = chunk.index;
          }
          
          // Check if stream is done
          if (stream.status === 'completed') {
            controller.enqueue(
              encoder.encode(`event: done\ndata: ${JSON.stringify({
                fullText: stream.fullText,
                tokensGenerated: stream.tokensGenerated,
                stats: stream.stats,
              })}\n\n`)
            );
            controller.close();
            closed = true;
            return;
          }
          
          if (stream.status === 'error') {
            controller.enqueue(
              encoder.encode(`event: error\ndata: ${JSON.stringify({
                error: stream.error || 'Unknown error',
              })}\n\n`)
            );
            controller.close();
            closed = true;
            return;
          }
          
          // Continue polling
          setTimeout(poll, 200); // 200ms poll interval for streaming
          
        } catch (error) {
          console.error('Stream poll error:', error);
          if (!closed) {
            controller.enqueue(
              encoder.encode(`event: error\ndata: ${JSON.stringify({ error: 'Internal error' })}\n\n`)
            );
            controller.close();
            closed = true;
          }
        }
      };
      
      // Start polling
      poll();
    },
    
    cancel() {
      closed = true;
    },
  });
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // For nginx
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const body = await request.json();
    
    const registry = await loadStreams();
    cleanupStreams(registry);
    
    // ─── Initialize Stream ───────────────────────────
    if (action === 'init') {
      const { requestId, agentId, modelId } = body;
      
      if (!requestId || !agentId || !modelId) {
        return NextResponse.json(
          { error: 'Missing requestId, agentId, or modelId' },
          { status: 400 }
        );
      }
      
      registry.streams[requestId] = {
        requestId,
        agentId,
        modelId,
        status: 'streaming',
        chunks: [],
        fullText: '',
        tokensGenerated: 0,
        startedAt: new Date().toISOString(),
      };
      
      await saveStreams(registry);
      
      return NextResponse.json({
        message: 'Stream initialized',
        requestId,
      }, { status: 201 });
    }
    
    // ─── Push Tokens ─────────────────────────────────
    if (action === 'push') {
      const { requestId, agentId, text, tokensInChunk = 1 } = body;
      
      if (!requestId || !agentId || !text) {
        return NextResponse.json(
          { error: 'Missing requestId, agentId, or text' },
          { status: 400 }
        );
      }
      
      const stream = registry.streams[requestId];
      if (!stream) {
        return NextResponse.json({ error: 'Stream not found' }, { status: 404 });
      }
      
      if (stream.agentId !== agentId) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
      }
      
      if (stream.status !== 'streaming') {
        return NextResponse.json(
          { error: `Stream is ${stream.status}` },
          { status: 400 }
        );
      }
      
      // Add chunk
      const chunk: StreamChunk = {
        index: stream.chunks.length,
        text,
        timestamp: new Date().toISOString(),
      };
      
      stream.chunks.push(chunk);
      stream.fullText += text;
      stream.tokensGenerated += tokensInChunk;
      
      // Calculate first token latency if this is the first chunk
      if (stream.chunks.length === 1) {
        const firstTokenMs = Date.now() - new Date(stream.startedAt).getTime();
        stream.stats = {
          tokensPerSecond: 0,
          totalLatencyMs: 0,
          firstTokenMs,
        };
      }
      
      await saveStreams(registry);
      
      return NextResponse.json({
        message: 'Token pushed',
        chunkIndex: chunk.index,
        tokensGenerated: stream.tokensGenerated,
      });
    }
    
    // ─── Complete Stream ─────────────────────────────
    if (action === 'done') {
      const { requestId, agentId, tokensGenerated } = body;
      
      if (!requestId || !agentId) {
        return NextResponse.json(
          { error: 'Missing requestId or agentId' },
          { status: 400 }
        );
      }
      
      const stream = registry.streams[requestId];
      if (!stream) {
        return NextResponse.json({ error: 'Stream not found' }, { status: 404 });
      }
      
      if (stream.agentId !== agentId) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
      }
      
      stream.status = 'completed';
      stream.completedAt = new Date().toISOString();
      
      if (tokensGenerated !== undefined) {
        stream.tokensGenerated = tokensGenerated;
      }
      
      // Calculate final stats
      const totalLatencyMs = Date.now() - new Date(stream.startedAt).getTime();
      const tokensPerSecond = stream.tokensGenerated / (totalLatencyMs / 1000);
      
      stream.stats = {
        ...stream.stats,
        tokensPerSecond: Math.round(tokensPerSecond * 10) / 10,
        totalLatencyMs,
        firstTokenMs: stream.stats?.firstTokenMs || totalLatencyMs,
      };
      
      await saveStreams(registry);
      
      return NextResponse.json({
        message: 'Stream completed',
        stats: stream.stats,
        fullText: stream.fullText,
      });
    }
    
    // ─── Error Stream ────────────────────────────────
    if (action === 'error') {
      const { requestId, agentId, error } = body;
      
      if (!requestId || !agentId) {
        return NextResponse.json(
          { error: 'Missing requestId or agentId' },
          { status: 400 }
        );
      }
      
      const stream = registry.streams[requestId];
      if (!stream) {
        return NextResponse.json({ error: 'Stream not found' }, { status: 404 });
      }
      
      stream.status = 'error';
      stream.completedAt = new Date().toISOString();
      stream.error = error || 'Unknown error';
      
      await saveStreams(registry);
      
      return NextResponse.json({
        message: 'Stream errored',
        error: stream.error,
      });
    }
    
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    
  } catch (error) {
    console.error('Failed to process stream action:', error);
    return NextResponse.json({ error: 'Failed to process' }, { status: 500 });
  }
}
