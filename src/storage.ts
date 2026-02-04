/**
 * dpth.io Storage Adapter System
 * 
 * Pluggable storage backends. dpth works in-memory by default,
 * add SQLite for persistence, add vectors for semantic search.
 * 
 * Usage:
 *   import { configure, MemoryAdapter } from 'dpth/storage';
 *   configure({ adapter: new MemoryAdapter() }); // default
 * 
 *   import { SQLiteAdapter } from 'dpth/storage';
 *   configure({ adapter: new SQLiteAdapter('./data.db') });
 */

// ─── Types ───────────────────────────────────────────

export interface QueryFilter {
  /** Collection/table to query */
  collection: string;
  /** Field equality filters */
  where?: Record<string, unknown>;
  /** Field comparison filters */
  compare?: Array<{
    field: string;
    op: 'gt' | 'gte' | 'lt' | 'lte' | 'ne' | 'in' | 'contains';
    value: unknown;
  }>;
  /** Sort by field */
  orderBy?: { field: string; direction: 'asc' | 'desc' };
  /** Limit results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

export interface StorageAdapter {
  /** Get a value by collection and key */
  get(collection: string, key: string): Promise<unknown | undefined>;
  
  /** Store a value by collection and key */
  put(collection: string, key: string, value: unknown): Promise<void>;
  
  /** Delete a value by collection and key */
  delete(collection: string, key: string): Promise<boolean>;
  
  /** Check if a key exists in a collection */
  has(collection: string, key: string): Promise<boolean>;
  
  /** Query a collection with filters */
  query(filter: QueryFilter): Promise<unknown[]>;
  
  /** Get all keys in a collection */
  keys(collection: string): Promise<string[]>;
  
  /** Get count of items in a collection */
  count(collection: string): Promise<number>;
  
  /** Clear a collection (or all collections if no name given) */
  clear(collection?: string): Promise<void>;
  
  /** Close the adapter (cleanup connections, flush writes) */
  close(): Promise<void>;
}

/** Vector search capabilities (extends base adapter) */
export interface VectorAdapter extends StorageAdapter {
  /** Store a vector with metadata */
  putVector(collection: string, key: string, vector: number[], metadata?: Record<string, unknown>): Promise<void>;
  
  /** Search by vector similarity */
  searchVector(collection: string, vector: number[], topK: number, minScore?: number): Promise<VectorResult[]>;
  
  /** Get vector dimensions for a collection */
  dimensions(collection: string): Promise<number | undefined>;
}

export interface VectorResult {
  key: string;
  score: number;
  metadata?: Record<string, unknown>;
}

// ─── Memory Adapter (default) ────────────────────────

export class MemoryAdapter implements StorageAdapter {
  private store = new Map<string, Map<string, unknown>>();
  
  private getCollection(name: string): Map<string, unknown> {
    let col = this.store.get(name);
    if (!col) {
      col = new Map();
      this.store.set(name, col);
    }
    return col;
  }
  
  async get(collection: string, key: string): Promise<unknown | undefined> {
    return this.getCollection(collection).get(key);
  }
  
  async put(collection: string, key: string, value: unknown): Promise<void> {
    this.getCollection(collection).set(key, value);
  }
  
  async delete(collection: string, key: string): Promise<boolean> {
    return this.getCollection(collection).delete(key);
  }
  
  async has(collection: string, key: string): Promise<boolean> {
    return this.getCollection(collection).has(key);
  }
  
  async query(filter: QueryFilter): Promise<unknown[]> {
    const col = this.getCollection(filter.collection);
    let results = Array.from(col.values());
    
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
    return Array.from(this.getCollection(collection).keys());
  }
  
  async count(collection: string): Promise<number> {
    return this.getCollection(collection).size;
  }
  
  async clear(collection?: string): Promise<void> {
    if (collection) {
      this.store.delete(collection);
    } else {
      this.store.clear();
    }
  }
  
  async close(): Promise<void> {
    // No-op for memory adapter
  }
}

// ─── Global Configuration ────────────────────────────

let globalAdapter: StorageAdapter = new MemoryAdapter();

/**
 * @deprecated Use dpth() factory instead:
 *   const db = dpth('./data.db'); // SQLite
 *   const db = dpth(); // in-memory
 * Global configure() will be removed in v1.0.
 */
export function configure(options: { adapter: StorageAdapter }): void {
  globalAdapter = options.adapter;
}

/**
 * Get the current storage adapter.
 * Used internally by dpth modules.
 */
export function getAdapter(): StorageAdapter {
  return globalAdapter;
}

/**
 * Reset to default memory adapter (mainly for testing)
 */
export function resetAdapter(): void {
  globalAdapter = new MemoryAdapter();
}
