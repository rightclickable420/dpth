/**
 * dpth.io Network Coordinator
 * 
 * Standalone API server for the dpth agent network.
 * Uses dpth's own SQLiteAdapter for all persistence.
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

interface ResolutionSignal {
  id: string;
  agentId: string;
  schema: string;         // e.g. "stripe+github"
  rule: string;           // e.g. "email_exact_match"
  modifier?: string;      // e.g. "generic_domain"
  truePositives: number;
  falsePositives: number;
  totalAttempts: number;
  precision: number;
  submittedAt: Date;
}

// ── Helpers ──────────────────────────────────────────

async function ensureReady() {
  // SQLiteAdapter initializes async — wait for it
  await adapter.get('_init', '_init');
}

// ── Routes: Status ──────────────────────────────────

app.get('/', async (c) => {
  await ensureReady();
  
  const agents = await adapter.query({ collection: 'agents' }) as Agent[];
  const tasks = await adapter.query({ collection: 'tasks' }) as Task[];
  const signals = await adapter.query({ collection: 'signals' }) as ResolutionSignal[];
  
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
      resolutionSignals: signals.length,
      schemas: [...new Set(signals.map(s => s.schema))].length,
      avgPrecision: signals.length > 0
        ? Math.round(signals.reduce((s, sig) => s + sig.precision, 0) / signals.length * 1000) / 1000
        : null,
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
  
  // Initialize credit balance
  const balance: CreditBalance = {
    agentId: agent.id,
    balance: 10, // Starter credits
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
  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  
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
    networkSupply: all.reduce((s, c) => s + c.balance, 0),
    totalMinted: all.reduce((s, c) => s + c.totalEarned, 0),
    totalBurned: all.reduce((s, c) => s + c.totalSpent, 0),
  });
});

// ── Routes: Resolution Signals (The Waze Layer) ─────

app.post('/signals', async (c) => {
  await ensureReady();
  const body = await c.req.json();
  
  if (!body.schema || !body.rule) {
    return c.json({ error: 'schema and rule are required' }, 400);
  }
  
  const signal: ResolutionSignal = {
    id: `sig_${randomHex(12)}`,
    agentId: body.agentId || 'anonymous',
    schema: body.schema,
    rule: body.rule,
    modifier: body.modifier,
    truePositives: body.truePositives || 0,
    falsePositives: body.falsePositives || 0,
    totalAttempts: body.totalAttempts || 0,
    precision: body.totalAttempts > 0
      ? (body.truePositives || 0) / body.totalAttempts
      : 0,
    submittedAt: new Date(),
  };
  
  await adapter.put('signals', signal.id, signal);
  
  // Reward the contributing agent
  if (body.agentId) {
    const credits = await adapter.get('credits', body.agentId) as CreditBalance | undefined;
    if (credits) {
      const reward = Math.min(signal.totalAttempts * 0.01, 10); // Up to 10 credits per signal
      credits.balance += reward;
      credits.totalEarned += reward;
      await adapter.put('credits', body.agentId, credits);
    }
  }
  
  return c.json({ signal }, 201);
});

app.get('/signals', async (c) => {
  await ensureReady();
  const schema = c.req.query('schema');
  const rule = c.req.query('rule');
  
  let signals: ResolutionSignal[];
  if (schema) {
    signals = await adapter.query({ collection: 'signals', where: { schema } }) as ResolutionSignal[];
  } else {
    signals = await adapter.query({ collection: 'signals' }) as ResolutionSignal[];
  }
  
  if (rule) {
    signals = signals.filter(s => s.rule === rule);
  }
  
  // Aggregate signals by schema+rule for the response
  const aggregated = new Map<string, {
    schema: string;
    rule: string;
    modifier?: string;
    avgPrecision: number;
    totalAttempts: number;
    contributorCount: number;
    signals: number;
  }>();
  
  for (const sig of signals) {
    const key = `${sig.schema}:${sig.rule}:${sig.modifier || ''}`;
    const existing = aggregated.get(key);
    if (existing) {
      existing.avgPrecision = (existing.avgPrecision * existing.signals + sig.precision) / (existing.signals + 1);
      existing.totalAttempts += sig.totalAttempts;
      existing.signals++;
    } else {
      aggregated.set(key, {
        schema: sig.schema,
        rule: sig.rule,
        modifier: sig.modifier,
        avgPrecision: sig.precision,
        totalAttempts: sig.totalAttempts,
        contributorCount: 1,
        signals: 1,
      });
    }
  }
  
  return c.json({
    signals: Array.from(aggregated.values()),
    totalRaw: signals.length,
  });
});

// Calibration endpoint — agents ask "how well does this rule work?"
app.get('/signals/calibrate', async (c) => {
  await ensureReady();
  const schema = c.req.query('schema');
  const rule = c.req.query('rule');
  
  if (!schema || !rule) {
    return c.json({ error: 'schema and rule query params required' }, 400);
  }
  
  const signals = await adapter.query({
    collection: 'signals',
    where: { schema, rule },
  }) as ResolutionSignal[];
  
  if (signals.length === 0) {
    return c.json({ calibration: null, message: 'No signals for this schema+rule combination' });
  }
  
  const totalAttempts = signals.reduce((s, sig) => s + sig.totalAttempts, 0);
  const weightedPrecision = signals.reduce((s, sig) => s + sig.precision * sig.totalAttempts, 0) / totalAttempts;
  
  return c.json({
    calibration: {
      schema,
      rule,
      precision: Math.round(weightedPrecision * 1000) / 1000,
      confidence: Math.min(totalAttempts / 1000, 1), // Confidence grows with sample size
      totalAttempts,
      contributorCount: new Set(signals.map(s => s.agentId)).size,
      signalCount: signals.length,
    },
  });
});

// ── Start ───────────────────────────────────────────

console.log(`dpth.io coordinator starting on port ${PORT}...`);

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`✓ dpth.io network coordinator live at http://localhost:${PORT}`);
  console.log(`  Database: ${DB_PATH}`);
  console.log(`  Endpoints: /, /agents, /tasks, /credits, /signals, /signals/calibrate`);
});
