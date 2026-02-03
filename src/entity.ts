/**
 * dpth.io Entity System
 * 
 * Unified identity across all data sources. The same person in Salesforce,
 * Slack, GitHub, and your HR system is ONE entity in dpth.io.
 * 
 * Key concepts:
 * - Entity resolution: Fuzzy matching to merge identities
 * - Source refs: Track where this entity appears
 * - Temporal attributes: Every attribute has history
 */

import crypto from 'crypto';
import {
  Entity,
  EntityId,
  EntityType,
  SourceRef,
  SourceId,
  TemporalValue,
} from './types.js';

// ─── Entity Store ────────────────────────────────────

/** In-memory entity store (will be persisted later) */
const entities = new Map<EntityId, Entity>();
const sourceIndex = new Map<string, EntityId>(); // "sourceId:externalId" → entityId

/** Generate a unique entity ID */
function generateEntityId(): EntityId {
  return `ent_${crypto.randomBytes(12).toString('hex')}`;
}

/** Create index key for source lookup */
function sourceKey(sourceId: SourceId, externalId: string): string {
  return `${sourceId}:${externalId}`;
}

// ─── Entity CRUD ─────────────────────────────────────

/**
 * Create a new entity
 */
export function createEntity(
  type: EntityType,
  name: string,
  sourceId: SourceId,
  externalId: string,
  attributes?: Record<string, unknown>
): Entity {
  const id = generateEntityId();
  const now = new Date();

  const entity: Entity = {
    id,
    type,
    name,
    aliases: [],
    sources: [{
      sourceId,
      externalId,
      confidence: 1.0,
      lastSeen: now,
    }],
    attributes: {},
    createdAt: now,
    updatedAt: now,
  };

  // Convert attributes to temporal values
  if (attributes) {
    for (const [key, value] of Object.entries(attributes)) {
      entity.attributes[key] = {
        current: value,
        history: [{
          value,
          validFrom: now,
          validTo: null,
          source: sourceId,
        }],
      };
    }
  }

  // Store and index
  entities.set(id, entity);
  sourceIndex.set(sourceKey(sourceId, externalId), id);

  return entity;
}

/**
 * Find entity by ID
 */
export function getEntity(id: EntityId): Entity | undefined {
  return entities.get(id);
}

/**
 * Find entity by source reference
 */
export function findEntityBySource(sourceId: SourceId, externalId: string): Entity | undefined {
  const entityId = sourceIndex.get(sourceKey(sourceId, externalId));
  return entityId ? entities.get(entityId) : undefined;
}

/**
 * Update an entity's attribute (temporal update)
 */
export function updateEntityAttribute(
  entityId: EntityId,
  key: string,
  value: unknown,
  sourceId: SourceId
): Entity | undefined {
  const entity = entities.get(entityId);
  if (!entity) return undefined;

  const now = new Date();
  const existing = entity.attributes[key];

  if (existing) {
    // Close the current history entry
    const currentHistory = existing.history.find(h => h.validTo === null);
    if (currentHistory) {
      currentHistory.validTo = now;
    }
    // Add new entry
    existing.history.push({
      value,
      validFrom: now,
      validTo: null,
      source: sourceId,
    });
    existing.current = value;
  } else {
    // New attribute
    entity.attributes[key] = {
      current: value,
      history: [{
        value,
        validFrom: now,
        validTo: null,
        source: sourceId,
      }],
    };
  }

  entity.updatedAt = now;
  return entity;
}

// ─── Entity Resolution ───────────────────────────────

interface MatchCandidate {
  entity: Entity;
  score: number;
  matchedOn: string[];
}

/**
 * Find potential matches for a new record
 */
export function findMatches(
  type: EntityType,
  name: string,
  email?: string,
  aliases?: string[]
): MatchCandidate[] {
  const candidates: MatchCandidate[] = [];
  const searchTerms = [name.toLowerCase(), ...(aliases || []).map(a => a.toLowerCase())];
  if (email) searchTerms.push(email.toLowerCase());

  for (const entity of entities.values()) {
    if (entity.type !== type) continue;

    const matchedOn: string[] = [];
    let score = 0;

    // Check name
    const entityName = entity.name.toLowerCase();
    if (entityName === name.toLowerCase()) {
      score += 0.8; // Exact name match is strong signal
      matchedOn.push('exact_name');
    } else if (fuzzyMatch(entityName, name.toLowerCase()) > 0.85) {
      score += 0.5;
      matchedOn.push('fuzzy_name');
    } else if (fuzzyMatch(entityName, name.toLowerCase()) > 0.7) {
      score += 0.3;
      matchedOn.push('partial_name');
    }

    // Check email attribute
    const entityEmail = entity.attributes['email']?.current as string | undefined;
    if (email && entityEmail && entityEmail.toLowerCase() === email.toLowerCase()) {
      score += 0.9; // Email is very strong signal
      matchedOn.push('email');
    }

    // Check aliases
    for (const alias of entity.aliases) {
      if (searchTerms.includes(alias.toLowerCase())) {
        score += 0.3;
        matchedOn.push('alias');
        break;
      }
    }

    if (score > 0.3) {
      candidates.push({ entity, score: Math.min(1, score), matchedOn });
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}

/**
 * Simple fuzzy string matching (Levenshtein-based similarity)
 */
function fuzzyMatch(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const matrix: number[][] = [];

  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const distance = matrix[a.length][b.length];
  const maxLen = Math.max(a.length, b.length);
  return 1 - distance / maxLen;
}

/**
 * Resolve or create: Find a matching entity or create a new one
 */
export function resolveOrCreate(
  type: EntityType,
  name: string,
  sourceId: SourceId,
  externalId: string,
  options?: {
    email?: string;
    aliases?: string[];
    attributes?: Record<string, unknown>;
    minConfidence?: number;
  }
): { entity: Entity; isNew: boolean; confidence: number } {
  // First, check if we already have this exact source reference
  const existing = findEntityBySource(sourceId, externalId);
  if (existing) {
    // Update last seen
    const sourceRef = existing.sources.find(s => s.sourceId === sourceId && s.externalId === externalId);
    if (sourceRef) sourceRef.lastSeen = new Date();
    return { entity: existing, isNew: false, confidence: 1.0 };
  }

  // Try to find matches
  const minConfidence = options?.minConfidence ?? 0.7;
  const matches = findMatches(type, name, options?.email, options?.aliases);
  
  if (matches.length > 0 && matches[0].score >= minConfidence) {
    // Merge into existing entity
    const match = matches[0];
    const entity = match.entity;
    
    // Add source reference
    entity.sources.push({
      sourceId,
      externalId,
      confidence: match.score,
      lastSeen: new Date(),
    });
    sourceIndex.set(sourceKey(sourceId, externalId), entity.id);

    // Add aliases
    if (!entity.aliases.includes(name) && entity.name !== name) {
      entity.aliases.push(name);
    }

    // Merge attributes
    if (options?.attributes) {
      for (const [key, value] of Object.entries(options.attributes)) {
        updateEntityAttribute(entity.id, key, value, sourceId);
      }
    }

    entity.updatedAt = new Date();
    return { entity, isNew: false, confidence: match.score };
  }

  // Create new entity
  const entity = createEntity(type, name, sourceId, externalId, options?.attributes);
  if (options?.aliases) {
    entity.aliases.push(...options.aliases);
  }
  
  return { entity, isNew: true, confidence: 1.0 };
}

/**
 * Manually merge two entities
 */
export function mergeEntities(keepId: EntityId, mergeId: EntityId): Entity | undefined {
  const keep = entities.get(keepId);
  const merge = entities.get(mergeId);
  if (!keep || !merge) return undefined;

  // Merge sources
  for (const source of merge.sources) {
    if (!keep.sources.find(s => s.sourceId === source.sourceId && s.externalId === source.externalId)) {
      keep.sources.push(source);
    }
    // Update source index
    sourceIndex.set(sourceKey(source.sourceId, source.externalId), keepId);
  }

  // Merge aliases
  for (const alias of merge.aliases) {
    if (!keep.aliases.includes(alias)) {
      keep.aliases.push(alias);
    }
  }
  if (!keep.aliases.includes(merge.name) && keep.name !== merge.name) {
    keep.aliases.push(merge.name);
  }

  // Merge attributes (keep latest)
  for (const [key, value] of Object.entries(merge.attributes)) {
    if (!keep.attributes[key]) {
      keep.attributes[key] = value;
    } else {
      // Merge history
      keep.attributes[key].history.push(...value.history);
      // Sort by validFrom
      keep.attributes[key].history.sort((a, b) => 
        new Date(a.validFrom).getTime() - new Date(b.validFrom).getTime()
      );
    }
  }

  // Delete merged entity
  entities.delete(mergeId);
  keep.updatedAt = new Date();

  return keep;
}

// ─── Query Helpers ───────────────────────────────────

/**
 * Get all entities of a type
 */
export function getEntitiesByType(type: EntityType): Entity[] {
  return Array.from(entities.values()).filter(e => e.type === type);
}

/**
 * Get all entities from a source
 */
export function getEntitiesBySource(sourceId: SourceId): Entity[] {
  return Array.from(entities.values()).filter(e => 
    e.sources.some(s => s.sourceId === sourceId)
  );
}

/**
 * Get entity attribute value at a specific point in time
 */
export function getAttributeAt<T>(entity: Entity, key: string, at: Date): T | undefined {
  const attr = entity.attributes[key] as TemporalValue<T> | undefined;
  if (!attr) return undefined;

  const timestamp = at.getTime();
  for (const entry of attr.history) {
    const from = new Date(entry.validFrom).getTime();
    const to = entry.validTo ? new Date(entry.validTo).getTime() : Date.now();
    if (timestamp >= from && timestamp <= to) {
      return entry.value;
    }
  }

  return undefined;
}

/**
 * Get entity count by type (for stats)
 */
export function getEntityStats(): Record<EntityType, number> {
  const stats: Record<string, number> = {};
  for (const entity of entities.values()) {
    stats[entity.type] = (stats[entity.type] || 0) + 1;
  }
  return stats as Record<EntityType, number>;
}

/**
 * Clear all entities (for testing)
 */
export function clearEntities(): void {
  entities.clear();
  sourceIndex.clear();
}
