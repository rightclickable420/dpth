/**
 * dpth.io Network Coordinator
 * 
 * Standalone API server for the dpth agent network.
 * Uses dpth's own SQLiteAdapter for all persistence.
 * 
 * SIGNAL SECURITY MODEL:
 * - Individual signals are NEVER stored — only aggregated statistics
 * - Open vocabulary — agents submit any domain/context/strategy/condition
 * - No free-text data fields — just categorical keys + numeric outcomes
 * - No agent attribution on signals — aggregates are anonymous
 * 
 * OPEN SIGNAL FORMAT:
 * Agents report: { domain, context, strategy, condition?, outcome, cost? }
 * The coordinator aggregates into buckets. No validation against closed enums.
 * The network learns what works from what agents actually report.
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

// ── Validation (safety only, not vocabulary) ────────
// We validate format, not content. Agents can submit any terms.

const MAX_FIELD_LENGTH = 128;
const MAX_ATTEMPTS_PER_SIGNAL = 100000;

function validateStringField(value: unknown, name: string): string | null {
  if (typeof value !== 'string') return `${name} must be a string`;
  if (value.length === 0) return `${name} cannot be empty`;
  if (value.length > MAX_FIELD_LENGTH) return `${name} exceeds ${MAX_FIELD_LENGTH} chars`;
  // Only allow printable ASCII + limited punctuation — no injection vectors
  if (!/^[a-zA-Z0-9_.\-+:/ ]+$/.test(value)) return `${name} contains invalid characters (alphanumeric, _, ., -, +, :, / only)`;
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
  /** Canonical key: "identity:stripe+github:email_match:generic_domain" */
  id: string;
  /** Task domain: identity, tool, api, recovery, quality, or anything agents submit */
  domain: string;
  /** Context: what was the situation (e.g., source pair, task type) */
  context: string;
  /** Strategy: what approach was tried */
  strategy: string;
  /** Condition: modifier on the context (e.g., "generic_domain", "peak_hours") */
  condition: string;
  /** Total attempts folded into this bucket */
  attempts: number;
  /** Successes (true positives, correct outcomes) */
  successes: number;
  /** Failures (false positives, incorrect outcomes) */
  failures: number;
  /** Computed: successes / attempts */
  successRate: number;
  /** Computed: failures / attempts */
  failureRate: number;
  /** Total cost units reported (tokens, ms, API calls — agent-defined) */
  totalCost: number;
  /** Number of independent contributions */
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

function bucketKey(domain: string, context: string, strategy: string, condition: string): string {
  // Normalize context: if it looks like "a+b", sort alphabetically
  let normalizedContext = context;
  if (context.includes('+')) {
    const parts = context.split('+').sort();
    normalizedContext = parts.join('+');
  }
  return `${domain}:${normalizedContext}:${strategy}:${condition}`;
}

function normalizeContext(context: string): string {
  if (context.includes('+')) {
    return context.split('+').sort().join('+');
  }
  return context;
}

// ── Routes: Status ──────────────────────────────────

app.get('/', async (c) => {
  await ensureReady();
  
  const agents = await adapter.query({ collection: 'agents' }) as Agent[];
  const tasks = await adapter.query({ collection: 'tasks' }) as Task[];
  const buckets = await adapter.query({ collection: 'signal_buckets' }) as SignalBucket[];
  
  const online = agents.filter(a => a.status === 'online').length;
  const uptimeH = Math.floor((Date.now() - startTime) / 3600000);
  
  // Discover vocabulary organically from what's been submitted
  const domains = [...new Set(buckets.map(b => b.domain))];
  const contexts = [...new Set(buckets.map(b => b.context))];
  const strategies = [...new Set(buckets.map(b => b.strategy))];
  const conditions = [...new Set(buckets.map(b => b.condition))].filter(c => c !== 'none');
  
  return c.json({
    network: {
      name: 'dpth.io',
      version: '0.5.0',
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
      domains: domains.length,
      contexts: contexts.length,
      strategies: strategies.length,
      conditions: conditions.length,
      totalAttempts: buckets.reduce((s, b) => s + b.attempts, 0),
      totalContributions: buckets.reduce((s, b) => s + b.contributions, 0),
      avgSuccessRate: buckets.length > 0
        ? Math.round(
            buckets.reduce((s, b) => s + b.successRate * b.attempts, 0) /
            buckets.reduce((s, b) => s + b.attempts, 0) * 1000
          ) / 1000
        : null,
    },
    security: {
      model: 'aggregate-only',
      individualSignalsStored: false,
      agentAttribution: false,
      vocabularyMode: 'open',
    },
  });
});

// ── Routes: Vocabulary Discovery ────────────────────
// Instead of a static registry, discover what agents have actually submitted

app.get('/vocabulary', async (c) => {
  await ensureReady();
  const buckets = await adapter.query({ collection: 'signal_buckets' }) as SignalBucket[];
  const domainFilter = c.req.query('domain');
  
  const filtered = domainFilter ? buckets.filter(b => b.domain === domainFilter) : buckets;
  
  // Build vocabulary from actual submissions
  const domainStats = new Map<string, { buckets: number; attempts: number; contributions: number }>();
  const contextStats = new Map<string, { buckets: number; attempts: number }>();
  const strategyStats = new Map<string, { buckets: number; attempts: number; avgSuccess: number }>();
  const conditionStats = new Map<string, { buckets: number; attempts: number }>();
  
  for (const b of filtered) {
    // Domains
    const ds = domainStats.get(b.domain) || { buckets: 0, attempts: 0, contributions: 0 };
    ds.buckets++; ds.attempts += b.attempts; ds.contributions += b.contributions;
    domainStats.set(b.domain, ds);
    
    // Contexts
    const cs = contextStats.get(b.context) || { buckets: 0, attempts: 0 };
    cs.buckets++; cs.attempts += b.attempts;
    contextStats.set(b.context, cs);
    
    // Strategies
    const ss = strategyStats.get(b.strategy) || { buckets: 0, attempts: 0, avgSuccess: 0 };
    ss.buckets++; ss.attempts += b.attempts;
    ss.avgSuccess = (ss.avgSuccess * (ss.buckets - 1) + b.successRate) / ss.buckets;
    strategyStats.set(b.strategy, ss);
    
    // Conditions
    if (b.condition !== 'none') {
      const cond = conditionStats.get(b.condition) || { buckets: 0, attempts: 0 };
      cond.buckets++; cond.attempts += b.attempts;
      conditionStats.set(b.condition, cond);
    }
  }
  
  return c.json({
    vocabularyMode: 'open — discovered from agent submissions',
    filter: domainFilter || 'all',
    domains: Object.fromEntries([...domainStats].sort((a, b) => b[1].attempts - a[1].attempts)),
    contexts: Object.fromEntries([...contextStats].sort((a, b) => b[1].attempts - a[1].attempts).slice(0, 100)),
    strategies: Object.fromEntries([...strategyStats].sort((a, b) => b[1].attempts - a[1].attempts).slice(0, 100)),
    conditions: Object.fromEntries([...conditionStats].sort((a, b) => b[1].attempts - a[1].attempts).slice(0, 100)),
  });
});

// Keep /registry as alias for backward compat
app.get('/registry', async (c) => {
  // Redirect to vocabulary
  const buckets = await adapter.query({ collection: 'signal_buckets' }) as SignalBucket[];
  return c.json({
    note: 'Vocabulary is now OPEN. Agents submit any terms. This endpoint shows what has been submitted.',
    vocabularyMode: 'open',
    domains: [...new Set(buckets.map(b => b.domain))].sort(),
    contexts: [...new Set(buckets.map(b => b.context))].sort(),
    strategies: [...new Set(buckets.map(b => b.strategy))].sort(),
    conditions: [...new Set(buckets.map(b => b.condition))].filter(c => c !== 'none').sort(),
    signalFormat: {
      domain: 'string — what kind of task (identity, tool, api, recovery, etc.)',
      context: 'string — the situation (e.g., "stripe+github", "summarize_url")',
      strategy: 'string — what approach was tried (e.g., "email_match", "web_fetch")',
      condition: 'string (optional) — modifier (e.g., "generic_domain", "peak_hours")',
      successes: 'number — how many times this worked',
      failures: 'number — how many times this failed',
      totalAttempts: 'number — total tries',
      cost: 'number (optional) — tokens/ms/calls spent',
    },
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

// ── Routes: Signals (Open Format) ───────────────────
//
// OPEN VOCABULARY: Agents submit any domain/context/strategy/condition.
// The coordinator doesn't judge what's valid — it aggregates everything.
// Statistical convergence determines what's useful.
//
// SECURITY: Individual signals are NEVER stored.
// Incoming signals are validated for FORMAT (not content),
// folded into aggregate buckets, and discarded.

app.post('/signals', async (c) => {
  await ensureReady();
  const body = await c.req.json();
  
  // ── Accept both old format (schema/rule/modifier) and new (domain/context/strategy/condition) ──
  const domain = body.domain || 'identity'; // backward compat: default to identity
  const context = body.context || body.schema;
  const strategy = body.strategy || body.rule;
  const condition = body.condition || body.modifier || 'none';
  
  // ── Validate format (not content) ──
  if (!context || !strategy) {
    return c.json({ 
      error: 'context and strategy are required',
      format: '{ domain, context, strategy, condition?, successes, failures, totalAttempts, cost? }',
    }, 400);
  }
  
  for (const [field, value] of [['domain', domain], ['context', context], ['strategy', strategy], ['condition', condition]] as const) {
    const err = validateStringField(value, field);
    if (err) return c.json({ error: err }, 400);
  }
  
  // Accept both old (truePositives/falsePositives) and new (successes/failures) field names
  const successes = Math.max(0, Math.floor(body.successes ?? body.truePositives ?? 0));
  const failures = Math.max(0, Math.floor(body.failures ?? body.falsePositives ?? 0));
  const attempts = Math.max(0, Math.floor(body.totalAttempts || (successes + failures) || 0));
  const cost = Math.max(0, body.cost || 0);
  
  if (attempts === 0) {
    return c.json({ error: 'totalAttempts must be > 0 (or provide successes + failures)' }, 400);
  }
  if (successes + failures > attempts) {
    return c.json({ error: 'successes + failures cannot exceed totalAttempts' }, 400);
  }
  if (attempts > MAX_ATTEMPTS_PER_SIGNAL) {
    return c.json({ error: `totalAttempts capped at ${MAX_ATTEMPTS_PER_SIGNAL} per submission` }, 400);
  }
  
  // ── Fold into aggregate bucket ──
  const normalizedContext = normalizeContext(context);
  const key = bucketKey(domain, normalizedContext, strategy, condition);
  
  let bucket = await adapter.get('signal_buckets', key) as SignalBucket | undefined;
  
  if (bucket) {
    bucket.attempts += attempts;
    bucket.successes += successes;
    bucket.failures += failures;
    bucket.successRate = bucket.attempts > 0 ? bucket.successes / bucket.attempts : 0;
    bucket.failureRate = bucket.attempts > 0 ? bucket.failures / bucket.attempts : 0;
    bucket.totalCost += cost;
    bucket.contributions += 1;
    bucket.lastUpdated = new Date();
  } else {
    bucket = {
      id: key,
      domain,
      context: normalizedContext,
      strategy,
      condition,
      attempts,
      successes,
      failures,
      successRate: attempts > 0 ? successes / attempts : 0,
      failureRate: attempts > 0 ? failures / attempts : 0,
      totalCost: cost,
      contributions: 1,
      firstSeen: new Date(),
      lastUpdated: new Date(),
    };
  }
  
  await adapter.put('signal_buckets', key, bucket);
  
  // Reward contributing agent
  if (body.agentId) {
    const credits = await adapter.get('credits', body.agentId) as CreditBalance | undefined;
    if (credits) {
      const reward = Math.min(attempts * 0.01, 10);
      credits.balance += reward;
      credits.totalEarned += reward;
      await adapter.put('credits', body.agentId, credits);
    }
  }
  
  return c.json({
    accepted: true,
    bucket: {
      domain: bucket.domain,
      context: bucket.context,
      strategy: bucket.strategy,
      condition: bucket.condition,
      successRate: Math.round(bucket.successRate * 1000) / 1000,
      failureRate: Math.round(bucket.failureRate * 1000) / 1000,
      avgCost: bucket.attempts > 0 ? Math.round(bucket.totalCost / bucket.attempts * 100) / 100 : 0,
      attempts: bucket.attempts,
      contributions: bucket.contributions,
    },
  }, 201);
});

app.get('/signals', async (c) => {
  await ensureReady();
  const domain = c.req.query('domain');
  const context = c.req.query('context') || c.req.query('schema'); // backward compat
  const strategy = c.req.query('strategy') || c.req.query('rule');
  
  let buckets = await adapter.query({ collection: 'signal_buckets' }) as SignalBucket[];
  
  if (domain) buckets = buckets.filter(b => b.domain === domain);
  if (context) {
    const normalized = normalizeContext(context);
    buckets = buckets.filter(b => b.context === normalized);
  }
  if (strategy) buckets = buckets.filter(b => b.strategy === strategy);
  
  return c.json({
    buckets: buckets.map(b => ({
      domain: b.domain,
      context: b.context,
      strategy: b.strategy,
      condition: b.condition,
      successRate: Math.round(b.successRate * 1000) / 1000,
      failureRate: Math.round(b.failureRate * 1000) / 1000,
      avgCost: b.attempts > 0 ? Math.round(b.totalCost / b.attempts * 100) / 100 : 0,
      attempts: b.attempts,
      contributions: b.contributions,
      lastUpdated: b.lastUpdated,
    })),
    count: buckets.length,
  });
});

// Calibration endpoint — agents ask "what does the network know about this?"
app.get('/calibrate', async (c) => {
  await ensureReady();
  const domain = c.req.query('domain');
  const context = c.req.query('context') || c.req.query('schema');
  const strategy = c.req.query('strategy') || c.req.query('rule');
  const condition = c.req.query('condition') || c.req.query('modifier');
  
  if (!context && !strategy && !domain) {
    return c.json({ 
      error: 'At least one of domain, context, or strategy is required',
      usage: 'GET /calibrate?domain=identity&context=stripe+github&strategy=email_match',
    }, 400);
  }
  
  let buckets = await adapter.query({ collection: 'signal_buckets' }) as SignalBucket[];
  
  if (domain) buckets = buckets.filter(b => b.domain === domain);
  if (context) {
    const normalized = normalizeContext(context);
    buckets = buckets.filter(b => b.context === normalized);
  }
  if (strategy) buckets = buckets.filter(b => b.strategy === strategy);
  if (condition) buckets = buckets.filter(b => b.condition === condition);
  
  if (buckets.length === 0) {
    return c.json({
      calibration: null,
      message: 'No signals match this query. Your agent is exploring new territory — contribute!',
    });
  }
  
  // Return all matching buckets, sorted by attempts (most data = most confident)
  const results = buckets
    .sort((a, b) => b.attempts - a.attempts)
    .map(b => ({
      domain: b.domain,
      context: b.context,
      strategy: b.strategy,
      condition: b.condition,
      successRate: Math.round(b.successRate * 1000) / 1000,
      failureRate: Math.round(b.failureRate * 1000) / 1000,
      avgCost: b.attempts > 0 ? Math.round(b.totalCost / b.attempts * 100) / 100 : 0,
      confidence: Math.min(b.attempts / 1000, 1),
      attempts: b.attempts,
      contributions: b.contributions,
    }));
  
  return c.json({
    calibration: results,
    count: results.length,
    totalAttempts: results.reduce((s, r) => s + r.attempts, 0),
  });
});

// Keep old endpoint as alias
app.get('/signals/calibrate', async (c) => {
  // Forward to new /calibrate
  const url = new URL(c.req.url);
  url.pathname = '/calibrate';
  return c.redirect(url.toString());
});

// ── Start ───────────────────────────────────────────

console.log(`dpth.io coordinator starting on port ${PORT}...`);

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`✓ dpth.io network coordinator live at http://localhost:${PORT}`);
  console.log(`  Database: ${DB_PATH}`);
  console.log(`  Security: aggregate-only signals, open vocabulary`);
  console.log(`  Endpoints: /, /vocabulary, /agents, /tasks, /credits, /signals, /calibrate`);
});
