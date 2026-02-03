/**
 * dpth.io Distributed Inference API
 * 
 * Routes inference requests to capable agents based on:
 * - Model availability
 * - Agent reputation
 * - Current load
 * - Latency requirements
 * 
 * POST /api/dpth/inference - Create inference request
 * GET /api/dpth/inference?id=xxx - Get request status/result
 * GET /api/dpth/inference/queue - Get queue stats
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fallbackInference, findFallbackProvider, getFallbackStatus } from '../../fallback';

// ─── Types ───────────────────────────────────────────

type RequestStatus = 'queued' | 'assigned' | 'processing' | 'completed' | 'failed' | 'timeout';
type RequestPriority = 'low' | 'normal' | 'high' | 'critical';

interface InferenceRequest {
  id: string;
  /** Model to use */
  modelId: string;
  /** Request type */
  type: 'completion' | 'embedding' | 'image';
  /** Input data */
  input: {
    /** Text prompt (for completion/embedding) */
    prompt?: string;
    /** Messages array (for chat completion) */
    messages?: Array<{ role: string; content: string }>;
    /** System prompt */
    system?: string;
    /** Image prompt (for image generation) */
    imagePrompt?: string;
  };
  /** Generation parameters */
  params?: {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    stop?: string[];
    stream?: boolean;
  };
  /** Request metadata */
  meta: {
    priority: RequestPriority;
    createdAt: string;
    deadline?: string;
    clientId?: string;
    /** Maximum time to wait for assignment (ms) */
    maxWaitMs?: number;
  };
  /** Assignment info */
  assignment?: {
    agentId: string;
    assignedAt: string;
    startedAt?: string;
  };
  /** Status */
  status: RequestStatus;
  /** Result (when completed) */
  result?: {
    completedAt: string;
    latencyMs: number;
    /** For completion requests */
    text?: string;
    tokensGenerated?: number;
    tokensPerSecond?: number;
    /** For embedding requests */
    embedding?: number[];
    /** For image requests */
    imageUrl?: string;
    /** If failed */
    error?: string;
  };
}

interface InferenceQueue {
  requests: InferenceRequest[];
  stats: {
    totalRequests: number;
    completed: number;
    failed: number;
    avgLatencyMs: number;
    avgTokensPerSecond: number;
  };
}

interface ModelProvider {
  agentId: string;
  status: 'online' | 'offline' | 'busy';
  reputation: number;
  stats: {
    requestsServed: number;
    avgLatencyMs: number;
    avgTokensPerSecond: number;
    errorRate: number;
  };
}

// ─── Constants ───────────────────────────────────────

/** Default request timeout (30 seconds) */
const DEFAULT_TIMEOUT_MS = 30 * 1000;

/** Maximum requests in queue */
const MAX_QUEUE_SIZE = 1000;

// ─── Storage ─────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR || 'data';
const INFERENCE_FILE = path.join(DATA_DIR, 'dpth', 'inference.json');
const MODELS_FILE = path.join(DATA_DIR, 'dpth', 'models.json');

async function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

async function loadQueue(): Promise<InferenceQueue> {
  try {
    const data = await fs.readFile(INFERENCE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {
      requests: [],
      stats: {
        totalRequests: 0,
        completed: 0,
        failed: 0,
        avgLatencyMs: 0,
        avgTokensPerSecond: 0,
      },
    };
  }
}

async function saveQueue(queue: InferenceQueue): Promise<void> {
  await ensureDir(INFERENCE_FILE);
  await fs.writeFile(INFERENCE_FILE, JSON.stringify(queue, null, 2));
}

async function getModelProviders(modelId: string): Promise<ModelProvider[]> {
  try {
    const data = await fs.readFile(MODELS_FILE, 'utf-8');
    const registry = JSON.parse(data);
    const model = registry.models?.[modelId];
    return model?.providers || [];
  } catch {
    return [];
  }
}

// ─── Helpers ─────────────────────────────────────────

/**
 * Select the best provider for a request
 * Scoring: reputation (40%) + availability (30%) + performance (30%)
 */
function selectProvider(
  providers: ModelProvider[],
  priority: RequestPriority
): ModelProvider | null {
  // Filter online providers
  const available = providers.filter(p => p.status === 'online');
  
  if (available.length === 0) return null;
  
  // Score each provider
  const scored = available.map(p => {
    // Reputation score (0-40 points)
    const reputationScore = (p.reputation / 100) * 40;
    
    // Performance score (0-30 points) - lower latency = better
    const latencyScore = p.stats.avgLatencyMs > 0
      ? Math.max(0, 30 - (p.stats.avgLatencyMs / 100))
      : 15; // Default for new providers
    
    // Reliability score (0-30 points) - lower error rate = better
    const reliabilityScore = (1 - p.stats.errorRate) * 30;
    
    // Priority boost for high-rep providers on critical requests
    const priorityBoost = priority === 'critical' && p.reputation > 80 ? 10 : 0;
    
    return {
      provider: p,
      score: reputationScore + latencyScore + reliabilityScore + priorityBoost,
    };
  });
  
  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);
  
  // For critical priority, always pick the best
  if (priority === 'critical') {
    return scored[0].provider;
  }
  
  // For others, add some randomness among top 3
  const topN = Math.min(3, scored.length);
  const randomIndex = Math.floor(Math.random() * topN);
  return scored[randomIndex].provider;
}

/**
 * Clean up old completed/failed requests (keep last 1000)
 */
function cleanupOldRequests(queue: InferenceQueue): void {
  const terminalStatuses: RequestStatus[] = ['completed', 'failed', 'timeout'];
  
  // Keep non-terminal requests + last 1000 terminal
  const terminal = queue.requests
    .filter(r => terminalStatuses.includes(r.status))
    .sort((a, b) => new Date(b.result?.completedAt || b.meta.createdAt).getTime() -
                    new Date(a.result?.completedAt || a.meta.createdAt).getTime())
    .slice(0, 1000);
  
  const active = queue.requests.filter(r => !terminalStatuses.includes(r.status));
  
  queue.requests = [...active, ...terminal];
}

/**
 * Timeout stale requests
 */
function timeoutStaleRequests(queue: InferenceQueue): number {
  const now = Date.now();
  let timedOut = 0;
  
  for (const req of queue.requests) {
    if (req.status === 'queued' || req.status === 'assigned') {
      const deadline = req.meta.deadline
        ? new Date(req.meta.deadline).getTime()
        : new Date(req.meta.createdAt).getTime() + (req.meta.maxWaitMs || DEFAULT_TIMEOUT_MS);
      
      if (now > deadline) {
        req.status = 'timeout';
        req.result = {
          completedAt: new Date().toISOString(),
          latencyMs: now - new Date(req.meta.createdAt).getTime(),
          error: 'Request timed out',
        };
        timedOut++;
      }
    }
    
    // Timeout processing requests that haven't completed (5 min max)
    if (req.status === 'processing' && req.assignment?.startedAt) {
      const processingTime = now - new Date(req.assignment.startedAt).getTime();
      if (processingTime > 5 * 60 * 1000) {
        req.status = 'timeout';
        req.result = {
          completedAt: new Date().toISOString(),
          latencyMs: processingTime,
          error: 'Processing timed out',
        };
        timedOut++;
      }
    }
  }
  
  return timedOut;
}

// ─── Handlers ────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const requestId = searchParams.get('id');
    const queueStats = searchParams.get('queue');
    const agentId = searchParams.get('agentId');
    
    const queue = await loadQueue();
    
    // Timeout stale requests
    const timedOut = timeoutStaleRequests(queue);
    if (timedOut > 0) {
      await saveQueue(queue);
    }
    
    // Return specific request
    if (requestId) {
      const req = queue.requests.find(r => r.id === requestId);
      if (!req) {
        return NextResponse.json({ error: 'Request not found' }, { status: 404 });
      }
      
      return NextResponse.json({
        id: req.id,
        modelId: req.modelId,
        type: req.type,
        status: req.status,
        createdAt: req.meta.createdAt,
        assignment: req.assignment ? {
          agentId: req.assignment.agentId,
          assignedAt: req.assignment.assignedAt,
        } : undefined,
        result: req.result,
      });
    }
    
    // Return requests available for an agent to claim
    if (agentId) {
      const available = queue.requests
        .filter(r => r.status === 'queued')
        .slice(0, 10)
        .map(r => ({
          id: r.id,
          modelId: r.modelId,
          type: r.type,
          priority: r.meta.priority,
          createdAt: r.meta.createdAt,
          inputSize: JSON.stringify(r.input).length,
        }));
      
      return NextResponse.json({
        available,
        count: available.length,
      });
    }
    
    // Return queue stats
    if (queueStats !== null) {
      const queued = queue.requests.filter(r => r.status === 'queued').length;
      const processing = queue.requests.filter(r => r.status === 'processing').length;
      
      return NextResponse.json({
        queue: {
          pending: queued,
          processing,
          total: queue.requests.length,
        },
        stats: queue.stats,
      });
    }
    
    // Default: return recent requests summary
    const recent = queue.requests
      .slice(-20)
      .map(r => ({
        id: r.id,
        modelId: r.modelId,
        status: r.status,
        createdAt: r.meta.createdAt,
      }));
    
    return NextResponse.json({
      recent,
      queueSize: queue.requests.filter(r => r.status === 'queued').length,
    });
    
  } catch (error) {
    console.error('Failed to get inference status:', error);
    return NextResponse.json({ error: 'Failed to get status' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const body = await request.json();
    
    const queue = await loadQueue();
    
    // ─── Create New Request ──────────────────────────
    if (!action || action === 'create') {
      const { modelId, type = 'completion', input, params, priority = 'normal', maxWaitMs } = body;
      
      if (!modelId || !input) {
        return NextResponse.json(
          { error: 'Missing modelId or input' },
          { status: 400 }
        );
      }
      
      // Check queue size
      const activeRequests = queue.requests.filter(
        r => !['completed', 'failed', 'timeout'].includes(r.status)
      ).length;
      
      if (activeRequests >= MAX_QUEUE_SIZE) {
        return NextResponse.json(
          { error: 'Queue is full, try again later' },
          { status: 503 }
        );
      }
      
      // Check if model has providers
      const providers = await getModelProviders(modelId);
      const onlineProviders = providers.filter(p => p.status === 'online');
      
      // No network providers → try centralized fallback
      if (onlineProviders.length === 0) {
        const fallback = findFallbackProvider(modelId);
        
        if (fallback) {
          try {
            // Execute fallback immediately (synchronous response)
            const result = await fallbackInference({
              modelId,
              messages: input.messages,
              prompt: input.prompt,
              system: input.system,
              maxTokens: params?.maxTokens,
              temperature: params?.temperature,
              topP: params?.topP,
            });
            
            // Record in queue for stats
            const now = new Date();
            const req: InferenceRequest = {
              id: randomUUID(),
              modelId,
              type,
              input,
              params,
              meta: {
                priority,
                createdAt: now.toISOString(),
                clientId: 'fallback',
              },
              status: 'completed',
              result: {
                completedAt: now.toISOString(),
                latencyMs: result.latencyMs,
                text: result.text,
                tokensGenerated: result.tokensGenerated,
                tokensPerSecond: result.tokensPerSecond,
              },
            };
            
            queue.requests.push(req);
            queue.stats.totalRequests++;
            queue.stats.completed++;
            cleanupOldRequests(queue);
            await saveQueue(queue);
            
            return NextResponse.json({
              id: req.id,
              status: 'completed',
              fallback: true,
              provider: result.provider,
              providerModel: result.providerModel,
              result: {
                text: result.text,
                tokensGenerated: result.tokensGenerated,
                tokensPerSecond: Math.round(result.tokensPerSecond * 10) / 10,
                latencyMs: result.latencyMs,
                cost: result.cost,
              },
            });
          } catch (fallbackError) {
            return NextResponse.json(
              { error: `Fallback failed: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown'}` },
              { status: 502 }
            );
          }
        }
        
        if (providers.length === 0) {
          return NextResponse.json(
            { error: `Model ${modelId} not found in registry and no fallback available` },
            { status: 404 }
          );
        }
      }
      
      // Create request for distributed processing
      const now = new Date();
      const req: InferenceRequest = {
        id: randomUUID(),
        modelId,
        type,
        input,
        params,
        meta: {
          priority,
          createdAt: now.toISOString(),
          maxWaitMs: maxWaitMs || DEFAULT_TIMEOUT_MS,
        },
        status: 'queued',
      };
      
      // Try immediate assignment if providers available
      if (onlineProviders.length > 0) {
        const selectedProvider = selectProvider(onlineProviders, priority);
        if (selectedProvider) {
          req.status = 'assigned';
          req.assignment = {
            agentId: selectedProvider.agentId,
            assignedAt: now.toISOString(),
          };
        }
      }
      
      queue.requests.push(req);
      queue.stats.totalRequests++;
      
      cleanupOldRequests(queue);
      await saveQueue(queue);
      
      return NextResponse.json({
        id: req.id,
        status: req.status,
        assignment: req.assignment ? {
          agentId: req.assignment.agentId,
        } : undefined,
        queuePosition: req.status === 'queued'
          ? queue.requests.filter(r => r.status === 'queued').findIndex(r => r.id === req.id) + 1
          : 0,
      }, { status: 201 });
    }
    
    // ─── Claim Request (by agent) ────────────────────
    if (action === 'claim') {
      const { requestId, agentId } = body;
      
      if (!requestId || !agentId) {
        return NextResponse.json(
          { error: 'Missing requestId or agentId' },
          { status: 400 }
        );
      }
      
      const req = queue.requests.find(r => r.id === requestId);
      if (!req) {
        return NextResponse.json({ error: 'Request not found' }, { status: 404 });
      }
      
      if (req.status !== 'queued' && req.status !== 'assigned') {
        return NextResponse.json(
          { error: `Request is ${req.status}, cannot claim` },
          { status: 400 }
        );
      }
      
      // Verify agent can serve this model
      const providers = await getModelProviders(req.modelId);
      const isProvider = providers.some(p => p.agentId === agentId);
      
      if (!isProvider) {
        return NextResponse.json(
          { error: 'Agent is not a registered provider for this model' },
          { status: 403 }
        );
      }
      
      req.status = 'processing';
      req.assignment = {
        agentId,
        assignedAt: req.assignment?.assignedAt || new Date().toISOString(),
        startedAt: new Date().toISOString(),
      };
      
      await saveQueue(queue);
      
      return NextResponse.json({
        message: 'Request claimed',
        request: {
          id: req.id,
          modelId: req.modelId,
          type: req.type,
          input: req.input,
          params: req.params,
        },
      });
    }
    
    // ─── Complete Request (by agent) ─────────────────
    if (action === 'complete') {
      const { requestId, agentId, result, error } = body;
      
      if (!requestId || !agentId) {
        return NextResponse.json(
          { error: 'Missing requestId or agentId' },
          { status: 400 }
        );
      }
      
      const req = queue.requests.find(r => r.id === requestId);
      if (!req) {
        return NextResponse.json({ error: 'Request not found' }, { status: 404 });
      }
      
      if (req.assignment?.agentId !== agentId) {
        return NextResponse.json(
          { error: 'Request not assigned to this agent' },
          { status: 403 }
        );
      }
      
      const now = new Date();
      const startedAt = req.assignment?.startedAt || req.meta.createdAt;
      const latencyMs = now.getTime() - new Date(startedAt).getTime();
      
      if (error) {
        req.status = 'failed';
        req.result = {
          completedAt: now.toISOString(),
          latencyMs,
          error,
        };
        queue.stats.failed++;
      } else {
        req.status = 'completed';
        req.result = {
          completedAt: now.toISOString(),
          latencyMs,
          ...result,
        };
        queue.stats.completed++;
        
        // Update rolling average stats
        const totalCompleted = queue.stats.completed;
        if (latencyMs > 0) {
          queue.stats.avgLatencyMs = (queue.stats.avgLatencyMs * (totalCompleted - 1) + latencyMs) / totalCompleted;
        }
        if (result?.tokensPerSecond) {
          queue.stats.avgTokensPerSecond = (queue.stats.avgTokensPerSecond * (totalCompleted - 1) + result.tokensPerSecond) / totalCompleted;
        }
      }
      
      await saveQueue(queue);
      
      return NextResponse.json({
        message: error ? 'Request failed' : 'Request completed',
        status: req.status,
        latencyMs,
      });
    }
    
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    
  } catch (error) {
    console.error('Failed to process inference request:', error);
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
}
