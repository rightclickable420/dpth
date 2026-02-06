/**
 * dpth.io Shape Router
 * 
 * Routes incoming data to the appropriate pipeline based on its shape.
 * Shape detection is based on the presence of specific field combinations.
 * 
 * Pipelines:
 * - Aggregate: Folds data into statistical buckets (signals)
 * - Individual: Stores each record (entities)  
 * - Append: Keeps all versions (temporal)
 */

// ─── Shape Definitions ───────────────────────────────

/**
 * Signal shape — for Waze-style crowdsourced calibration
 * Pipeline: Aggregate (fold into buckets, discard individuals)
 */
export interface SignalShape {
  context: string;      // The situation (e.g., "stripe", "github+jira")
  strategy: string;     // What approach was tried (e.g., "retry_60s", "email_match")
  outcome: number;      // 0.0-1.0 scale (success/failure/partial)
  condition?: string;   // Optional modifier (e.g., "peak_hours", "generic_domain")
  cost?: number;        // Optional cost in tokens/ms/calls
  domain?: string;      // Optional domain override (default: inferred)
}

/**
 * Entity shape — for identity resolution
 * Pipeline: Individual (store each record, merge matches)
 */
export interface EntityShape {
  type: string;         // Entity type (e.g., "person", "company")
  name: string;         // Display name
  source: string;       // Source system (e.g., "stripe", "github")
  externalId: string;   // ID in the source system
  email?: string;       // For matching
  aliases?: string[];   // Alternative names
  attributes?: Record<string, unknown>;
}

/**
 * Temporal shape — for time-series history
 * Pipeline: Append (keep all versions, never overwrite)
 */
export interface TemporalShape {
  key: string;          // What we're tracking (e.g., "mrr", "user_count")
  value: unknown;       // The value (number, object, etc.)
  timestamp?: number;   // Optional timestamp (default: now)
  source?: string;      // Optional source identifier
}

/**
 * Correlation shape — for relationship tracking
 * Pipeline: Append + Compute (store points, compute relationships)
 */
export interface CorrelationShape {
  metric: string;       // Metric name
  value: number;        // Numeric value
  timestamp?: number;   // Optional timestamp
}

// ─── Pipeline Types ──────────────────────────────────

export type PipelineType = 'aggregate' | 'individual' | 'append' | 'compute';

export interface RouteResult {
  pipeline: PipelineType;
  shape: 'signal' | 'entity' | 'temporal' | 'correlation';
  data: SignalShape | EntityShape | TemporalShape | CorrelationShape;
}

// ─── Shape Detection ─────────────────────────────────

/**
 * Detect the shape of incoming data based on field presence.
 * 
 * Priority order (first match wins):
 * 1. Signal: has context + strategy + outcome
 * 2. Entity: has type + name + source + externalId
 * 3. Temporal: has key + value
 * 4. Correlation: has metric + value (numeric)
 */
export function detectShape(data: Record<string, unknown>): RouteResult | null {
  // Signal shape: context + strategy + outcome
  if (
    typeof data.context === 'string' &&
    typeof data.strategy === 'string' &&
    (typeof data.outcome === 'number' || typeof data.outcome === 'boolean')
  ) {
    return {
      pipeline: 'aggregate',
      shape: 'signal',
      data: normalizeSignal(data),
    };
  }

  // Entity shape: type + name + source + externalId
  if (
    typeof data.type === 'string' &&
    typeof data.name === 'string' &&
    typeof data.source === 'string' &&
    typeof data.externalId === 'string'
  ) {
    return {
      pipeline: 'individual',
      shape: 'entity',
      data: {
        type: data.type,
        name: data.name,
        source: data.source,
        externalId: data.externalId,
        email: typeof data.email === 'string' ? data.email : undefined,
        aliases: Array.isArray(data.aliases) ? data.aliases as string[] : undefined,
        attributes: typeof data.attributes === 'object' ? data.attributes as Record<string, unknown> : undefined,
      } as EntityShape,
    };
  }

  // Temporal shape: key + value
  if (
    typeof data.key === 'string' &&
    'value' in data
  ) {
    return {
      pipeline: 'append',
      shape: 'temporal',
      data: {
        key: data.key as string,
        value: data.value,
        timestamp: typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
        source: typeof data.source === 'string' ? data.source : undefined,
      },
    };
  }

  // Correlation shape: metric + value (numeric)
  if (
    typeof data.metric === 'string' &&
    typeof data.value === 'number'
  ) {
    return {
      pipeline: 'compute',
      shape: 'correlation',
      data: {
        metric: data.metric as string,
        value: data.value as number,
        timestamp: typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
      },
    };
  }

  return null;
}

// ─── Normalization ───────────────────────────────────

/**
 * Normalize a signal for consistency:
 * - Lowercase all string fields
 * - Convert boolean outcome to number
 * - Sort context if it contains + (alphabetize sources)
 */
function normalizeSignal(data: Record<string, unknown>): SignalShape {
  let context = String(data.context).toLowerCase().trim();
  
  // Alphabetize multi-source contexts (stripe+github → github+stripe)
  if (context.includes('+')) {
    context = context.split('+').sort().join('+');
  }

  const strategy = String(data.strategy).toLowerCase().trim().replace(/\s+/g, '_');
  
  // Convert boolean outcome to number
  let outcome: number;
  if (typeof data.outcome === 'boolean') {
    outcome = data.outcome ? 1.0 : 0.0;
  } else {
    outcome = Math.max(0, Math.min(1, Number(data.outcome)));
  }

  const condition = data.condition 
    ? String(data.condition).toLowerCase().trim().replace(/\s+/g, '_')
    : undefined;

  const domain = data.domain
    ? String(data.domain).toLowerCase().trim()
    : inferDomain(context, strategy);

  return {
    context,
    strategy,
    outcome,
    condition,
    cost: typeof data.cost === 'number' ? data.cost : undefined,
    domain,
  };
}

/**
 * Infer domain from context and strategy if not provided.
 */
function inferDomain(context: string, strategy: string): string {
  // Identity-related
  if (
    strategy.includes('match') ||
    strategy.includes('merge') ||
    strategy.includes('resolve') ||
    context.includes('+')  // Multi-source usually means identity
  ) {
    return 'identity';
  }

  // API-related
  if (
    context.includes('api') ||
    strategy.includes('retry') ||
    strategy.includes('timeout') ||
    strategy.includes('rate_limit')
  ) {
    return 'api';
  }

  // Tool-related
  if (
    strategy.includes('fetch') ||
    strategy.includes('search') ||
    strategy.includes('scrape') ||
    strategy.includes('browser')
  ) {
    return 'tool';
  }

  // Recovery-related
  if (
    strategy.includes('recover') ||
    strategy.includes('fallback') ||
    strategy.includes('retry')
  ) {
    return 'recovery';
  }

  // Default
  return 'general';
}

// ─── Validation ──────────────────────────────────────

export class ShapeValidationError extends Error {
  constructor(message: string, public data: unknown) {
    super(message);
    this.name = 'ShapeValidationError';
  }
}

/**
 * Validate that data matches a known shape.
 * Throws ShapeValidationError if no shape matches.
 */
export function validateShape(data: unknown): RouteResult {
  if (typeof data !== 'object' || data === null) {
    throw new ShapeValidationError(
      'Data must be an object',
      data
    );
  }

  const result = detectShape(data as Record<string, unknown>);
  
  if (!result) {
    throw new ShapeValidationError(
      'Data does not match any known shape. Expected one of:\n' +
      '- Signal: { context, strategy, outcome }\n' +
      '- Entity: { type, name, source, externalId }\n' +
      '- Temporal: { key, value }\n' +
      '- Correlation: { metric, value }',
      data
    );
  }

  return result;
}
