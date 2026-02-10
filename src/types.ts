/**
 * dpth.io Core Types
 * 
 * Everything in dpth.io is built on these primitives:
 * - Entity: A thing with identity that persists across sources
 * - Metric: A measurable value with temporal history
 * - Relationship: A typed connection between entities
 * - Pattern: A discovered correlation or anomaly
 */

// ─── Entity Types ────────────────────────────────────

/** Unique identifier for an entity across the entire dpth.io instance */
export type EntityId = string;

/** Source system identifier (e.g., 'stripe', 'github', 'salesforce') */
export type SourceId = string;

/** A reference to an entity in a specific source system */
export interface SourceRef {
  sourceId: SourceId;
  externalId: string;
  confidence: number; // 0-1, how confident we are this maps to the entity
  lastSeen: Date;
}

/** Entity types we understand */
/**
 * Entity type — any string. Well-known types provided as constants.
 * Use any domain-specific type you need: 'deal', 'ticket', 'invoice', etc.
 */
export type EntityType = string;

/** Well-known entity types (convenience constants) */
export const ENTITY_TYPES = {
  person: 'person',
  company: 'company',
  product: 'product',
  project: 'project',
  team: 'team',
  location: 'location',
  event: 'event',
  metric: 'metric',
} as const;

/** Core entity — a unified identity across sources */
export interface Entity {
  id: EntityId;
  type: EntityType;
  name: string;
  aliases: string[]; // Other names this entity is known by
  sources: SourceRef[]; // Where this entity appears
  attributes: Record<string, TemporalValue<unknown>>; // All attributes are temporal
  createdAt: Date;
  updatedAt: Date;
}

// ─── Temporal Types ──────────────────────────────────

/** A value that changes over time */
export interface TemporalValue<T> {
  current: T;
  history: Array<{
    value: T;
    validFrom: Date;
    validTo: Date | null; // null = current
    source: SourceId;
  }>;
}

/** A metric data point */
export interface MetricPoint {
  timestamp: Date;
  value: number;
  source: SourceId;
  confidence: number;
}

/** A time-series metric */
export interface Metric {
  id: string;
  entityId: EntityId; // What entity this metric describes
  name: string;
  unit?: string;
  points: MetricPoint[];
  aggregation: 'sum' | 'avg' | 'min' | 'max' | 'last';
}

// ─── Relationship Types ──────────────────────────────

/** Typed relationship between entities */
export type RelationshipType =
  | 'manages'      // person → person
  | 'works_on'     // person → project
  | 'belongs_to'   // entity → team/company
  | 'owns'         // person/team → product
  | 'sells'        // company → product
  | 'buys_from'    // company → company
  | 'located_at'   // entity → location
  | 'related_to'   // generic
  | 'causes'       // metric → metric (discovered)
  | 'correlates';  // metric → metric (discovered)

/** A relationship with temporal validity */
export interface Relationship {
  id: string;
  type: RelationshipType;
  fromEntity: EntityId;
  toEntity: EntityId;
  strength: number; // 0-1
  validFrom: Date;
  validTo: Date | null;
  source: SourceId | 'dpth:inferred'; // 'dpth:inferred' for discovered relationships
  metadata?: Record<string, unknown>;
}

// ─── Pattern Types ───────────────────────────────────

/** Types of patterns dpth.io can discover */
export type PatternType =
  | 'correlation'    // Two metrics move together
  | 'causation'      // One metric predicts another with lag
  | 'anomaly'        // Unusual value or behavior
  | 'trend'          // Sustained directional movement
  | 'seasonality'    // Repeating pattern
  | 'cluster'        // Group of similar entities
  | 'outlier';       // Entity that doesn't fit its cluster

/** A discovered pattern */
export interface Pattern {
  id: string;
  type: PatternType;
  confidence: number; // 0-1
  significance: number; // Statistical significance (p-value inverse)
  
  // What's involved in this pattern
  entities: EntityId[];
  metrics: string[];
  
  // Pattern-specific data
  data: CorrelationData | AnomalyData | TrendData | ClusterData;
  
  // When this pattern was discovered and validated
  discoveredAt: Date;
  lastValidated: Date;
  validationCount: number;
  
  // Human-readable explanation
  summary: string;
  explanation?: string;
}

export interface CorrelationData {
  type: 'correlation' | 'causation';
  metricA: string;
  metricB: string;
  coefficient: number; // Pearson correlation
  lagDays: number; // 0 for correlation, >0 for causation (A leads B)
  sampleSize: number;
}

export interface AnomalyData {
  type: 'anomaly';
  metric: string;
  value: number;
  expected: number;
  stdDeviations: number;
  timestamp: Date;
}

export interface TrendData {
  type: 'trend';
  metric: string;
  direction: 'up' | 'down';
  slope: number;
  startDate: Date;
  endDate: Date;
}

export interface ClusterData {
  type: 'cluster' | 'outlier';
  entityType: EntityType;
  clusterLabel: string;
  memberCount: number;
  centroid?: number[]; // For outlier: distance from nearest centroid
}

// ─── Query Types ─────────────────────────────────────

/** Query for finding correlated metrics */
export interface CorrelationQuery {
  /** Metric to find correlations for */
  metricId: string;
  /** Minimum correlation coefficient (absolute value) */
  minCorrelation?: number;
  /** Maximum lag in days to check for causation */
  maxLagDays?: number;
  /** Time range to analyze */
  timeRange?: { start: Date; end: Date };
  /** Limit results */
  limit?: number;
}

/** Query for semantic similarity */
export interface SimilarityQuery {
  /** Entity or metric to find similar items for */
  id: string;
  /** Type of thing to search for */
  type: 'entity' | 'metric' | 'pattern';
  /** Minimum similarity score */
  minScore?: number;
  /** Limit results */
  limit?: number;
}

// ─── Type Configuration Types ────────────────────────

/** Configuration for entity type merge behavior */
export interface TypeConfig {
  /** Whether to attempt fuzzy matching for this type. Default: true */
  fuzzyMerge?: boolean;
  /** Default minimum confidence for fuzzy merges. Default: 0.7 */
  defaultMinConfidence?: number;
}

/** Common type configuration presets */
export const TYPE_PRESETS = {
  /** Types that represent unique records — no fuzzy merge */
  record: { fuzzyMerge: false } as TypeConfig,
  /** Types that represent identities — fuzzy merge enabled */
  identity: { fuzzyMerge: true, defaultMinConfidence: 0.7 } as TypeConfig,
  /** Strict identity matching — higher threshold */
  strictIdentity: { fuzzyMerge: true, defaultMinConfidence: 0.9 } as TypeConfig,
} as const;

// ─── Embedding Types ─────────────────────────────────

/** Embedding vector for semantic search */
export interface Embedding {
  id: string;
  type: 'entity' | 'metric' | 'pattern';
  vector: number[];
  text: string; // What was embedded
  updatedAt: Date;
}
