/**
 * dpth.io Network Coordinator
 * 
 * Standalone API server for the dpth agent network.
 * Uses dpth's own SQLiteAdapter for all persistence.
 * 
 * SIGNAL SECURITY MODEL:
 * - Individual signals are NEVER stored — only aggregated statistics
 * - Source registry: only recognized source identifiers in schemas
 * - Rule vocabulary: only recognized matching strategies
 * - No free-text fields — everything validated against registries
 * - No agent attribution on signals — aggregates are anonymous
 * 
 * Run: npx tsx server/index.ts
 * Deploy: pm2 start server/index.ts --interpreter npx --interpreter-args tsx --name dpth-api
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { SQLiteAdapter } from '../src/adapter-sqlite.js';
import { randomHex } from '../src/util.js';

const PORT = parseInt(process.env.DPTH_PORT || '3004');
const DB_PATH = process.env.DPTH_DB || './data/dpth-network.db';

// ── Initialize ──────────────────────────────────────

const adapter = new SQLiteAdapter(DB_PATH);
const app = new Hono();
const startTime = Date.now();

app.use('*', cors());

// ── Source Registry ─────────────────────────────────
// Only recognized sources can appear in signal schemas.
// Adding a new source is a deliberate protocol decision.

const SOURCE_REGISTRY = new Set([
  // Payment / billing
  'stripe', 'paypal', 'square', 'braintree', 'adyen',
  // Code / dev
  'github', 'gitlab', 'bitbucket', 'jira', 'linear',
  // CRM / sales
  'hubspot', 'salesforce', 'pipedrive', 'close',
  // Support
  'zendesk', 'intercom', 'freshdesk',
  // Commerce
  'shopify', 'woocommerce', 'bigcommerce',
  // Accounting
  'quickbooks', 'xero', 'freshbooks',
  // Communication
  'slack', 'discord', 'teams',
  // Analytics
  'google_analytics', 'mixpanel', 'amplitude', 'segment',
  // Auth / identity
  'auth0', 'okta', 'clerk',
  // Email / marketing
  'mailchimp', 'sendgrid', 'resend',
  // Documents
  'google_docs', 'notion', 'confluence',
  // Cloud
  'aws', 'gcp', 'azure',
  // Generic (for less common sources)
  'api', 'csv', 'database', 'webhook', 'manual',
]);

// ── Rule Vocabulary ─────────────────────────────────
// Only recognized matching rules can appear in signals.
// Each rule has defined semantic meaning.

const RULE_REGISTRY = new Set([
  // Identity matching
  'email_exact',           // Exact email match
  'email_domain',          // Same email domain
  'email_normalized',      // Normalized email (case, dots, plus-addressing)
  'name_exact',            // Exact name match
  'name_fuzzy',            // Fuzzy/similarity name match
  'name_abbreviation',     // Abbreviation matching (e.g. "Acme Corp" → "ACME Corporation")
  'phone_exact',           // Exact phone match
  'phone_normalized',      // Normalized phone (country code, formatting)
  'address_exact',         // Exact address match
  'address_normalized',    // Normalized address (abbreviations, formatting)
  'external_id',           // Shared external ID across sources
  'url_match',             // URL/domain matching
  'alias_match',           // Known alias/username matching

  // Behavioral matching
  'timing_correlation',    // Activity timing patterns
  'transaction_pattern',   // Transaction pattern similarity
]);

// ── Modifier Vocabulary ─────────────────────────────
// Conditions that affect match confidence.

const MODIFIER_REGISTRY = new Set([
  'generic_domain',        // gmail, yahoo, hotmail, etc.
  'corporate_domain',      // Company-specific email domain
  'exact',                 // Exact/precise match
  'partial',               // Partial match
  'case_insensitive',      // Match was case-insensitive
  'nickname_variant',      // Common nickname (Bob/Robert, etc.)
  'unicode_normalized',    // Unicode normalization applied
  'high_population',       // Common name (John Smith, etc.)
  'low_population',        // Uncommon/unique name
  'single_source',         // Only one source in this schema had the field
  'multi_field',           // Multiple fields contributed to this match
  'none',                  // No modifier (default)
]);

// ── Validation ──────────────────────────────────────

function validateSchema(schema: string): string | null {
  const parts = schema.split('+');
  if (parts.length !== 2) return 'Schema must be exactly two sources joined by "+"';
  const [a, b] = parts;
  if (!SOURCE_REGISTRY.has(a)) return `Unknown source: "${a}". See GET /registry for valid sources.`;
  if (!SOURCE_REGISTRY.has(b)) return `Unknown source: "${b}". See GET /registry for valid sources.`;
  if (a === b) return 'Schema must have two different sources';
  return null;
}

function validateRule(rule: string): string | null {
  if (!RULE_REGISTRY.has(rule)) return `Unknown rule: "${rule}". See GET /registry for valid rules.`;
  return null;
}

function validateModifier(modifier: string | undefined): string | null {
  if (!modifier || modifier === 'none') return null;
  if (!MODIFIER_REGISTRY.has(modifier)) return `Unknown modifier: "${modifier}". See GET /registry for valid modifiers.`;
  return null;
}

// ── Types ───────────────────────────────────────────

interface Agent {
  id: string;
  publicKey: string;
  capabilities: {
    storageCapacityMb: number;
    cpuCores: number;
    hasGpu: boolean;
    gpuVramMb?: number;
    models?: string[];
  };
  status: 'online' | 'offline' | 'busy';
  lastSeen: Date;
  registeredAt: Date;
  reputation: number;
  tier: string;
}

interface Task {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'claimed' | 'completed' | 'failed';
  createdBy: string;
  claimedBy?: string;
  createdAt: Date;
  completedAt?: Date;
  result?: unknown;
}

interface CreditBalance {
  agentId: string;
  balance: number;
  totalEarned: number;
  totalSpent: number;
  tier: string;
}

/**
 * Aggregate signal bucket — the ONLY thing stored.
 * Individual signals are folded in and discarded.
 * No agent attribution, no individual data points.
 */
interface SignalBucket {
  /** Canonical key: "stripe+github:email_exact:generic_domain" */
  id: string;
  schema: string;
  rule: string;
  modifier: string;
  /** Total resolution attempts folded into this bucket */
  attempts: number;
  /** Running total of true positives */
  truePositives: number;
  /** Running total of false positives */
  falsePositives: number;
  /** Computed: truePositives / attempts */
  precision: number;
  /** Computed: falsePositives / attempts */
  falseMergeRate: number;
  /** Number of independent contributions (not stored per-agent, just count) */
  contributions: number;
  /** First signal received */
  firstSeen: Date;
  /** Last signal received */
  lastUpdated: Date;
}

// ── Helpers ──────────────────────────────────────────

async function ensureReady() {
  await adapter.get('_init', '_init');
}

function bucketKey(schema: string, rule: string, modifier?: string): string {
  // Normalize schema to alphabetical order: "github+stripe" → "github+stripe"
  const parts = schema.split('+').sort();
  return `${parts.join('+')}:${rule}:${modifier || 'none'}`;
}

// ── Routes: Status ──────────────────────────────────

app.get('/', async (c) => {
  await ensureReady();
  
  const agents = await adapter.query({ collection: 'agents' }) as Agent[];
  const tasks = await adapter.query({ collection: 'tasks' }) as Task[];
  const buckets = await adapter.query({ collection: 'signal_buckets' }) as SignalBucket[];
  
  const online = agents.filter(a => a.status === 'online').length;
  const uptimeH = Math.floor((Date.now() - startTime) / 3600000);
  
  return c.json({
    network: {
      name: 'dpth.io',
      version: '0.4.0',
      uptime: `${uptimeH}h`,
      coordinator: 'api.dpth.io',
    },
    agents: {
      total: agents.length,
      online,
      totalStorageMb: agents.reduce((s, a) => s + (a.capabilities?.storageCapacityMb || 0), 0),
      totalGpuAgents: agents.filter(a => a.capabilities?.hasGpu).length,
    },
    tasks: {
      pending: tasks.filter(t => t.status === 'pending').length,
      claimed: tasks.filter(t => t.status === 'claimed').length,
      completed: tasks.filter(t => t.status === 'completed').length,
    },
    intelligence: {
      buckets: buckets.length,
      schemas: [...new Set(buckets.map(b => b.schema))].length,
      totalAttempts: buckets.reduce((s, b) => s + b.attempts, 0),
      totalContributions: buckets.reduce((s, b) => s + b.contributions, 0),
      avgPrecision: buckets.length > 0
        ? Math.round(
            buckets.reduce((s, b) => s + b.precision * b.attempts, 0) /
            buckets.reduce((s, b) => s + b.attempts, 0) * 1000
          ) / 1000
        : null,
    },
    security: {
      model: 'aggregate-only',
      individualSignalsStored: false,
      agentAttribution: false,
      sourceRegistry: SOURCE_REGISTRY.size,
      ruleVocabulary: RULE_REGISTRY.size,
      modifierVocabulary: MODIFIER_REGISTRY.size,
    },
  });
});

// ── Routes: Registry ────────────────────────────────
// Public: what sources, rules, and modifiers are recognized

app.get('/registry', (c) => {
  return c.json({
    sources: [...SOURCE_REGISTRY].sort(),
    rules: [...RULE_REGISTRY].sort(),
    modifiers: [...MODIFIER_REGISTRY].sort(),
    schemaFormat: '{source}+{source} (alphabetically sorted)',
    note: 'Signals with unrecognized values are rejected. To propose new entries, see PROTOCOL.md.',
  });
});

// ── Routes: Agents ──────────────────────────────────

app.post('/agents', async (c) => {
  await ensureReady();
  const body = await c.req.json();
  
  const agent: Agent = {
    id: `agent_${randomHex(16)}`,
    publicKey: body.publicKey || '',
    capabilities: body.capabilities || { storageCapacityMb: 0, cpuCores: 1, hasGpu: false },
    status: 'online',
    lastSeen: new Date(),
    registeredAt: new Date(),
    reputation: 0,
    tier: 'newcomer',
  };
  
  await adapter.put('agents', agent.id, agent);
  
  // Initialize credit balance
  const balance: CreditBalance = {
    agentId: agent.id,
    balance: 10,
    totalEarned: 10,
    totalSpent: 0,
    tier: 'newcomer',
  };
  await adapter.put('credits', agent.id, balance);
  
  return c.json({ agent, credits: balance }, 201);
});

app.get('/agents', async (c) => {
  await ensureReady();
  const agents = await adapter.query({ collection: 'agents' }) as Agent[];
  return c.json({ agents, count: agents.length });
});

app.post('/agents/:id/heartbeat', async (c) => {
  await ensureReady();
  const id = c.req.param('id');
  const agent = await adapter.get('agents', id) as Agent | undefined;
  if (!agent) return c.json({ error: 'Agent not found' }, 404);
  
  agent.lastSeen = new Date();
  agent.status = 'online';
  await adapter.put('agents', id, agent);
  
  return c.json({ ok: true });
});

// ── Routes: Tasks ───────────────────────────────────

app.post('/tasks', async (c) => {
  await ensureReady();
  const body = await c.req.json();
  
  const task: Task = {
    id: `task_${randomHex(12)}`,
    type: body.type || 'generic',
    payload: body.payload || {},
    status: 'pending',
    createdBy: body.agentId || 'anonymous',
    createdAt: new Date(),
  };
  
  await adapter.put('tasks', task.id, task);
  return c.json({ task }, 201);
});

app.get('/tasks', async (c) => {
  await ensureReady();
  const status = c.req.query('status');
  
  const tasks = await adapter.query({
    collection: 'tasks',
    ...(status ? { where: { status } } : {}),
  }) as Task[];
  
  return c.json({ tasks, count: tasks.length });
});

app.post('/tasks/:id/claim', async (c) => {
  await ensureReady();
  const id = c.req.param('id');
  const body = await c.req.json();
  
  const task = await adapter.get('tasks', id) as Task | undefined;
  if (!task) return c.json({ error: 'Task not found' }, 404);
  if (task.status !== 'pending') return c.json({ error: 'Task already claimed' }, 409);
  
  task.status = 'claimed';
  task.claimedBy = body.agentId;
  await adapter.put('tasks', id, task);
  
  return c.json({ task });
});

app.post('/tasks/:id/complete', async (c) => {
  await ensureReady();
  const id = c.req.param('id');
  const body = await c.req.json();
  
  const task = await adapter.get('tasks', id) as Task | undefined;
  if (!task) return c.json({ error: 'Task not found' }, 404);
  
  task.status = 'completed';
  task.completedAt = new Date();
  task.result = body.result;
  await adapter.put('tasks', id, task);
  
  // Reward the completing agent
  if (task.claimedBy) {
    const credits = await adapter.get('credits', task.claimedBy) as CreditBalance | undefined;
    if (credits) {
      const reward = body.reward || 5;
      credits.balance += reward;
      credits.totalEarned += reward;
      await adapter.put('credits', task.claimedBy, credits);
    }
  }
  
  return c.json({ task });
});

// ── Routes: Credits ─────────────────────────────────

app.get('/credits/:agentId', async (c) => {
  await ensureReady();
  const agentId = c.req.param('agentId');
  const credits = await adapter.get('credits', agentId) as CreditBalance | undefined;
  if (!credits) return c.json({ error: 'Agent not found' }, 404);
  return c.json(credits);
});

app.get('/credits', async (c) => {
  await ensureReady();
  const all = await adapter.query({ collection: 'credits' }) as CreditBalance[];
  const sorted = all.sort((a, b) => b.totalEarned - a.totalEarned);
  return c.json({
    leaderboard: sorted.slice(0, 50),
    networkSupply: all.reduce((s, cb) => s + cb.balance, 0),
    totalMinted: all.reduce((s, cb) => s + cb.totalEarned, 0),
    totalBurned: all.reduce((s, cb) => s + cb.totalSpent, 0),
  });
});

// ── Routes: Resolution Signals (The Waze Layer) ─────
//
// SECURITY: Individual signals are NEVER stored.
// Incoming signals are validated, folded into aggregate
// buckets, and discarded. The bucket stores only:
//   { attempts, truePositives, falsePositives, contributions }
// No agent IDs, no individual data points, no PII.

app.post('/signals', async (c) => {
  await ensureReady();
  const body = await c.req.json();
  
  // ── Validate all fields against registries ──
  if (!body.schema || !body.rule) {
    return c.json({ error: 'schema and rule are required' }, 400);
  }
  
  const schemaErr = validateSchema(body.schema);
  if (schemaErr) return c.json({ error: schemaErr }, 400);
  
  const ruleErr = validateRule(body.rule);
  if (ruleErr) return c.json({ error: ruleErr }, 400);
  
  const modErr = validateModifier(body.modifier);
  if (modErr) return c.json({ error: modErr }, 400);
  
  // Validate numeric bounds
  const truePos = Math.max(0, Math.floor(body.truePositives || 0));
  const falsePos = Math.max(0, Math.floor(body.falsePositives || 0));
  const attempts = Math.max(0, Math.floor(body.totalAttempts || 0));
  
  if (attempts === 0) {
    return c.json({ error: 'totalAttempts must be > 0' }, 400);
  }
  if (truePos + falsePos > attempts) {
    return c.json({ error: 'truePositives + falsePositives cannot exceed totalAttempts' }, 400);
  }
  if (attempts > 100000) {
    return c.json({ error: 'totalAttempts capped at 100,000 per signal submission' }, 400);
  }
  
  // ── Fold into aggregate bucket (no individual storage) ──
  const key = bucketKey(body.schema, body.rule, body.modifier);
  const normalizedSchema = body.schema.split('+').sort().join('+');
  const modifier = body.modifier || 'none';
  
  let bucket = await adapter.get('signal_buckets', key) as SignalBucket | undefined;
  
  if (bucket) {
    // Fold signal into existing bucket
    bucket.attempts += attempts;
    bucket.truePositives += truePos;
    bucket.falsePositives += falsePos;
    bucket.precision = bucket.attempts > 0 ? bucket.truePositives / bucket.attempts : 0;
    bucket.falseMergeRate = bucket.attempts > 0 ? bucket.falsePositives / bucket.attempts : 0;
    bucket.contributions += 1;
    bucket.lastUpdated = new Date();
  } else {
    // Create new bucket
    bucket = {
      id: key,
      schema: normalizedSchema,
      rule: body.rule,
      modifier,
      attempts,
      truePositives: truePos,
      falsePositives: falsePos,
      precision: attempts > 0 ? truePos / attempts : 0,
      falseMergeRate: attempts > 0 ? falsePos / attempts : 0,
      contributions: 1,
      firstSeen: new Date(),
      lastUpdated: new Date(),
    };
  }
  
  await adapter.put('signal_buckets', key, bucket);
  
  // Reward the contributing agent (credits only, no signal attribution)
  if (body.agentId) {
    const credits = await adapter.get('credits', body.agentId) as CreditBalance | undefined;
    if (credits) {
      const reward = Math.min(attempts * 0.01, 10);
      credits.balance += reward;
      credits.totalEarned += reward;
      await adapter.put('credits', body.agentId, credits);
    }
  }
  
  // Return the aggregate (not the individual signal — it doesn't exist)
  return c.json({
    accepted: true,
    bucket: {
      schema: bucket.schema,
      rule: bucket.rule,
      modifier: bucket.modifier,
      precision: Math.round(bucket.precision * 1000) / 1000,
      falseMergeRate: Math.round(bucket.falseMergeRate * 1000) / 1000,
      attempts: bucket.attempts,
      contributions: bucket.contributions,
    },
  }, 201);
});

app.get('/signals', async (c) => {
  await ensureReady();
  const schema = c.req.query('schema');
  const rule = c.req.query('rule');
  
  let buckets = await adapter.query({ collection: 'signal_buckets' }) as SignalBucket[];
  
  if (schema) {
    const normalized = schema.split('+').sort().join('+');
    buckets = buckets.filter(b => b.schema === normalized);
  }
  if (rule) {
    buckets = buckets.filter(b => b.rule === rule);
  }
  
  return c.json({
    buckets: buckets.map(b => ({
      schema: b.schema,
      rule: b.rule,
      modifier: b.modifier,
      precision: Math.round(b.precision * 1000) / 1000,
      falseMergeRate: Math.round(b.falseMergeRate * 1000) / 1000,
      attempts: b.attempts,
      contributions: b.contributions,
      lastUpdated: b.lastUpdated,
    })),
    count: buckets.length,
  });
});

// Calibration endpoint — agents ask "how well does this rule work?"
app.get('/signals/calibrate', async (c) => {
  await ensureReady();
  const schema = c.req.query('schema');
  const rule = c.req.query('rule');
  const modifier = c.req.query('modifier');
  
  if (!schema || !rule) {
    return c.json({ error: 'schema and rule query params required' }, 400);
  }
  
  const key = bucketKey(schema, rule, modifier);
  const bucket = await adapter.get('signal_buckets', key) as SignalBucket | undefined;
  
  if (!bucket) {
    // No data for this combination — try without modifier
    const baseKey = bucketKey(schema, rule, 'none');
    const baseBucket = await adapter.get('signal_buckets', baseKey) as SignalBucket | undefined;
    
    if (!baseBucket) {
      return c.json({
        calibration: null,
        message: 'No signals for this combination. Your agent is the first — contribute!',
      });
    }
    
    return c.json({
      calibration: {
        schema: baseBucket.schema,
        rule: baseBucket.rule,
        modifier: 'none',
        precision: Math.round(baseBucket.precision * 1000) / 1000,
        falseMergeRate: Math.round(baseBucket.falseMergeRate * 1000) / 1000,
        confidence: Math.min(baseBucket.attempts / 1000, 1),
        attempts: baseBucket.attempts,
        contributions: baseBucket.contributions,
      },
      note: `No data for modifier "${modifier || 'none'}", returning base rule stats.`,
    });
  }
  
  return c.json({
    calibration: {
      schema: bucket.schema,
      rule: bucket.rule,
      modifier: bucket.modifier,
      precision: Math.round(bucket.precision * 1000) / 1000,
      falseMergeRate: Math.round(bucket.falseMergeRate * 1000) / 1000,
      confidence: Math.min(bucket.attempts / 1000, 1),
      attempts: bucket.attempts,
      contributions: bucket.contributions,
    },
  });
});

// ── Start ───────────────────────────────────────────

console.log(`dpth.io coordinator starting on port ${PORT}...`);

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`✓ dpth.io network coordinator live at http://localhost:${PORT}`);
  console.log(`  Database: ${DB_PATH}`);
  console.log(`  Security: aggregate-only signals, ${SOURCE_REGISTRY.size} sources, ${RULE_REGISTRY.size} rules, ${MODIFIER_REGISTRY.size} modifiers`);
  console.log(`  Endpoints: /, /registry, /agents, /tasks, /credits, /signals, /signals/calibrate`);
});
