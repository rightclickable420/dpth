/**
 * dpth.io Content-Addressed Storage API
 * 
 * IPFS-style content addressing for immutable data chunks.
 * Data is identified by its hash (CID), making it:
 * - Verifiable: Anyone can check the hash matches the content
 * - Cacheable: Same content = same CID, cache forever
 * - Distributed: Chunks can be stored anywhere, retrieved by CID
 * 
 * POST /api/dpth/storage - Store a chunk, returns CID
 * GET /api/dpth/storage?cid=xxx - Retrieve a chunk by CID
 * GET /api/dpth/storage/stats - Storage statistics
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

// ─── CID Generation ──────────────────────────────────

/**
 * Generate a CID (Content Identifier) from data.
 * Uses SHA-256 with a multicodec prefix (simplified).
 * Real IPFS uses multihash + multicodec, we simplify for now.
 */
function generateCid(data: Buffer | string): string {
  const buffer = typeof data === 'string' ? Buffer.from(data) : data;
  const hash = createHash('sha256').update(buffer).digest('hex');
  // Prefix with 'baf' to indicate our CID format (like IPFS bafy...)
  return `baf${hash.slice(0, 56)}`;
}

/**
 * Verify a chunk matches its CID
 */
function verifyCid(cid: string, data: Buffer | string): boolean {
  const computed = generateCid(data);
  return computed === cid;
}

// ─── Storage ─────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR || 'data';
const CHUNKS_DIR = path.join(DATA_DIR, 'dpth', 'chunks');
const METADATA_FILE = path.join(DATA_DIR, 'dpth', 'storage-meta.json');

interface StorageMetadata {
  totalChunks: number;
  totalBytes: number;
  tierStats: {
    hot: { count: number; bytes: number };
    warm: { count: number; bytes: number };
    cold: { count: number; bytes: number };
  };
}

async function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

async function loadMetadata(): Promise<StorageMetadata> {
  try {
    const data = await fs.readFile(METADATA_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {
      totalChunks: 0,
      totalBytes: 0,
      tierStats: {
        hot: { count: 0, bytes: 0 },
        warm: { count: 0, bytes: 0 },
        cold: { count: 0, bytes: 0 },
      },
    };
  }
}

async function saveMetadata(meta: StorageMetadata): Promise<void> {
  await ensureDir(METADATA_FILE);
  await fs.writeFile(METADATA_FILE, JSON.stringify(meta, null, 2));
}

function getChunkPath(cid: string): string {
  // Shard by first 2 chars of hash for filesystem efficiency
  const shard = cid.slice(3, 5);
  return path.join(CHUNKS_DIR, shard, cid);
}

// ─── Handlers ────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const cid = searchParams.get('cid');
    
    // If no CID, return storage stats
    if (!cid) {
      const meta = await loadMetadata();
      
      // Scan chunks directory for actual count
      try {
        await ensureDir(CHUNKS_DIR + '/temp');
        const shards = await fs.readdir(CHUNKS_DIR);
        let actualCount = 0;
        let actualBytes = 0;
        
        for (const shard of shards) {
          if (shard === 'temp') continue;
          const shardPath = path.join(CHUNKS_DIR, shard);
          const stat = await fs.stat(shardPath);
          if (stat.isDirectory()) {
            const files = await fs.readdir(shardPath);
            actualCount += files.length;
            for (const file of files) {
              const fileStat = await fs.stat(path.join(shardPath, file));
              actualBytes += fileStat.size;
            }
          }
        }
        
        return NextResponse.json({
          stats: {
            totalChunks: actualCount,
            totalBytes: actualBytes,
            totalMb: Math.round(actualBytes / 1024 / 1024 * 100) / 100,
            tiers: meta.tierStats,
          },
        });
      } catch {
        return NextResponse.json({
          stats: meta,
        });
      }
    }
    
    // Retrieve chunk by CID
    const chunkPath = getChunkPath(cid);
    
    try {
      const data = await fs.readFile(chunkPath);
      
      // Verify integrity
      if (!verifyCid(cid, data)) {
        return NextResponse.json(
          { error: 'Chunk integrity check failed' },
          { status: 500 }
        );
      }
      
      // Determine content type from first bytes
      const isJson = data[0] === 0x7b; // '{'
      const contentType = isJson ? 'application/json' : 'application/octet-stream';
      
      return new NextResponse(data, {
        headers: {
          'Content-Type': contentType,
          'X-CID': cid,
          'Cache-Control': 'public, max-age=31536000, immutable', // Cache forever
        },
      });
      
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        return NextResponse.json({ error: 'Chunk not found' }, { status: 404 });
      }
      throw err;
    }
    
  } catch (error) {
    console.error('Failed to retrieve chunk:', error);
    return NextResponse.json({ error: 'Failed to retrieve chunk' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Get raw body
    const contentType = request.headers.get('content-type') || '';
    let data: Buffer;
    
    if (contentType.includes('application/json')) {
      const json = await request.json();
      data = Buffer.from(JSON.stringify(json));
    } else {
      const arrayBuffer = await request.arrayBuffer();
      data = Buffer.from(arrayBuffer);
    }
    
    // Generate CID
    const cid = generateCid(data);
    const chunkPath = getChunkPath(cid);
    
    // Check if chunk already exists
    try {
      await fs.access(chunkPath);
      // Already exists, return existing CID
      return NextResponse.json({
        cid,
        size: data.length,
        exists: true,
      });
    } catch {
      // Doesn't exist, continue to store
    }
    
    // Store chunk
    await ensureDir(chunkPath);
    await fs.writeFile(chunkPath, data);
    
    // Update metadata
    const meta = await loadMetadata();
    meta.totalChunks++;
    meta.totalBytes += data.length;
    meta.tierStats.hot.count++;
    meta.tierStats.hot.bytes += data.length;
    await saveMetadata(meta);
    
    return NextResponse.json({
      cid,
      size: data.length,
      exists: false,
    }, { status: 201 });
    
  } catch (error) {
    console.error('Failed to store chunk:', error);
    return NextResponse.json({ error: 'Failed to store chunk' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const cid = searchParams.get('cid');
    
    if (!cid) {
      return NextResponse.json({ error: 'Missing CID' }, { status: 400 });
    }
    
    const chunkPath = getChunkPath(cid);
    
    try {
      const stat = await fs.stat(chunkPath);
      await fs.unlink(chunkPath);
      
      // Update metadata
      const meta = await loadMetadata();
      meta.totalChunks--;
      meta.totalBytes -= stat.size;
      meta.tierStats.hot.count--;
      meta.tierStats.hot.bytes -= stat.size;
      await saveMetadata(meta);
      
      return NextResponse.json({ message: 'Chunk deleted', cid });
      
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        return NextResponse.json({ error: 'Chunk not found' }, { status: 404 });
      }
      throw err;
    }
    
  } catch (error) {
    console.error('Failed to delete chunk:', error);
    return NextResponse.json({ error: 'Failed to delete chunk' }, { status: 500 });
  }
}
