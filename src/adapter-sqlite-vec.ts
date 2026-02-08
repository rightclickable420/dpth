/**
 * dpth.io SQLite-Vec Storage Adapter
 * 
 * Persistent vector storage using sqlite-vec extension.
 * Provides native ANN search with disk persistence.
 * 
 * Requires: npm install better-sqlite3 sqlite-vec
 * 
 * Usage:
 *   import { SqliteVecAdapter } from 'dpth/adapter-sqlite-vec';
 *   const db = dpth({ adapter: new SqliteVecAdapter('./dpth.db') });
 */

import type { VectorAdapter, VectorResult, QueryFilter } from './storage.js';
import { SQLiteAdapter } from './adapter-sqlite.js';

// sqlite-vec module cache (shared across instances)
let sqliteVecModule: any = null;

// Track which database instances have loaded the extension
const loadedDatabases = new WeakSet();

async function loadSqliteVec(db: any): Promise<void> {
  // Skip if this specific database already has vec0 loaded
  if (loadedDatabases.has(db)) return;
  
  try {
    // Use dynamic import - works with ESM and most bundlers
    // sqlite-vec is a native module, so it needs to be external in bundler config
    if (!sqliteVecModule) {
      sqliteVecModule = await import('sqlite-vec');
    }
    // Load the extension into THIS database
    sqliteVecModule.load(db);
    loadedDatabases.add(db);
  } catch (err) {
    throw new Error(
      'sqlite-vec is required for SqliteVecAdapter. Install it:\n' +
      '  npm install sqlite-vec\n' +
      'If using a bundler (Next.js, webpack), add sqlite-vec to externals.\n' +
      `Original error: ${err}`
    );
  }
}

export interface SqliteVecAdapterOptions {
  /** Path to database file */
  path: string;
  /** Default vector dimensions (default: 384 for bge-small) */
  dimensions?: number;
}

export class SqliteVecAdapter extends SQLiteAdapter implements VectorAdapter {
  private vecReady: Promise<void>;
  private defaultDimensions: number;
  private vecTables = new Set<string>();
  
  constructor(opts: string | SqliteVecAdapterOptions) {
    const config = typeof opts === 'string' 
      ? { path: opts, dimensions: 384 }
      : { dimensions: 384, ...opts };
    
    super(config.path);
    this.defaultDimensions = config.dimensions!;
    this.vecReady = this.initVec();
  }
  
  private async initVec(): Promise<void> {
    // Wait for base SQLite to be ready
    await (this as any).ready;
    
    // Load sqlite-vec extension
    await loadSqliteVec((this as any).db);
    
    // Create metadata table for vector collections
    (this as any).db.exec(`
      CREATE TABLE IF NOT EXISTS dpth_vec_meta (
        collection TEXT PRIMARY KEY,
        dimensions INTEGER NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
    `);
  }
  
  private async ensureVecTable(collection: string): Promise<void> {
    await this.vecReady;
    
    if (this.vecTables.has(collection)) return;
    
    const db = (this as any).db;
    const tableName = `vec_${collection.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    
    // Check if virtual table exists
    const exists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
    ).get(tableName);
    
    if (!exists) {
      // Create vec0 virtual table
      db.exec(`
        CREATE VIRTUAL TABLE ${tableName} USING vec0(
          key TEXT PRIMARY KEY,
          embedding FLOAT[${this.defaultDimensions}]
        );
      `);
      
      // Create metadata table for this collection
      db.exec(`
        CREATE TABLE IF NOT EXISTS ${tableName}_meta (
          key TEXT PRIMARY KEY,
          metadata TEXT
        );
      `);
      
      // Register in meta
      db.prepare(`
        INSERT OR REPLACE INTO dpth_vec_meta (collection, dimensions, count)
        VALUES (?, ?, 0)
      `).run(collection, this.defaultDimensions);
    }
    
    this.vecTables.add(collection);
  }
  
  async putVector(
    collection: string,
    key: string,
    vector: number[],
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.ensureVecTable(collection);
    
    const db = (this as any).db;
    const tableName = `vec_${collection.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    
    // Validate dimensions
    if (vector.length !== this.defaultDimensions) {
      throw new Error(`Vector dimension mismatch: expected ${this.defaultDimensions}, got ${vector.length}`);
    }
    
    // Convert to Float32Array for sqlite-vec
    const vecBlob = new Float32Array(vector);
    
    // Upsert vector
    db.prepare(`
      INSERT OR REPLACE INTO ${tableName} (key, embedding)
      VALUES (?, ?)
    `).run(key, vecBlob);
    
    // Store metadata
    if (metadata) {
      db.prepare(`
        INSERT OR REPLACE INTO ${tableName}_meta (key, metadata)
        VALUES (?, ?)
      `).run(key, JSON.stringify(metadata));
    }
    
    // Update count
    db.prepare(`
      UPDATE dpth_vec_meta SET count = (
        SELECT COUNT(*) FROM ${tableName}
      ) WHERE collection = ?
    `).run(collection);
  }
  
  async searchVector(
    collection: string,
    vector: number[],
    topK: number,
    minScore: number = 0
  ): Promise<VectorResult[]> {
    await this.ensureVecTable(collection);
    
    const db = (this as any).db;
    const tableName = `vec_${collection.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    
    // Convert to Float32Array
    const vecBlob = new Float32Array(vector);
    
    // KNN search using sqlite-vec
    // Note: sqlite-vec returns distance (lower = closer), we want similarity (higher = better)
    const rows = db.prepare(`
      SELECT 
        v.key,
        v.distance,
        m.metadata
      FROM ${tableName} v
      LEFT JOIN ${tableName}_meta m ON v.key = m.key
      WHERE v.embedding MATCH ?
        AND k = ?
      ORDER BY v.distance
    `).all(vecBlob, topK);
    
    const results: VectorResult[] = [];
    
    for (const row of rows) {
      // Convert distance to similarity score (cosine distance to cosine similarity)
      // sqlite-vec uses L2 by default, but we can approximate
      const score = 1 / (1 + row.distance);
      
      if (score >= minScore) {
        results.push({
          key: row.key,
          score,
          metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        });
      }
    }
    
    return results;
  }
  
  async dimensions(collection: string): Promise<number | undefined> {
    await this.vecReady;
    
    const db = (this as any).db;
    const row = db.prepare(
      `SELECT dimensions FROM dpth_vec_meta WHERE collection = ?`
    ).get(collection);
    
    return row?.dimensions;
  }
  
  async deleteVector(collection: string, key: string): Promise<boolean> {
    await this.ensureVecTable(collection);
    
    const db = (this as any).db;
    const tableName = `vec_${collection.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    
    const result = db.prepare(`DELETE FROM ${tableName} WHERE key = ?`).run(key);
    db.prepare(`DELETE FROM ${tableName}_meta WHERE key = ?`).run(key);
    
    return result.changes > 0;
  }
  
  async clearVectors(collection?: string): Promise<void> {
    await this.vecReady;
    
    const db = (this as any).db;
    
    if (collection) {
      const tableName = `vec_${collection.replace(/[^a-zA-Z0-9_]/g, '_')}`;
      db.exec(`DROP TABLE IF EXISTS ${tableName}`);
      db.exec(`DROP TABLE IF EXISTS ${tableName}_meta`);
      db.prepare(`DELETE FROM dpth_vec_meta WHERE collection = ?`).run(collection);
      this.vecTables.delete(collection);
    } else {
      // Clear all vector tables
      const collections = db.prepare(`SELECT collection FROM dpth_vec_meta`).all();
      for (const { collection: col } of collections) {
        const tableName = `vec_${col.replace(/[^a-zA-Z0-9_]/g, '_')}`;
        db.exec(`DROP TABLE IF EXISTS ${tableName}`);
        db.exec(`DROP TABLE IF EXISTS ${tableName}_meta`);
      }
      db.exec(`DELETE FROM dpth_vec_meta`);
      this.vecTables.clear();
    }
  }
  
  async vectorStats(): Promise<{ collections: number; totalVectors: number }> {
    await this.vecReady;
    
    const db = (this as any).db;
    const row = db.prepare(`
      SELECT COUNT(*) as collections, COALESCE(SUM(count), 0) as totalVectors
      FROM dpth_vec_meta
    `).get();
    
    return {
      collections: row.collections,
      totalVectors: row.totalVectors,
    };
  }
}
