/**
 * dpth.io SQLite Storage Adapter
 * 
 * Persistent storage using SQLite via better-sqlite3.
 * Provides ACID transactions, SQL queries, and disk persistence.
 * 
 * Requires: npm install better-sqlite3
 * 
 * Usage:
 *   import { configure } from 'dpth/storage';
 *   import { SQLiteAdapter } from 'dpth/adapter-sqlite';
 *   configure({ adapter: new SQLiteAdapter('./dpth.db') });
 */

import type { StorageAdapter, QueryFilter } from './storage.js';

// Dynamic import to avoid hard dependency — no type import needed
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Database: any;

async function loadSqlite() {
  if (Database) return Database;
  try {
    // Dynamic import — only fails if better-sqlite3 not installed
    const mod = await (Function('return import("better-sqlite3")')() as Promise<any>);
    Database = mod.default || mod;
    return Database;
  } catch {
    throw new Error(
      'better-sqlite3 is required for SQLiteAdapter. Install it:\n' +
      '  npm install better-sqlite3\n' +
      '  npm install -D @types/better-sqlite3'
    );
  }
}

export interface SQLiteAdapterOptions {
  /** Path to database file (use ':memory:' for in-memory) */
  path: string;
  /** Enable WAL mode for better concurrent read performance (default: true) */
  wal?: boolean;
  /** Serialize values as JSON (default: true) */
  json?: boolean;
}

export class SQLiteAdapter implements StorageAdapter {
  private db: any;
  private ready: Promise<void>;
  private stmtCache = new Map<string, any>();
  private opts: Required<SQLiteAdapterOptions>;
  
  constructor(pathOrOpts: string | SQLiteAdapterOptions) {
    const opts = typeof pathOrOpts === 'string'
      ? { path: pathOrOpts, wal: true, json: true }
      : { wal: true, json: true, ...pathOrOpts };
    this.opts = opts as Required<SQLiteAdapterOptions>;
    
    this.ready = this.init();
  }
  
  private async init(): Promise<void> {
    const Sqlite = await loadSqlite();
    this.db = new Sqlite(this.opts.path);
    
    if (this.opts.wal) {
      this.db.pragma('journal_mode = WAL');
    }
    this.db.pragma('foreign_keys = ON');
    
    // Create the universal key-value table with collection support
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dpth_store (
        collection TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (collection, key)
      );
      CREATE INDEX IF NOT EXISTS idx_dpth_collection ON dpth_store(collection);
      CREATE INDEX IF NOT EXISTS idx_dpth_updated ON dpth_store(collection, updated_at);
    `);
  }
  
  private async ensureReady(): Promise<void> {
    await this.ready;
  }
  
  private stmt(sql: string): any {
    let s = this.stmtCache.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmtCache.set(sql, s);
    }
    return s;
  }
  
  private serialize(value: unknown): string {
    return this.opts.json ? JSON.stringify(value) : String(value);
  }
  
  private deserialize(raw: string): unknown {
    if (!this.opts.json) return raw;
    try {
      return JSON.parse(raw, (key, value) => {
        // Revive Date objects
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
          const d = new Date(value);
          if (!isNaN(d.getTime())) return d;
        }
        return value;
      });
    } catch {
      return raw;
    }
  }
  
  async get(collection: string, key: string): Promise<unknown | undefined> {
    await this.ensureReady();
    const row = this.stmt('SELECT value FROM dpth_store WHERE collection = ? AND key = ?')
      .get(collection, key) as { value: string } | undefined;
    return row ? this.deserialize(row.value) : undefined;
  }
  
  async put(collection: string, key: string, value: unknown): Promise<void> {
    await this.ensureReady();
    const serialized = this.serialize(value);
    this.stmt(`
      INSERT INTO dpth_store (collection, key, value, updated_at)
      VALUES (?, ?, ?, unixepoch())
      ON CONFLICT(collection, key)
      DO UPDATE SET value = excluded.value, updated_at = unixepoch()
    `).run(collection, key, serialized);
  }
  
  async delete(collection: string, key: string): Promise<boolean> {
    await this.ensureReady();
    const result = this.stmt('DELETE FROM dpth_store WHERE collection = ? AND key = ?')
      .run(collection, key);
    return result.changes > 0;
  }
  
  async has(collection: string, key: string): Promise<boolean> {
    await this.ensureReady();
    const row = this.stmt('SELECT 1 FROM dpth_store WHERE collection = ? AND key = ?')
      .get(collection, key);
    return !!row;
  }
  
  async query(filter: QueryFilter): Promise<unknown[]> {
    await this.ensureReady();
    // Get all items in collection, then filter in JS
    // (JSON values can't be efficiently queried in SQL without json_extract)
    const rows = this.stmt('SELECT value FROM dpth_store WHERE collection = ?')
      .all(filter.collection) as { value: string }[];
    
    let results = rows.map(r => this.deserialize(r.value));
    
    // Apply where filters
    if (filter.where) {
      for (const [field, value] of Object.entries(filter.where)) {
        results = results.filter(item => {
          const obj = item as Record<string, unknown>;
          return obj[field] === value;
        });
      }
    }
    
    // Apply comparison filters
    if (filter.compare) {
      for (const cmp of filter.compare) {
        results = results.filter(item => {
          const obj = item as Record<string, unknown>;
          const fieldVal = obj[cmp.field];
          switch (cmp.op) {
            case 'gt': return (fieldVal as number) > (cmp.value as number);
            case 'gte': return (fieldVal as number) >= (cmp.value as number);
            case 'lt': return (fieldVal as number) < (cmp.value as number);
            case 'lte': return (fieldVal as number) <= (cmp.value as number);
            case 'ne': return fieldVal !== cmp.value;
            case 'in': return (cmp.value as unknown[]).includes(fieldVal);
            case 'contains': return typeof fieldVal === 'string' && fieldVal.includes(cmp.value as string);
            default: return true;
          }
        });
      }
    }
    
    // Apply ordering
    if (filter.orderBy) {
      const { field, direction } = filter.orderBy;
      results.sort((a, b) => {
        const aVal = (a as Record<string, unknown>)[field];
        const bVal = (b as Record<string, unknown>)[field];
        if (aVal === bVal) return 0;
        const cmp = aVal! < bVal! ? -1 : 1;
        return direction === 'asc' ? cmp : -cmp;
      });
    }
    
    // Apply pagination
    if (filter.offset) results = results.slice(filter.offset);
    if (filter.limit) results = results.slice(0, filter.limit);
    
    return results;
  }
  
  async keys(collection: string): Promise<string[]> {
    await this.ensureReady();
    const rows = this.stmt('SELECT key FROM dpth_store WHERE collection = ?')
      .all(collection) as { key: string }[];
    return rows.map(r => r.key);
  }
  
  async count(collection: string): Promise<number> {
    await this.ensureReady();
    const row = this.stmt('SELECT COUNT(*) as cnt FROM dpth_store WHERE collection = ?')
      .get(collection) as { cnt: number };
    return row.cnt;
  }
  
  async clear(collection?: string): Promise<void> {
    await this.ensureReady();
    if (collection) {
      this.stmt('DELETE FROM dpth_store WHERE collection = ?').run(collection);
    } else {
      this.db.exec('DELETE FROM dpth_store');
    }
  }
  
  async close(): Promise<void> {
    await this.ensureReady();
    this.stmtCache.clear();
    this.db.close();
  }
  
  /**
   * Run a batch of operations in a transaction (SQLite-specific)
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.ensureReady();
    const tx = this.db.transaction(() => fn());
    return tx();
  }
  
  /**
   * Get database stats (SQLite-specific)
   */
  async stats(): Promise<{ collections: Record<string, number>; totalRows: number; fileSizeBytes: number }> {
    await this.ensureReady();
    const rows = this.stmt(
      'SELECT collection, COUNT(*) as cnt FROM dpth_store GROUP BY collection'
    ).all() as { collection: string; cnt: number }[];
    
    const collections: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      collections[row.collection] = row.cnt;
      total += row.cnt;
    }
    
    const pageCount = this.db.pragma('page_count', { simple: true }) as number;
    const pageSize = this.db.pragma('page_size', { simple: true }) as number;
    
    return {
      collections,
      totalRows: total,
      fileSizeBytes: pageCount * pageSize,
    };
  }
}
