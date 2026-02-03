/**
 * dpth.io Vector Storage Adapter
 * 
 * Adds semantic search capabilities on top of any base adapter.
 * Uses cosine similarity for nearest-neighbor search.
 * 
 * Two implementations:
 * 1. MemoryVectorAdapter — in-memory, zero deps, good for prototyping
 * 2. (future) SqliteVecAdapter — persistent vectors via sqlite-vec
 * 
 * Usage:
 *   import { configure } from 'dpth/storage';
 *   import { MemoryVectorAdapter } from 'dpth/adapter-vector';
 *   configure({ adapter: new MemoryVectorAdapter() });
 */

import type { StorageAdapter, VectorAdapter, VectorResult, QueryFilter } from './storage.js';
import { MemoryAdapter } from './storage.js';

// ─── Memory Vector Adapter ───────────────────────────

interface VectorEntry {
  key: string;
  vector: number[];
  metadata: Record<string, unknown>;
}

/**
 * In-memory vector adapter with brute-force cosine similarity search.
 * Good for up to ~100K vectors. For larger scale, use SqliteVecAdapter.
 */
export class MemoryVectorAdapter extends MemoryAdapter implements VectorAdapter {
  private vectors = new Map<string, VectorEntry[]>(); // collection → entries
  
  private getVectorCollection(collection: string): VectorEntry[] {
    let col = this.vectors.get(collection);
    if (!col) {
      col = [];
      this.vectors.set(collection, col);
    }
    return col;
  }
  
  async putVector(
    collection: string,
    key: string,
    vector: number[],
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const col = this.getVectorCollection(collection);
    
    // Update existing or add new
    const existing = col.findIndex(e => e.key === key);
    const entry: VectorEntry = { key, vector, metadata: metadata || {} };
    
    if (existing >= 0) {
      col[existing] = entry;
    } else {
      col.push(entry);
    }
    
    // Also store metadata in the base KV store for query support
    await this.put(collection, key, { ...metadata, _hasVector: true });
  }
  
  async searchVector(
    collection: string,
    vector: number[],
    topK: number,
    minScore: number = 0
  ): Promise<VectorResult[]> {
    const col = this.getVectorCollection(collection);
    
    const scored: VectorResult[] = [];
    for (const entry of col) {
      const score = cosineSimilarity(vector, entry.vector);
      if (score >= minScore) {
        scored.push({ key: entry.key, score, metadata: entry.metadata });
      }
    }
    
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
  
  async dimensions(collection: string): Promise<number | undefined> {
    const col = this.vectors.get(collection);
    if (!col || col.length === 0) return undefined;
    return col[0].vector.length;
  }
  
  async clear(collection?: string): Promise<void> {
    await super.clear(collection);
    if (collection) {
      this.vectors.delete(collection);
    } else {
      this.vectors.clear();
    }
  }
}

// ─── Cosine Similarity ───────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dot = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Wrapper Adapter ─────────────────────────────────

/**
 * Wraps any base StorageAdapter and adds vector search on top.
 * Vectors stored in memory, base data stored via the underlying adapter.
 * 
 * Useful pattern: wrap a SQLiteAdapter to get persistence + vectors
 * 
 * @example
 * import { SQLiteAdapter } from 'dpth/adapter-sqlite';
 * import { VectorOverlay } from 'dpth/adapter-vector';
 * const adapter = new VectorOverlay(new SQLiteAdapter('./data.db'));
 */
export class VectorOverlay implements VectorAdapter {
  private vectors = new Map<string, VectorEntry[]>();
  
  constructor(private base: StorageAdapter) {}
  
  private getVectorCollection(collection: string): VectorEntry[] {
    let col = this.vectors.get(collection);
    if (!col) {
      col = [];
      this.vectors.set(collection, col);
    }
    return col;
  }
  
  // ── Vector operations ──
  
  async putVector(
    collection: string,
    key: string,
    vector: number[],
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const col = this.getVectorCollection(collection);
    const existing = col.findIndex(e => e.key === key);
    const entry: VectorEntry = { key, vector, metadata: metadata || {} };
    
    if (existing >= 0) {
      col[existing] = entry;
    } else {
      col.push(entry);
    }
    
    // Store metadata in base adapter
    await this.base.put(collection, key, { ...metadata, _hasVector: true });
  }
  
  async searchVector(
    collection: string,
    vector: number[],
    topK: number,
    minScore: number = 0
  ): Promise<VectorResult[]> {
    const col = this.getVectorCollection(collection);
    
    const scored: VectorResult[] = [];
    for (const entry of col) {
      const score = cosineSimilarity(vector, entry.vector);
      if (score >= minScore) {
        scored.push({ key: entry.key, score, metadata: entry.metadata });
      }
    }
    
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
  
  async dimensions(collection: string): Promise<number | undefined> {
    const col = this.vectors.get(collection);
    if (!col || col.length === 0) return undefined;
    return col[0].vector.length;
  }
  
  // ── Delegate base operations ──
  
  get(collection: string, key: string) { return this.base.get(collection, key); }
  put(collection: string, key: string, value: unknown) { return this.base.put(collection, key, value); }
  delete(collection: string, key: string) { return this.base.delete(collection, key); }
  has(collection: string, key: string) { return this.base.has(collection, key); }
  query(filter: QueryFilter) { return this.base.query(filter); }
  keys(collection: string) { return this.base.keys(collection); }
  count(collection: string) { return this.base.count(collection); }
  
  async clear(collection?: string): Promise<void> {
    await this.base.clear(collection);
    if (collection) {
      this.vectors.delete(collection);
    } else {
      this.vectors.clear();
    }
  }
  
  async close(): Promise<void> {
    this.vectors.clear();
    await this.base.close();
  }
}
