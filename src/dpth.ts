/**
 * dpth.io — Unified Database API
 * 
 * The main entry point. One line to get a persistent, intelligent database
 * with entity resolution, temporal history, correlation detection, and
 * optional vector search.
 * 
 * Usage:
 *   import { dpth } from 'dpth/dpth';
 *   const db = await dpth('./myapp.db');
 *   
 *   // Entity resolution
 *   const john = db.entity.resolve('person', 'John Smith', 'stripe', 'cus_123');
 *   db.entity.resolve('person', 'jsmith', 'github', 'jsmith'); // auto-merged
 *   
 *   // Temporal history
 *   db.temporal.snapshot('dashboard', { revenue: 50000, users: 200 });
 *   db.temporal.history('dashboard'); // all snapshots over time
 *   
 *   // Correlation
 *   db.correlation.track('mrr', 50000);
 *   db.correlation.track('deploys', 12);
 *   db.correlation.find('mrr'); // what correlates with MRR?
 *   
 *   // Clean up
 *   await db.close();
 */

import type { StorageAdapter, VectorAdapter, VectorResult } from './storage.js';
import { MemoryAdapter } from './storage.js';
import { ValidationError, EntityNotFoundError, AdapterCapabilityError } from './errors.js';
import { generateEntityId, generateSnapshotId, randomHex } from './util.js';
import type {
  Entity,
  EntityId,
  EntityType,
  SourceId,
  TemporalValue,
  Metric,
  MetricPoint,
} from './types.js';

// ─── Types ───────────────────────────────────────────

export interface DpthOptions {
  /** Storage adapter (default: MemoryAdapter) */
  adapter?: StorageAdapter;
  /** Path to SQLite database (convenience — creates SQLiteAdapter) */
  path?: string;
}

/** Object-style options for entity.resolve() */
export interface ResolveOptions {
  /** Entity type (e.g. 'person', 'company', or any custom string) */
  type: EntityType;
  /** Display name */
  name: string;
  /** Source system identifier (e.g. 'stripe', 'github') */
  source: SourceId;
  /** External ID in the source system (e.g. 'cus_123') */
  externalId: string;
  /** Email for matching (strong signal) */
  email?: string;
  /** Alternative names / aliases */
  aliases?: string[];
  /** Additional attributes to store */
  attributes?: Record<string, unknown>;
  /** Minimum confidence for auto-merge (default: 0.7) */
  minConfidence?: number;
}

export interface ResolveResult {
  entity: Entity;
  isNew: boolean;
  confidence: number;
}

export interface SnapshotRecord<T = Record<string, unknown>> {
  id: string;
  key: string;
  timestamp: Date;
  data: T;
  source: string;
}

export interface DiffResult {
  added: string[];
  removed: string[];
  changed: Array<{ key: string; from: unknown; to: unknown }>;
}

export interface CorrelationHit {
  metricId: string;
  correlation: number;
  lagDays: number;
  direction: 'positive' | 'negative';
  sampleSize: number;
}

// ─── Dpth Class ──────────────────────────────────────

export class Dpth {
  private adapter: StorageAdapter;
  private _ready: Promise<void>;
  
  /** Entity resolution and management */
  public entity: EntityAPI;
  /** Temporal history and snapshots */
  public temporal: TemporalAPI;
  /** Correlation detection across metrics */
  public correlation: CorrelationAPI;
  /** Vector search (if adapter supports it) */
  public vector: VectorAPI;
  
  constructor(options: DpthOptions = {}) {
    this.adapter = options.adapter || new MemoryAdapter();
    
    this.entity = new EntityAPI(this.adapter);
    this.temporal = new TemporalAPI(this.adapter);
    this.correlation = new CorrelationAPI(this.adapter);
    this.vector = new VectorAPI(this.adapter);
    
    this._ready = this.init(options);
  }
  
  private async init(options: DpthOptions): Promise<void> {
    // If path provided, dynamically load SQLite adapter
    if (options.path) {
      try {
        const { SQLiteAdapter } = await import('./adapter-sqlite.js');
        this.adapter = new SQLiteAdapter(options.path);
        // Re-initialize APIs with the real adapter
        this.entity = new EntityAPI(this.adapter);
        this.temporal = new TemporalAPI(this.adapter);
        this.correlation = new CorrelationAPI(this.adapter);
        this.vector = new VectorAPI(this.adapter);
      } catch {
        // SQLite not available, fall back to memory
        console.warn('dpth: better-sqlite3 not installed, using in-memory storage');
      }
    }
  }
  
  /** Wait for initialization to complete */
  async ready(): Promise<this> {
    await this._ready;
    return this;
  }
  
  /** Close the database and flush any pending writes */
  async close(): Promise<void> {
    await this._ready;
    await this.adapter.close();
  }
  
  /** Get database stats */
  async stats(): Promise<{
    entities: number;
    snapshots: number;
    metrics: number;
    vectors: number;
  }> {
    await this._ready;
    return {
      entities: await this.adapter.count('entities'),
      snapshots: await this.adapter.count('snapshots'),
      metrics: await this.adapter.count('metrics'),
      vectors: await this.adapter.count('vectors'),
    };
  }
}

// ─── Entity API ──────────────────────────────────────

class EntityAPI {
  constructor(private adapter: StorageAdapter) {}
  
  /**
   * Resolve an entity — find existing match or create new.
   * 
   * Preferred (object form):
   *   db.entity.resolve({ type: 'person', name: 'John', source: 'stripe', externalId: 'cus_123' })
   * 
   * Legacy (positional form — deprecated, will be removed in v1.0):
   *   db.entity.resolve('person', 'John', 'stripe', 'cus_123', { email: '...' })
   */
  async resolve(opts: ResolveOptions): Promise<ResolveResult>;
  async resolve(type: EntityType, name: string, sourceId: SourceId, externalId: string, options?: { email?: string; aliases?: string[]; attributes?: Record<string, unknown>; minConfidence?: number }): Promise<ResolveResult>;
  async resolve(
    typeOrOpts: EntityType | ResolveOptions,
    name?: string,
    sourceId?: SourceId,
    externalId?: string,
    options?: {
      email?: string;
      aliases?: string[];
      attributes?: Record<string, unknown>;
      minConfidence?: number;
    }
  ): Promise<ResolveResult> {
    // Normalize to object form
    let type: EntityType;
    let resolvedName: string;
    let resolvedSourceId: SourceId;
    let resolvedExternalId: string;
    let email: string | undefined;
    let aliases: string[] | undefined;
    let attributes: Record<string, unknown> | undefined;
    let minConfidence: number;
    
    if (typeof typeOrOpts === 'object') {
      // Object form (preferred)
      if (!typeOrOpts.type) throw new ValidationError('resolve() requires a non-empty "type" (e.g. "person", "company")');
      if (!typeOrOpts.name) throw new ValidationError('resolve() requires a non-empty "name"');
      if (!typeOrOpts.source) throw new ValidationError('resolve() requires a non-empty "source" (e.g. "stripe", "github")');
      if (!typeOrOpts.externalId) throw new ValidationError('resolve() requires a non-empty "externalId"');
      type = typeOrOpts.type;
      resolvedName = typeOrOpts.name;
      resolvedSourceId = typeOrOpts.source;
      resolvedExternalId = typeOrOpts.externalId;
      email = typeOrOpts.email;
      aliases = typeOrOpts.aliases;
      attributes = typeOrOpts.attributes;
      minConfidence = typeOrOpts.minConfidence ?? 0.7;
    } else {
      // Legacy positional form
      type = typeOrOpts;
      resolvedName = name!;
      resolvedSourceId = sourceId!;
      resolvedExternalId = externalId!;
      email = options?.email;
      aliases = options?.aliases;
      attributes = options?.attributes;
      minConfidence = options?.minConfidence ?? 0.7;
    }
    
    const sKey = `${resolvedSourceId}:${resolvedExternalId}`;
    
    // Check source index first (exact source match)
    const existingId = await this.adapter.get('source_index', sKey) as string | undefined;
    if (existingId) {
      const entity = await this.adapter.get('entities', existingId) as Entity | undefined;
      if (entity) {
        // Update last seen
        const ref = entity.sources.find(s => s.sourceId === resolvedSourceId && s.externalId === resolvedExternalId);
        if (ref) ref.lastSeen = new Date();
        await this.adapter.put('entities', entity.id, entity);
        return { entity, isNew: false, confidence: 1.0 };
      }
    }
    
    // Try fuzzy matching against existing entities
    const match = await this.findBestMatch(type, resolvedName, email, aliases);
    
    if (match && match.score >= minConfidence) {
      const entity = match.entity;
      
      // Merge: add source ref
      entity.sources.push({
        sourceId: resolvedSourceId,
        externalId: resolvedExternalId,
        confidence: match.score,
        lastSeen: new Date(),
      });
      
      // Add alias
      if (!entity.aliases.includes(resolvedName) && entity.name !== resolvedName) {
        entity.aliases.push(resolvedName);
      }
      
      // Merge attributes
      if (attributes) {
        const now = new Date();
        for (const [key, value] of Object.entries(attributes)) {
          const existing = entity.attributes[key];
          if (existing) {
            const current = existing.history.find(h => h.validTo === null);
            if (current) current.validTo = now;
            existing.history.push({ value, validFrom: now, validTo: null, source: resolvedSourceId });
            existing.current = value;
          } else {
            entity.attributes[key] = {
              current: value,
              history: [{ value, validFrom: now, validTo: null, source: resolvedSourceId }],
            };
          }
        }
      }
      
      entity.updatedAt = new Date();
      await this.adapter.put('entities', entity.id, entity);
      await this.adapter.put('source_index', sKey, entity.id);
      await this.updateEmailIndex(entity);
      
      return { entity, isNew: false, confidence: match.score };
    }
    
    // Create new entity
    const id = generateEntityId();
    const now = new Date();
    const entityAttrs: Record<string, TemporalValue<unknown>> = {};
    
    if (attributes) {
      for (const [key, value] of Object.entries(attributes)) {
        entityAttrs[key] = {
          current: value,
          history: [{ value, validFrom: now, validTo: null, source: resolvedSourceId }],
        };
      }
    }
    
    if (email) {
      entityAttrs['email'] = {
        current: email,
        history: [{ value: email, validFrom: now, validTo: null, source: resolvedSourceId }],
      };
    }
    
    const entity: Entity = {
      id,
      type,
      name: resolvedName,
      aliases: aliases || [],
      sources: [{ sourceId: resolvedSourceId, externalId: resolvedExternalId, confidence: 1.0, lastSeen: now }],
      attributes: entityAttrs,
      createdAt: now,
      updatedAt: now,
    };
    
    await this.adapter.put('entities', id, entity);
    await this.adapter.put('source_index', sKey, id);
    await this.updateEmailIndex(entity);
    
    return { entity, isNew: true, confidence: 1.0 };
  }
  
  /** Get entity by ID */
  async get(id: EntityId): Promise<Entity | undefined> {
    return await this.adapter.get('entities', id) as Entity | undefined;
  }
  
  /** Find entity by source reference */
  async findBySource(sourceId: SourceId, externalId: string): Promise<Entity | undefined> {
    const id = await this.adapter.get('source_index', `${sourceId}:${externalId}`) as string | undefined;
    return id ? await this.get(id) : undefined;
  }
  
  /** Get all entities of a type */
  async list(type?: EntityType): Promise<Entity[]> {
    const all = await this.adapter.query({
      collection: 'entities',
      ...(type ? { where: { type } } : {}),
    }) as Entity[];
    return all;
  }
  
  /** Update an entity attribute (temporal) */
  async setAttribute(entityId: EntityId, key: string, value: unknown, sourceId: SourceId): Promise<Entity | undefined> {
    const entity = await this.get(entityId);
    if (!entity) return undefined;
    
    const now = new Date();
    const existing = entity.attributes[key];
    
    if (existing) {
      const current = existing.history.find(h => h.validTo === null);
      if (current) current.validTo = now;
      existing.history.push({ value, validFrom: now, validTo: null, source: sourceId });
      existing.current = value;
    } else {
      entity.attributes[key] = {
        current: value,
        history: [{ value, validFrom: now, validTo: null, source: sourceId }],
      };
    }
    
    entity.updatedAt = now;
    await this.adapter.put('entities', entityId, entity);
    // Update email index if email attribute changed
    if (key === 'email') {
      await this.updateEmailIndex(entity);
    }
    return entity;
  }
  
  /** Merge two entities */
  async merge(keepId: EntityId, mergeId: EntityId): Promise<Entity | undefined> {
    const keep = await this.get(keepId);
    const merge = await this.get(mergeId);
    if (!keep || !merge) return undefined;
    
    // Merge sources
    for (const source of merge.sources) {
      if (!keep.sources.find(s => s.sourceId === source.sourceId && s.externalId === source.externalId)) {
        keep.sources.push(source);
      }
      await this.adapter.put('source_index', `${source.sourceId}:${source.externalId}`, keepId);
    }
    
    // Merge aliases
    for (const alias of [...merge.aliases, merge.name]) {
      if (!keep.aliases.includes(alias) && keep.name !== alias) {
        keep.aliases.push(alias);
      }
    }
    
    // Merge attributes
    for (const [key, value] of Object.entries(merge.attributes)) {
      if (!keep.attributes[key]) {
        keep.attributes[key] = value;
      } else {
        keep.attributes[key].history.push(...value.history);
        keep.attributes[key].history.sort((a, b) =>
          new Date(a.validFrom).getTime() - new Date(b.validFrom).getTime()
        );
      }
    }
    
    keep.updatedAt = new Date();
    await this.adapter.put('entities', keepId, keep);
    await this.adapter.delete('entities', mergeId);
    
    return keep;
  }
  
  /** Count entities */
  async count(type?: EntityType): Promise<number> {
    if (!type) return this.adapter.count('entities');
    const all = await this.list(type);
    return all.length;
  }
  
  /** Update the email index for an entity */
  private async updateEmailIndex(entity: Entity): Promise<void> {
    const email = entity.attributes['email']?.current as string | undefined;
    if (email) {
      await this.adapter.put('email_index', email.toLowerCase(), entity.id);
    }
  }
  
  // ── Private matching ──
  
  private async findBestMatch(
    type: EntityType,
    name: string,
    email?: string,
    aliases?: string[]
  ): Promise<{ entity: Entity; score: number } | null> {
    // ── Fast path: email index lookup (O(1) instead of O(n)) ──
    if (email) {
      const emailKey = email.toLowerCase();
      const entityId = await this.adapter.get('email_index', emailKey) as string | undefined;
      if (entityId) {
        const entity = await this.adapter.get('entities', entityId) as Entity | undefined;
        if (entity && entity.type === type) {
          return { entity, score: 0.9 + (entity.name.toLowerCase() === name.toLowerCase() ? 0.1 : 0) };
        }
      }
    }
    
    // ── Blocking: narrow candidates before fuzzy matching ──
    // Instead of scanning ALL entities, use name-based blocking
    const candidates = await this.adapter.query({
      collection: 'entities',
      where: { type },
    }) as Entity[];
    
    // For small sets (<500), just scan all — Levenshtein is fast enough
    // For larger sets, use first-letter + length blocking to narrow
    let narrowed: Entity[];
    if (candidates.length < 500) {
      narrowed = candidates;
    } else {
      const nameLower = name.toLowerCase();
      const nameLen = nameLower.length;
      narrowed = candidates.filter(e => {
        const eName = e.name.toLowerCase();
        // Block 1: first letter match OR alias match
        if (eName[0] !== nameLower[0] && 
            !e.aliases.some(a => a.toLowerCase()[0] === nameLower[0])) {
          return false;
        }
        // Block 2: length within 50% (no point fuzzy-matching "Al" against "Alexander Hamilton")
        if (Math.abs(eName.length - nameLen) > nameLen * 0.5) {
          return false;
        }
        return true;
      });
      
      // Also include any entities that share email domain if we have email
      if (email) {
        const domain = email.split('@')[1]?.toLowerCase();
        if (domain) {
          for (const entity of candidates) {
            const eEmail = entity.attributes['email']?.current as string | undefined;
            if (eEmail?.toLowerCase().endsWith(`@${domain}`) && !narrowed.includes(entity)) {
              narrowed.push(entity);
            }
          }
        }
      }
    }
    
    let best: { entity: Entity; score: number } | null = null;
    const searchTerms = [name.toLowerCase(), ...(aliases || []).map(a => a.toLowerCase())];
    if (email) searchTerms.push(email.toLowerCase());
    
    for (const entity of narrowed) {
      let score = 0;
      
      // Name matching
      const entityName = entity.name.toLowerCase();
      if (entityName === name.toLowerCase()) {
        score += 0.8;
      } else if (this.fuzzyScore(entityName, name.toLowerCase()) > 0.85) {
        score += 0.5;
      } else if (this.fuzzyScore(entityName, name.toLowerCase()) > 0.7) {
        score += 0.3;
      }
      
      // Email matching
      const entityEmail = entity.attributes['email']?.current as string | undefined;
      if (email && entityEmail && entityEmail.toLowerCase() === email.toLowerCase()) {
        score += 0.9;
      }
      
      // Alias matching
      for (const alias of entity.aliases) {
        if (searchTerms.includes(alias.toLowerCase())) {
          score += 0.3;
          break;
        }
      }
      
      score = Math.min(1, score);
      if (score > 0.3 && (!best || score > best.score)) {
        best = { entity, score };
      }
    }
    
    return best;
  }
  
  private fuzzyScore(a: string, b: string): number {
    if (a === b) return 1;
    if (!a.length || !b.length) return 0;
    const matrix: number[][] = [];
    for (let i = 0; i <= a.length; i++) matrix[i] = [i];
    for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i-1] === b[j-1] ? 0 : 1;
        matrix[i][j] = Math.min(matrix[i-1][j]+1, matrix[i][j-1]+1, matrix[i-1][j-1]+cost);
      }
    }
    return 1 - matrix[a.length][b.length] / Math.max(a.length, b.length);
  }
}

// ─── Temporal API ────────────────────────────────────

class TemporalAPI {
  constructor(private adapter: StorageAdapter) {}
  
  /** Take a snapshot of any data */
  async snapshot<T = Record<string, unknown>>(
    key: string,
    data: T,
    source: SourceId = 'local'
  ): Promise<SnapshotRecord<T>> {
    const record: SnapshotRecord<T> = {
      id: generateSnapshotId(),
      key,
      timestamp: new Date(),
      data,
      source,
    };
    
    // Store snapshot directly — no separate index needed.
    // history() uses query({ where: { key } }) to find all snapshots for a key.
    // This avoids the old approach of maintaining a JSON array index that grew unbounded.
    await this.adapter.put('snapshots', record.id, record);
    
    return record;
  }
  
  /** Get all snapshots for a key (ordered by time) */
  async history<T = Record<string, unknown>>(key: string, options?: { limit?: number; offset?: number }): Promise<SnapshotRecord<T>[]> {
    const records = await this.adapter.query({
      collection: 'snapshots',
      where: { key },
      orderBy: { field: 'timestamp', direction: 'asc' },
      ...(options?.limit ? { limit: options.limit } : {}),
      ...(options?.offset ? { offset: options.offset } : {}),
    }) as SnapshotRecord<T>[];
    
    return records;
  }
  
  /** Get the latest snapshot for a key */
  async latest<T = Record<string, unknown>>(key: string): Promise<SnapshotRecord<T> | undefined> {
    const records = await this.adapter.query({
      collection: 'snapshots',
      where: { key },
      orderBy: { field: 'timestamp', direction: 'desc' },
      limit: 1,
    }) as SnapshotRecord<T>[];
    return records[0] ?? undefined;
  }
  
  /** Get snapshot closest to a specific time */
  async at<T = Record<string, unknown>>(key: string, time: Date): Promise<SnapshotRecord<T> | undefined> {
    const all = await this.history<T>(key);
    if (!all.length) return undefined;
    
    const targetMs = time.getTime();
    let closest: SnapshotRecord<T> | undefined;
    let minDiff = Infinity;
    
    for (const snap of all) {
      const diff = Math.abs(new Date(snap.timestamp).getTime() - targetMs);
      if (diff < minDiff) {
        minDiff = diff;
        closest = snap;
      }
    }
    
    return closest;
  }
  
  /** Diff two snapshots */
  diff<T extends Record<string, unknown>>(
    older: SnapshotRecord<T>,
    newer: SnapshotRecord<T>
  ): DiffResult {
    const olderKeys = new Set(Object.keys(older.data));
    const newerKeys = new Set(Object.keys(newer.data));
    
    const added: string[] = [];
    const removed: string[] = [];
    const changed: Array<{ key: string; from: unknown; to: unknown }> = [];
    
    for (const key of newerKeys) {
      if (!olderKeys.has(key)) {
        added.push(key);
      } else if (JSON.stringify(older.data[key]) !== JSON.stringify(newer.data[key])) {
        changed.push({ key, from: older.data[key], to: newer.data[key] });
      }
    }
    
    for (const key of olderKeys) {
      if (!newerKeys.has(key)) removed.push(key);
    }
    
    return { added, removed, changed };
  }
}

// ─── Correlation API ─────────────────────────────────

class CorrelationAPI {
  constructor(private adapter: StorageAdapter) {}
  
  /** Track a metric value */
  async track(
    metricId: string,
    value: number,
    options?: { source?: SourceId; entityId?: EntityId; name?: string; unit?: string }
  ): Promise<void> {
    let metric = await this.adapter.get('metrics', metricId) as Metric | undefined;
    
    const point: MetricPoint = {
      timestamp: new Date(),
      value,
      source: options?.source || 'local',
      confidence: 1.0,
    };
    
    if (!metric) {
      metric = {
        id: metricId,
        entityId: options?.entityId || metricId,
        name: options?.name || metricId,
        unit: options?.unit,
        points: [point],
        aggregation: 'last',
      };
    } else {
      metric.points.push(point);
      metric.points.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      
      // Cap points to prevent unbounded growth (default: 10,000)
      const MAX_POINTS = 10_000;
      if (metric.points.length > MAX_POINTS) {
        // Keep the most recent MAX_POINTS entries
        metric.points = metric.points.slice(-MAX_POINTS);
      }
    }
    
    await this.adapter.put('metrics', metricId, metric);
  }
  
  /** Find correlations for a metric */
  async find(metricId: string, options?: { minCorrelation?: number; maxLagDays?: number }): Promise<CorrelationHit[]> {
    const target = await this.adapter.get('metrics', metricId) as Metric | undefined;
    if (!target || target.points.length < 10) return [];
    
    const allMetrics = await this.adapter.query({ collection: 'metrics' }) as Metric[];
    const minCorr = options?.minCorrelation ?? 0.5;
    const maxLag = options?.maxLagDays ?? 14;
    const results: CorrelationHit[] = [];
    
    for (const other of allMetrics) {
      if (other.id === metricId || other.points.length < 10) continue;
      
      for (let lag = 0; lag <= maxLag; lag++) {
        const r = this.pearson(target, other, lag);
        if (r !== null && Math.abs(r.correlation) >= minCorr) {
          results.push({
            metricId: other.id,
            correlation: r.correlation,
            lagDays: lag,
            direction: r.correlation >= 0 ? 'positive' : 'negative',
            sampleSize: r.n,
          });
        }
      }
    }
    
    return results.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
  }
  
  /** Get a metric's history */
  async get(metricId: string): Promise<Metric | undefined> {
    return await this.adapter.get('metrics', metricId) as Metric | undefined;
  }
  
  /** List all tracked metrics */
  async list(): Promise<Metric[]> {
    return await this.adapter.query({ collection: 'metrics' }) as Metric[];
  }
  
  // ── Private ──
  
  private pearson(a: Metric, b: Metric, lagDays: number): { correlation: number; n: number } | null {
    // Align time series at daily granularity
    const dayMs = 86400000;
    const aMap = new Map<number, number>();
    for (const p of a.points) {
      const day = Math.floor(new Date(p.timestamp).getTime() / dayMs);
      aMap.set(day, p.value);
    }
    
    const pairs: [number, number][] = [];
    for (const p of b.points) {
      const day = Math.floor(new Date(p.timestamp).getTime() / dayMs) + lagDays;
      const aVal = aMap.get(day);
      if (aVal !== undefined) pairs.push([aVal, p.value]);
    }
    
    if (pairs.length < 5) return null;
    
    const n = pairs.length;
    const meanA = pairs.reduce((s, p) => s + p[0], 0) / n;
    const meanB = pairs.reduce((s, p) => s + p[1], 0) / n;
    
    let num = 0, denA = 0, denB = 0;
    for (const [a, b] of pairs) {
      const da = a - meanA;
      const db = b - meanB;
      num += da * db;
      denA += da * da;
      denB += db * db;
    }
    
    const den = Math.sqrt(denA * denB);
    if (den === 0) return null;
    
    return { correlation: num / den, n };
  }
}

// ─── Vector API ──────────────────────────────────────

class VectorAPI {
  constructor(private adapter: StorageAdapter) {}
  
  private get vec(): VectorAdapter | null {
    return 'putVector' in this.adapter ? this.adapter as VectorAdapter : null;
  }
  
  /** Check if vector search is available */
  get available(): boolean {
    return this.vec !== null;
  }
  
  /** Store a vector */
  async store(collection: string, key: string, vector: number[], metadata?: Record<string, unknown>): Promise<void> {
    const v = this.vec;
    if (!v) throw new AdapterCapabilityError('vector.store()', 'a VectorAdapter (use MemoryVectorAdapter or VectorOverlay)');
    await v.putVector(collection, key, vector, metadata);
  }
  
  /** Search by vector similarity */
  async search(collection: string, vector: number[], topK: number = 10, minScore?: number): Promise<VectorResult[]> {
    const v = this.vec;
    if (!v) throw new AdapterCapabilityError('vector.search()', 'a VectorAdapter (use MemoryVectorAdapter or VectorOverlay)');
    return v.searchVector(collection, vector, topK, minScore);
  }
}

// ─── Factory Function ────────────────────────────────

/**
 * Create a dpth database instance.
 * 
 * @param pathOrOptions — SQLite path string, or options object
 * @returns Initialized Dpth instance (call .ready() if you need to await init)
 * 
 * @example
 * // In-memory (default)
 * const db = dpth();
 * 
 * // Persistent (SQLite)
 * const db = await dpth('./myapp.db').ready();
 * 
 * // Custom adapter
 * const db = dpth({ adapter: new MemoryVectorAdapter() });
 */
export function dpth(pathOrOptions?: string | DpthOptions): Dpth {
  if (typeof pathOrOptions === 'string') {
    return new Dpth({ path: pathOrOptions });
  }
  return new Dpth(pathOrOptions);
}
