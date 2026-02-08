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
import { detectShape, validateShape, type RouteResult, type SignalShape, type EntityShape, type TemporalShape, type CorrelationShape, ShapeValidationError } from './router.js';
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

/** Embedding function type — bring your own embedder */
export type EmbedFn = (text: string) => Promise<number[]>;

export interface DpthOptions {
  /** Storage adapter (default: MemoryAdapter) */
  adapter?: StorageAdapter;
  /** Path to SQLite database (convenience — creates SQLiteAdapter) */
  path?: string;
  /** 
   * Opt into the dpth network. Your agent contributes anonymized resolution
   * signals (which matching rules work, how accurately) and gets back
   * collective intelligence that improves matching for everyone.
   * 
   * No entity data, names, or emails are ever sent — only aggregate statistics
   * about rule performance (e.g. "email matching is 98% accurate for stripe+github").
   * 
   * Default: false
   */
  network?: boolean;
  /** Custom coordinator URL (default: https://api.dpth.io) */
  coordinatorUrl?: string;
  /** 
   * Path to write-ahead log for durable signal delivery.
   * Signals are persisted here before network send and only removed after confirmation.
   * Unconfirmed signals are replayed on restart.
   * 
   * Default: undefined (no WAL, signals may be lost on crash/network failure)
   */
  walPath?: string;
  /**
   * Embedding function for semantic search. When provided:
   * - Entities are auto-embedded on resolve()
   * - entity.searchSimilar() becomes available
   * 
   * Bring your own embedder — use fastembed, OpenAI, transformers.js, etc.
   * 
   * @example
   * embedFn: async (text) => {
   *   const { embed } = await import('fastembed');
   *   return embed(text);
   * }
   */
  embedFn?: EmbedFn;
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
  /** Network signal tracker (when network: true) */
  private _network: NetworkLayer | null = null;
  /** Embedding function for semantic search */
  private _embedFn: EmbedFn | null = null;
  
  /** Entity resolution and management */
  public entity: EntityAPI;
  /** Temporal history and snapshots */
  public temporal: TemporalAPI;
  /** Correlation detection across metrics */
  public correlation: CorrelationAPI;
  /** Vector search (if adapter supports it) */
  public vector: VectorAPI;
  /** Network signals — report outcomes, query calibration (requires network: true) */
  public signal: SignalAPI;
  
  constructor(options: DpthOptions = {}) {
    this.adapter = options.adapter || new MemoryAdapter();
    this._embedFn = options.embedFn || null;
    
    if (options.network) {
      this._network = new NetworkLayer(options.coordinatorUrl, options.walPath);
    }
    
    this.entity = new EntityAPI(this.adapter, this._network, this._embedFn);
    this.temporal = new TemporalAPI(this.adapter);
    this.correlation = new CorrelationAPI(this.adapter);
    this.vector = new VectorAPI(this.adapter);
    this.signal = new SignalAPI(this._network);
    
    this._ready = this.init(options);
  }
  
  private async init(options: DpthOptions): Promise<void> {
    // If path provided, dynamically load SQLite adapter
    if (options.path) {
      try {
        const { SQLiteAdapter } = await import('./adapter-sqlite.js');
        let baseAdapter: StorageAdapter = new SQLiteAdapter(options.path);
        
        // If embedFn provided, wrap in VectorOverlay for semantic search
        if (this._embedFn) {
          const { VectorOverlay } = await import('./adapter-vector.js');
          this.adapter = new VectorOverlay(baseAdapter);
        } else {
          this.adapter = baseAdapter;
        }
        
        // Re-initialize APIs with the real adapter
        this.entity = new EntityAPI(this.adapter, this._network, this._embedFn);
        this.temporal = new TemporalAPI(this.adapter);
        this.correlation = new CorrelationAPI(this.adapter);
        this.vector = new VectorAPI(this.adapter);
        this.signal = new SignalAPI(this._network);
      } catch {
        // SQLite not available, fall back to memory
        console.warn('dpth: better-sqlite3 not installed, using in-memory storage');
      }
    }
    
    // Register with the network if enabled
    if (this._network) {
      await this._network.register().catch(() => {
        // Network registration is best-effort — never block local functionality
        console.warn('dpth: network registration failed, continuing in local-only mode');
        this._network = null;
      });
      
      // Replay any unconfirmed signals from WAL
      if (this._network) {
        await this._network.initWal();
      }
    }
  }
  
  /** Wait for initialization to complete */
  async ready(): Promise<this> {
    await this._ready;
    return this;
  }

  // ─── Unified Record API ────────────────────────────

  /**
   * Record data using shape-based routing.
   * 
   * dpth inspects the shape of your data and routes it to the appropriate pipeline:
   * - Signal shape { context, strategy, outcome } → Aggregate pipeline
   * - Entity shape { type, name, source, externalId } → Individual pipeline
   * - Temporal shape { key, value } → Append pipeline
   * - Correlation shape { metric, value } → Compute pipeline
   * 
   * @example
   * // Signal (aggregates into buckets)
   * db.record({ context: 'stripe', strategy: 'retry_60s', outcome: 1 });
   * 
   * // Entity (stores individual, merges matches)
   * db.record({ type: 'person', name: 'John', source: 'stripe', externalId: 'cus_123' });
   * 
   * // Temporal (appends to history)
   * db.record({ key: 'mrr', value: 50000 });
   * 
   * // Correlation (tracks for analysis)
   * db.record({ metric: 'deploys', value: 12 });
   */
  async record(data: Record<string, unknown>): Promise<RouteResult> {
    await this._ready;
    
    const route = validateShape(data);
    
    switch (route.pipeline) {
      case 'aggregate':
        // Route to signal pipeline
        const signal = route.data as SignalShape;
        this.signal.report({
          domain: signal.domain || 'general',
          context: signal.context,
          strategy: signal.strategy,
          condition: signal.condition,
          success: signal.outcome >= 0.5,
          cost: signal.cost,
        });
        break;
        
      case 'individual':
        // Route to entity pipeline
        const entity = route.data as EntityShape;
        await this.entity.resolve({
          type: entity.type,
          name: entity.name,
          source: entity.source,
          externalId: entity.externalId,
          email: entity.email,
          aliases: entity.aliases,
          attributes: entity.attributes,
        });
        break;
        
      case 'append':
        // Route to temporal pipeline
        const temporal = route.data as TemporalShape;
        await this.temporal.snapshot(temporal.key, temporal.value, temporal.source);
        break;
        
      case 'compute':
        // Route to correlation pipeline
        const corr = route.data as CorrelationShape;
        await this.correlation.track(corr.metric, corr.value);
        break;
    }
    
    return route;
  }

  /**
   * Detect the shape of data without recording it.
   * Useful for validation or debugging.
   */
  detectShape(data: Record<string, unknown>): RouteResult | null {
    return detectShape(data);
  }
  
  /** Close the database and flush any pending signals/writes */
  async close(): Promise<void> {
    await this._ready;
    // Flush any pending resolution signals to the network
    if (this._network) {
      await this._network.flush().catch(() => {});
    }
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

/** Options for semantic entity search */
export interface SearchSimilarOptions {
  /** Maximum results to return (default: 10) */
  limit?: number;
  /** Minimum similarity score (default: 0.5) */
  minScore?: number;
  /** Filter by entity type */
  type?: EntityType;
}

/** Semantic search result */
export interface SimilarEntity {
  entity: Entity;
  score: number;
}

class EntityAPI {
  constructor(
    private adapter: StorageAdapter, 
    private network: NetworkLayer | null = null,
    private embedFn: EmbedFn | null = null
  ) {}
  
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
      
      // Auto-embed if embedFn provided (non-blocking)
      this.embedEntity(entity).catch(() => {});
      
      // Report successful merge to the network (non-blocking)
      if (this.network) {
        const existingSource = entity.sources[0]?.sourceId;
        if (existingSource) {
          const schema = [existingSource, resolvedSourceId].sort().join('+');
          for (const rule of match.matchedOn) {
            this.network.recordResolution(schema, rule, true);
          }
        }
      }
      
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
    
    // Auto-embed if embedFn provided (non-blocking)
    this.embedEntity(entity).catch(() => {});
    
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
  ): Promise<{ entity: Entity; score: number; matchedOn: string[] } | null> {
    // ── Fast path: email index lookup (O(1) instead of O(n)) ──
    if (email) {
      const emailKey = email.toLowerCase();
      const entityId = await this.adapter.get('email_index', emailKey) as string | undefined;
      if (entityId) {
        const entity = await this.adapter.get('entities', entityId) as Entity | undefined;
        if (entity && entity.type === type) {
          const matchedOn = ['email_exact'];
          if (entity.name.toLowerCase() === name.toLowerCase()) matchedOn.push('name_exact');
          return { entity, score: 0.9 + (matchedOn.includes('name_exact') ? 0.1 : 0), matchedOn };
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
    
    let best: { entity: Entity; score: number; matchedOn: string[] } | null = null;
    const searchTerms = [name.toLowerCase(), ...(aliases || []).map(a => a.toLowerCase())];
    if (email) searchTerms.push(email.toLowerCase());
    
    for (const entity of narrowed) {
      let score = 0;
      const matchedOn: string[] = [];
      
      // Name matching
      const entityName = entity.name.toLowerCase();
      if (entityName === name.toLowerCase()) {
        score += 0.8;
        matchedOn.push('name_exact');
      } else if (this.fuzzyScore(entityName, name.toLowerCase()) > 0.85) {
        score += 0.5;
        matchedOn.push('name_fuzzy_high');
      } else if (this.fuzzyScore(entityName, name.toLowerCase()) > 0.7) {
        score += 0.3;
        matchedOn.push('name_fuzzy_low');
      }
      
      // Email matching
      const entityEmail = entity.attributes['email']?.current as string | undefined;
      if (email && entityEmail && entityEmail.toLowerCase() === email.toLowerCase()) {
        score += 0.9;
        matchedOn.push('email_exact');
      }
      
      // Alias matching
      for (const alias of entity.aliases) {
        if (searchTerms.includes(alias.toLowerCase())) {
          score += 0.3;
          matchedOn.push('alias');
          break;
        }
      }
      
      score = Math.min(1, score);
      if (score > 0.3 && (!best || score > best.score)) {
        best = { entity, score, matchedOn };
      }
    }
    
    return best;
  }
  
  /**
   * Search entities by semantic similarity to text.
   * Requires embedFn to be provided in dpth options.
   * 
   * @example
   * const similar = await db.entity.searchSimilar('enterprise SaaS customers', { limit: 10 });
   * // → [{ entity, score: 0.89 }, ...]
   */
  async searchSimilar(text: string, options?: SearchSimilarOptions): Promise<SimilarEntity[]> {
    if (!this.embedFn) {
      throw new AdapterCapabilityError(
        'entity.searchSimilar()',
        'an embedFn in dpth options'
      );
    }
    
    const vec = this.adapter as VectorAdapter;
    if (!('searchVector' in vec)) {
      throw new AdapterCapabilityError(
        'entity.searchSimilar()',
        'a VectorAdapter (auto-enabled when embedFn is provided with path option)'
      );
    }
    
    const limit = options?.limit ?? 10;
    const minScore = options?.minScore ?? 0.5;
    
    // Embed the query text
    const queryVector = await this.embedFn(text);
    
    // Search for similar entities
    const results = await vec.searchVector('entity_embeddings', queryVector, limit * 2, minScore);
    
    // Fetch full entities and filter by type if specified
    const entities: SimilarEntity[] = [];
    for (const result of results) {
      const entity = await this.get(result.key);
      if (entity && (!options?.type || entity.type === options.type)) {
        entities.push({ entity, score: result.score });
        if (entities.length >= limit) break;
      }
    }
    
    return entities;
  }
  
  /**
   * Check if semantic search is available (embedFn was provided)
   */
  get semanticSearchAvailable(): boolean {
    return this.embedFn !== null;
  }
  
  // ── Private: embedding ──
  
  /**
   * Generate text representation of an entity for embedding
   */
  private entityToText(entity: Entity): string {
    const parts = [
      `${entity.type}: ${entity.name}`,
      ...entity.aliases.map(a => `also known as ${a}`),
    ];
    
    // Add key attributes
    for (const [key, value] of Object.entries(entity.attributes)) {
      if (typeof value.current === 'string' || typeof value.current === 'number') {
        parts.push(`${key}: ${value.current}`);
      }
    }
    
    // Add source information
    const sources = entity.sources.map(s => s.sourceId).join(', ');
    parts.push(`found in: ${sources}`);
    
    return parts.join('. ');
  }
  
  /**
   * Embed an entity (called automatically on resolve if embedFn provided)
   */
  private async embedEntity(entity: Entity): Promise<void> {
    if (!this.embedFn) return;
    
    const vec = this.adapter as VectorAdapter;
    if (!('putVector' in vec)) return;
    
    const text = this.entityToText(entity);
    const vector = await this.embedFn(text);
    
    await vec.putVector('entity_embeddings', entity.id, vector, {
      type: entity.type,
      name: entity.name,
      text,
    });
  }
  
  // ── Private: matching ──

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

// ─── Signal API (Open Vocabulary Network) ────────────

/**
 * Public API for submitting and querying network signals.
 * Agents can report outcomes for ANY domain — not just entity resolution.
 * 
 * The network learns what works from what agents actually report.
 * No closed vocabulary. Statistical convergence determines what's useful.
 * 
 * @example
 * const db = dpth({ network: true });
 * 
 * // Report a tool selection outcome
 * db.signal.report({
 *   domain: 'tool_selection',
 *   context: 'summarize_url',
 *   strategy: 'web_fetch',
 *   condition: 'static_site',
 *   success: true,
 *   cost: 5,
 * });
 * 
 * // Query what the network knows
 * const results = await db.signal.query({ domain: 'tool_selection', context: 'summarize_url' });
 * // → [{ strategy: 'web_fetch', condition: 'static_site', successRate: 0.94, avgCost: 5 }, ...]
 */
class SignalAPI {
  constructor(private network: NetworkLayer | null) {}
  
  /**
   * Report an outcome to the network. Accumulated locally, flushed periodically.
   * 
   * @param signal.domain - What kind of task (identity, tool_selection, api_reliability, etc.)
   * @param signal.context - The situation (e.g., "stripe+github", "summarize_url", "timeout+openai")
   * @param signal.strategy - What approach was tried (e.g., "email_match", "web_fetch", "retry_30s")
   * @param signal.condition - Optional modifier (e.g., "corporate_domain", "peak_hours", "static_site")
   * @param signal.success - Did it work?
   * @param signal.cost - Optional cost in tokens/ms/calls (agent-defined units)
   */
  report(signal: {
    domain: string;
    context: string;
    strategy: string;
    condition?: string;
    success: boolean;
    cost?: number;
  }): void {
    if (!this.network) {
      // Silently ignore when network is not enabled — don't break user code
      return;
    }
    this.network.recordSignal(
      signal.domain,
      signal.context,
      signal.strategy,
      signal.condition || 'none',
      signal.success,
      signal.cost,
    );
  }
  
  /**
   * Query what the network knows about a given context.
   * Returns calibration data sorted by confidence (most data first).
   * 
   * Returns null if network is not enabled or not reachable.
   */
  async query(opts: {
    domain?: string;
    context?: string;
    strategy?: string;
    condition?: string;
  }): Promise<Array<{
    domain: string;
    context: string;
    strategy: string;
    condition: string;
    successRate: number;
    failureRate: number;
    avgCost: number;
    confidence: number;
    attempts: number;
    contributions: number;
  }> | null> {
    if (!this.network) return null;
    return this.network.calibrate(opts);
  }
  
  /** Whether the network is enabled and connected */
  get connected(): boolean {
    return this.network !== null;
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
 * // Opt into the network — your resolutions improve everyone's matching
 * const db = await dpth({ path: './app.db', network: true }).ready();
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

// ─── Network Layer (The Waze Engine) ─────────────────

const DEFAULT_COORDINATOR = 'https://api.dpth.io';
const FLUSH_THRESHOLD = 50; // Flush after this many resolutions

/**
 * Tracks resolution outcomes locally, then periodically submits
 * aggregated, anonymized signals to the dpth network.
 * 
 * Never sends entity data, names, emails, or any PII.
 * Only sends: which strategies work, how accurately, for which contexts.
 * 
 * Open vocabulary — agents can submit signals for any domain, not just identity.
 */
interface SignalRecord {
  id: string;
  domain: string;
  context: string;
  strategy: string;
  condition: string;
  successes: number;
  failures: number;
  totalAttempts: number;
  cost: number;
  createdAt: string;
  confirmed?: boolean;
}

class NetworkLayer {
  private coordinatorUrl: string;
  private agentId: string | null = null;
  private walPath: string | null = null;
  
  /** 
   * Local accumulator: domain:context:strategy → { successes, failures, total, cost }
   * Flushed to the network when threshold is hit or on close().
   */
  private signals = new Map<string, {
    domain: string;
    context: string;
    strategy: string;
    condition: string;
    successes: number;
    failures: number;
    totalAttempts: number;
    cost: number;
  }>();
  
  private signalCount = 0;
  
  constructor(coordinatorUrl?: string, walPath?: string) {
    this.coordinatorUrl = coordinatorUrl || DEFAULT_COORDINATOR;
    this.walPath = walPath || null;
  }
  
  /** Initialize WAL - replay any unconfirmed signals */
  async initWal(): Promise<void> {
    if (!this.walPath) return;
    
    try {
      const { readFileSync, existsSync } = await import('fs');
      if (!existsSync(this.walPath)) return;
      
      const content = readFileSync(this.walPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      
      for (const line of lines) {
        try {
          const record: SignalRecord = JSON.parse(line);
          if (record.confirmed) continue; // Skip confirmed
          
          // Replay into accumulator
          const key = `${record.domain}:${record.context}:${record.strategy}:${record.condition}`;
          const existing = this.signals.get(key);
          
          if (existing) {
            existing.successes += record.successes;
            existing.failures += record.failures;
            existing.totalAttempts += record.totalAttempts;
            existing.cost += record.cost;
          } else {
            this.signals.set(key, {
              domain: record.domain,
              context: record.context,
              strategy: record.strategy,
              condition: record.condition,
              successes: record.successes,
              failures: record.failures,
              totalAttempts: record.totalAttempts,
              cost: record.cost,
            });
          }
          this.signalCount += record.totalAttempts;
        } catch {
          // Skip malformed lines
        }
      }
      
      // Compact WAL - remove confirmed entries
      await this.compactWal();
    } catch {
      // WAL not available (browser, permissions, etc.) - continue without
    }
  }
  
  /** Append signal to WAL before network send */
  private async appendWal(signal: SignalRecord): Promise<void> {
    if (!this.walPath) return;
    
    try {
      const { appendFileSync } = await import('fs');
      appendFileSync(this.walPath, JSON.stringify(signal) + '\n');
    } catch {
      // WAL write failed - continue anyway (best effort)
    }
  }
  
  /** Mark signals as confirmed in WAL */
  private async confirmWal(ids: string[]): Promise<void> {
    if (!this.walPath || ids.length === 0) return;
    
    try {
      const { readFileSync, writeFileSync, existsSync } = await import('fs');
      if (!existsSync(this.walPath)) return;
      
      const content = readFileSync(this.walPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      const idSet = new Set(ids);
      
      const updated = lines.map(line => {
        try {
          const record: SignalRecord = JSON.parse(line);
          if (idSet.has(record.id)) {
            record.confirmed = true;
            return JSON.stringify(record);
          }
          return line;
        } catch {
          return line;
        }
      });
      
      writeFileSync(this.walPath, updated.join('\n') + '\n');
    } catch {
      // Confirm failed - will be retried on next flush
    }
  }
  
  /** Remove confirmed entries from WAL */
  private async compactWal(): Promise<void> {
    if (!this.walPath) return;
    
    try {
      const { readFileSync, writeFileSync, existsSync } = await import('fs');
      if (!existsSync(this.walPath)) return;
      
      const content = readFileSync(this.walPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      
      const unconfirmed = lines.filter(line => {
        try {
          const record: SignalRecord = JSON.parse(line);
          return !record.confirmed;
        } catch {
          return false; // Remove malformed
        }
      });
      
      writeFileSync(this.walPath, unconfirmed.length > 0 ? unconfirmed.join('\n') + '\n' : '');
    } catch {
      // Compact failed - not critical
    }
  }
  
  /** Register this dpth instance as an agent on the network */
  async register(): Promise<void> {
    const res = await fetch(`${this.coordinatorUrl}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: `dpth-lib-${randomHex(8)}`,
        capabilities: { storageCapacityMb: 0, cpuCores: 0, hasGpu: false },
      }),
    });
    
    if (!res.ok) throw new Error('Network registration failed');
    const data = await res.json();
    this.agentId = data.agent.id;
  }
  
  /**
   * Record an outcome locally. Accumulates stats in memory, flushed to network periodically.
   * 
   * For entity resolution (called internally by EntityAPI on merges):
   *   recordSignal('identity', 'stripe+github', 'email_exact', 'corporate_domain', true)
   * 
   * For any other domain (called by user code):
   *   recordSignal('tool_selection', 'summarize_url', 'web_fetch', 'static_site', true, 5)
   */
  recordSignal(domain: string, context: string, strategy: string, condition: string, success: boolean, cost?: number): void {
    const key = `${domain}:${context}:${strategy}:${condition}`;
    let signal = this.signals.get(key);
    
    if (!signal) {
      signal = { domain, context, strategy, condition, successes: 0, failures: 0, totalAttempts: 0, cost: 0 };
      this.signals.set(key, signal);
    }
    
    signal.totalAttempts++;
    if (success) {
      signal.successes++;
    } else {
      signal.failures++;
    }
    if (cost) signal.cost += cost;
    
    this.signalCount++;
    
    if (this.signalCount >= FLUSH_THRESHOLD) {
      this.flush().catch(() => {});
    }
  }
  
  /**
   * Backward-compatible: record an entity resolution outcome.
   * Translates to the new open signal format.
   */
  recordResolution(schema: string, rule: string, success: boolean): void {
    this.recordSignal('identity', schema, rule, 'none', success);
  }
  
  /**
   * Flush accumulated signals to the network.
   * Called automatically every FLUSH_THRESHOLD signals, and on close().
   * 
   * With WAL enabled:
   * 1. Write to WAL first (durable)
   * 2. Send to network
   * 3. Mark confirmed in WAL on success
   * 4. Compact WAL periodically
   */
  async flush(): Promise<void> {
    if (!this.agentId || this.signals.size === 0) return;
    
    const toSend: Array<{ id: string; signal: SignalRecord }> = [];
    
    // Prepare signals with IDs for tracking
    for (const signal of this.signals.values()) {
      if (signal.totalAttempts < 1) continue;
      
      const id = randomHex(8);
      const record: SignalRecord = {
        id,
        domain: signal.domain,
        context: signal.context,
        strategy: signal.strategy,
        condition: signal.condition,
        successes: signal.successes,
        failures: signal.failures,
        totalAttempts: signal.totalAttempts,
        cost: signal.cost,
        createdAt: new Date().toISOString(),
      };
      
      // Write to WAL first (durable)
      await this.appendWal(record);
      toSend.push({ id, signal: record });
    }
    
    // Send to network and track confirmations
    const confirmed: string[] = [];
    
    const promises = toSend.map(async ({ id, signal }) => {
      try {
        const res = await fetch(`${this.coordinatorUrl}/signals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: this.agentId,
            domain: signal.domain,
            context: signal.context,
            strategy: signal.strategy,
            condition: signal.condition,
            successes: signal.successes,
            failures: signal.failures,
            totalAttempts: signal.totalAttempts,
            cost: signal.cost,
          }),
        });
        
        if (res.ok) {
          confirmed.push(id);
        }
      } catch {
        // Network failed - will be replayed from WAL on next run
      }
    });
    
    await Promise.all(promises);
    
    // Mark confirmed in WAL
    await this.confirmWal(confirmed);
    
    // Clear in-memory accumulator
    this.signals.clear();
    this.signalCount = 0;
    
    // Compact WAL periodically (remove confirmed entries)
    if (Math.random() < 0.1) { // 10% chance per flush
      await this.compactWal();
    }
  }
  
  /**
   * Ask the network what it knows about a given context.
   * Open query — filter by any combination of domain, context, strategy, condition.
   */
  async calibrate(opts: {
    domain?: string;
    context?: string;
    strategy?: string;
    condition?: string;
  }): Promise<Array<{
    domain: string;
    context: string;
    strategy: string;
    condition: string;
    successRate: number;
    failureRate: number;
    avgCost: number;
    confidence: number;
    attempts: number;
    contributions: number;
  }> | null> {
    try {
      const params = new URLSearchParams();
      if (opts.domain) params.set('domain', opts.domain);
      if (opts.context) params.set('context', opts.context);
      if (opts.strategy) params.set('strategy', opts.strategy);
      if (opts.condition) params.set('condition', opts.condition);
      
      const res = await fetch(`${this.coordinatorUrl}/calibrate?${params}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.calibration;
    } catch {
      return null;
    }
  }
  
  /**
   * Backward-compatible: get calibration for entity resolution.
   */
  async getCalibration(schema: string, rule: string): Promise<{
    precision: number;
    confidence: number;
    contributorCount: number;
  } | null> {
    const results = await this.calibrate({ domain: 'identity', context: schema, strategy: rule });
    if (!results || results.length === 0) return null;
    return {
      precision: results[0].successRate,
      confidence: results[0].confidence,
      contributorCount: results[0].contributions,
    };
  }
}
