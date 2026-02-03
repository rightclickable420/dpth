/**
 * dpth.io Embedding System
 * 
 * Everything in dpth.io can be embedded for semantic search.
 * Find similar entities, metrics, and patterns without explicit joins.
 * 
 * "What metrics behave like churn?"
 * "Find entities similar to our best customers"
 * "What patterns look like this anomaly?"
 */

import { Embedding, Entity, Metric, Pattern, SimilarityQuery } from './types';

// ─── Embedding Store ─────────────────────────────────

const embeddings = new Map<string, Embedding>();

// ─── Text Generation for Embedding ───────────────────

/**
 * Generate text representation of an entity for embedding
 */
export function entityToText(entity: Entity): string {
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
 * Generate text representation of a metric for embedding
 */
export function metricToText(metric: Metric): string {
  const parts = [
    `metric: ${metric.name}`,
    metric.unit ? `measured in ${metric.unit}` : '',
    `aggregated by ${metric.aggregation}`,
  ];
  
  // Add summary statistics
  if (metric.points.length > 0) {
    const values = metric.points.map(p => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    
    parts.push(`ranges from ${min.toFixed(2)} to ${max.toFixed(2)}`);
    parts.push(`average ${avg.toFixed(2)}`);
    parts.push(`${metric.points.length} data points`);
  }
  
  return parts.filter(p => p).join('. ');
}

/**
 * Generate text representation of a pattern for embedding
 */
export function patternToText(pattern: Pattern): string {
  return `${pattern.type} pattern: ${pattern.summary}. ${pattern.explanation || ''}`;
}

// ─── Embedding Generation ────────────────────────────

/**
 * Simple bag-of-words embedding (placeholder for real embeddings)
 * 
 * In production, this would call an embedding API (OpenAI, Cohere, etc.)
 * or use a local model. For now, we use TF-IDF-like vectors.
 */
function generateEmbedding(text: string): number[] {
  // Tokenize and normalize
  const tokens = text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);
  
  // Create a simple hash-based embedding (384 dimensions like many real models)
  const dimensions = 384;
  const vector = new Array(dimensions).fill(0);
  
  for (const token of tokens) {
    // Hash token to dimension indices
    const hash1 = simpleHash(token) % dimensions;
    const hash2 = simpleHash(token + '_2') % dimensions;
    const hash3 = simpleHash(token + '_3') % dimensions;
    
    // Add contribution (simulating learned embeddings)
    vector[hash1] += 1;
    vector[hash2] += 0.5;
    vector[hash3] += 0.25;
  }
  
  // Normalize to unit vector
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (magnitude > 0) {
    for (let i = 0; i < dimensions; i++) {
      vector[i] /= magnitude;
    }
  }
  
  return vector;
}

/**
 * Simple string hash function
 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

// ─── Embedding CRUD ──────────────────────────────────

/**
 * Embed an entity
 */
export function embedEntity(entity: Entity): Embedding {
  const text = entityToText(entity);
  const vector = generateEmbedding(text);
  
  const embedding: Embedding = {
    id: entity.id,
    type: 'entity',
    vector,
    text,
    updatedAt: new Date(),
  };
  
  embeddings.set(`entity:${entity.id}`, embedding);
  return embedding;
}

/**
 * Embed a metric
 */
export function embedMetric(metric: Metric): Embedding {
  const text = metricToText(metric);
  const vector = generateEmbedding(text);
  
  const embedding: Embedding = {
    id: metric.id,
    type: 'metric',
    vector,
    text,
    updatedAt: new Date(),
  };
  
  embeddings.set(`metric:${metric.id}`, embedding);
  return embedding;
}

/**
 * Embed a pattern
 */
export function embedPattern(pattern: Pattern): Embedding {
  const text = patternToText(pattern);
  const vector = generateEmbedding(text);
  
  const embedding: Embedding = {
    id: pattern.id,
    type: 'pattern',
    vector,
    text,
    updatedAt: new Date(),
  };
  
  embeddings.set(`pattern:${pattern.id}`, embedding);
  return embedding;
}

/**
 * Embed arbitrary text (for queries)
 */
export function embedText(text: string): number[] {
  return generateEmbedding(text);
}

// ─── Similarity Search ───────────────────────────────

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  
  return dotProduct / denominator;
}

export interface SimilarityResult {
  id: string;
  type: 'entity' | 'metric' | 'pattern';
  score: number;
  text: string;
}

/**
 * Find similar items by ID
 */
export function findSimilar(query: SimilarityQuery): SimilarityResult[] {
  const key = `${query.type}:${query.id}`;
  const queryEmbedding = embeddings.get(key);
  
  if (!queryEmbedding) return [];
  
  return findSimilarByVector(
    queryEmbedding.vector,
    query.type,
    query.minScore,
    query.limit,
    query.id // Exclude self
  );
}

/**
 * Find similar items by text query
 */
export function searchByText(
  text: string,
  type?: 'entity' | 'metric' | 'pattern',
  minScore: number = 0.3,
  limit: number = 10
): SimilarityResult[] {
  const queryVector = embedText(text);
  return findSimilarByVector(queryVector, type, minScore, limit);
}

/**
 * Find similar items by vector
 */
function findSimilarByVector(
  queryVector: number[],
  type?: 'entity' | 'metric' | 'pattern',
  minScore: number = 0.3,
  limit: number = 10,
  excludeId?: string
): SimilarityResult[] {
  const results: SimilarityResult[] = [];
  
  for (const [key, embedding] of embeddings) {
    // Filter by type if specified
    if (type && embedding.type !== type) continue;
    
    // Exclude self
    if (excludeId && embedding.id === excludeId) continue;
    
    const score = cosineSimilarity(queryVector, embedding.vector);
    
    if (score >= minScore) {
      results.push({
        id: embedding.id,
        type: embedding.type,
        score,
        text: embedding.text,
      });
    }
  }
  
  // Sort by score descending
  results.sort((a, b) => b.score - a.score);
  
  return results.slice(0, limit);
}

/**
 * Get embedding by key
 */
export function getEmbedding(type: 'entity' | 'metric' | 'pattern', id: string): Embedding | undefined {
  return embeddings.get(`${type}:${id}`);
}

/**
 * Get embedding stats
 */
export function getEmbeddingStats(): { total: number; byType: Record<string, number> } {
  const byType: Record<string, number> = { entity: 0, metric: 0, pattern: 0 };
  
  for (const embedding of embeddings.values()) {
    byType[embedding.type]++;
  }
  
  return {
    total: embeddings.size,
    byType,
  };
}

/**
 * Clear all embeddings (for testing)
 */
export function clearEmbeddings(): void {
  embeddings.clear();
}

// ─── Batch Operations ────────────────────────────────

/**
 * Re-embed all entities (useful after model upgrade)
 */
export async function reembedAllEntities(
  entities: Entity[],
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  for (let i = 0; i < entities.length; i++) {
    embedEntity(entities[i]);
    onProgress?.(i + 1, entities.length);
  }
}

/**
 * Re-embed all metrics
 */
export async function reembedAllMetrics(
  metrics: Metric[],
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  for (let i = 0; i < metrics.length; i++) {
    embedMetric(metrics[i]);
    onProgress?.(i + 1, metrics.length);
  }
}
