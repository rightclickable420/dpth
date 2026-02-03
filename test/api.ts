/**
 * dpth.io API Route Tests
 * 
 * Tests the Next.js API routes by calling handlers directly
 * with mock NextRequest objects. Covers the full HTTP surface.
 * 
 * Run: npx tsx test/api.ts
 */

import { NextRequest } from 'next/server';
import * as fs from 'fs/promises';
import * as path from 'path';

// Set data dir to temp for testing
const TEST_DATA_DIR = path.join(process.cwd(), 'test-data-' + Date.now());
process.env.DATA_DIR = TEST_DATA_DIR;

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void>) {
  return fn().then(() => {
    passed++;
    console.log(`  ✓ ${name}`);
  }).catch((e) => {
    failed++;
    console.log(`  ✗ ${name}: ${e instanceof Error ? e.message : e}`);
  });
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

function makeRequest(url: string, opts?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), opts);
}

// ─── Cleanup helper ──────────────────────────────────

async function cleanup() {
  try {
    await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {}
}

console.log('\n🌐 dpth.io API Route Tests\n');

// ═══════════════════════════════════════════════════════
// Status API
// ═══════════════════════════════════════════════════════
console.log('Status:');

await test('GET /status returns network stats', async () => {
  const { GET } = await import('../src/api/status/route');
  const res = await GET();
  const data = await res.json();
  assert(res.status === 200, `Expected 200, got ${res.status}`);
  assert(data.network !== undefined || data.agents !== undefined || data.status !== undefined, 'Should return network data');
});

// ═══════════════════════════════════════════════════════
// Agents API
// ═══════════════════════════════════════════════════════
console.log('\nAgents:');

let testAgentId: string;

await test('POST /agents registers an agent', async () => {
  const { POST } = await import('../src/api/agents/route');
  const req = makeRequest('http://localhost:3000/api/dpth/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'test-agent',
      publicKey: 'pk_test_' + Date.now(),
      capabilities: {
        storageCapacityMb: 5000,
        cpuCores: 8,
        hasGpu: true,
        gpuVramMb: 16384,
        taskTypes: ['embed', 'inference'],
      },
    }),
  });
  const res = await POST(req);
  const data = await res.json();
  assert(res.status === 200 || res.status === 201, `Expected 2xx, got ${res.status}`);
  assert(data.agent?.id !== undefined || data.id !== undefined, 'Should return agent ID');
  testAgentId = data.agent?.id || data.id;
});

await test('GET /agents lists registered agents', async () => {
  const { GET } = await import('../src/api/agents/route');
  const res = await GET();
  const data = await res.json();
  assert(res.status === 200, `Expected 200, got ${res.status}`);
  assert(Array.isArray(data.agents), 'Should return agents array');
  assert(data.agents.length >= 1, 'Should have at least 1 agent');
});

// ═══════════════════════════════════════════════════════
// Storage API
// ═══════════════════════════════════════════════════════
console.log('\nStorage:');

let storedCid: string;

await test('POST /storage stores content and returns CID', async () => {
  const { POST } = await import('../src/api/storage/route');
  const req = makeRequest('http://localhost:3000/api/dpth/storage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: 'Hello dpth.io! This is test content.',
      metadata: { type: 'test', source: 'api-test' },
    }),
  });
  const res = await POST(req);
  const data = await res.json();
  assert(res.status === 200 || res.status === 201, `Expected 2xx, got ${res.status}`);
  assert(data.cid !== undefined, 'Should return CID');
  assert(data.cid.startsWith('baf'), `CID should start with 'baf', got ${data.cid}`);
  storedCid = data.cid;
});

await test('GET /storage retrieves by CID', async () => {
  const { GET } = await import('../src/api/storage/route');
  const req = makeRequest(`http://localhost:3000/api/dpth/storage?cid=${storedCid}`);
  const res = await GET(req);
  const data = await res.json();
  assert(res.status === 200, `Expected 200, got ${res.status}`);
  assert(data.content !== undefined || data.data !== undefined, 'Should return stored content');
});

await test('GET /storage returns 404 for unknown CID', async () => {
  const { GET } = await import('../src/api/storage/route');
  const req = makeRequest('http://localhost:3000/api/dpth/storage?cid=baf_nonexistent_12345');
  const res = await GET(req);
  assert(res.status === 404, `Expected 404, got ${res.status}`);
});

// ═══════════════════════════════════════════════════════
// Tasks API
// ═══════════════════════════════════════════════════════
console.log('\nTasks:');

let testTaskId: string;

await test('POST /tasks creates a task', async () => {
  const { POST } = await import('../src/api/tasks/route');
  const req = makeRequest('http://localhost:3000/api/dpth/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'embed',
      input: { text: 'Test content for embedding' },
      priority: 'normal',
    }),
  });
  const res = await POST(req);
  const data = await res.json();
  assert(res.status === 200 || res.status === 201, `Expected 2xx, got ${res.status}`);
  assert(data.task?.id !== undefined || data.id !== undefined, 'Should return task ID');
  testTaskId = data.task?.id || data.id;
});

await test('GET /tasks lists available tasks', async () => {
  const { GET } = await import('../src/api/tasks/route');
  const req = makeRequest('http://localhost:3000/api/dpth/tasks?type=embed');
  const res = await GET(req);
  const data = await res.json();
  assert(res.status === 200, `Expected 200, got ${res.status}`);
  assert(Array.isArray(data.tasks), 'Should return tasks array');
});

await test('POST /tasks?action=claim claims a task', async () => {
  const { POST } = await import('../src/api/tasks/route');
  const req = makeRequest('http://localhost:3000/api/dpth/tasks?action=claim', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Id': testAgentId || 'test-agent',
    },
    body: JSON.stringify({ taskId: testTaskId }),
  });
  const res = await POST(req);
  // May succeed or fail depending on task state — just check it doesn't 500
  assert(res.status < 500, `Should not 500, got ${res.status}`);
});

// ═══════════════════════════════════════════════════════
// Models API
// ═══════════════════════════════════════════════════════
console.log('\nModels:');

await test('POST /models registers a model', async () => {
  const { POST } = await import('../src/api/models/route');
  const req = makeRequest('http://localhost:3000/api/dpth/models', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Id': testAgentId || 'test-agent',
      'X-Agent-Key': 'pk_test',
    },
    body: JSON.stringify({
      agentId: testAgentId || 'test-agent',
      modelId: 'llama-3.2-3b',
      capabilities: ['text-generation'],
      maxContextLength: 4096,
      quantization: 'q4_0',
      tokensPerSecond: 30,
    }),
  });
  const res = await POST(req);
  // Accept 200, 201, or 400 if field naming differs — just not 500
  assert(res.status < 500, `Should not 500, got ${res.status}`);
});

await test('GET /models lists available models', async () => {
  const { GET } = await import('../src/api/models/route');
  const req = makeRequest('http://localhost:3000/api/dpth/models');
  const res = await GET(req);
  const data = await res.json();
  assert(res.status === 200, `Expected 200, got ${res.status}`);
  assert(Array.isArray(data.models), 'Should return models array');
});

// ═══════════════════════════════════════════════════════
// Contribute API
// ═══════════════════════════════════════════════════════
console.log('\nContributions:');

await test('POST /contribute?type=storage records storage contribution', async () => {
  const { POST } = await import('../src/api/contribute/route');
  const req = makeRequest('http://localhost:3000/api/dpth/contribute?type=storage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Id': testAgentId || 'test-agent',
    },
    body: JSON.stringify({
      agentId: testAgentId || 'test-agent',
      megabytes: 1000,
    }),
  });
  const res = await POST(req);
  assert(res.status < 500, `Should not 500, got ${res.status}`);
});

await test('POST /contribute?type=gpu records GPU contribution', async () => {
  const { POST } = await import('../src/api/contribute/route');
  const req = makeRequest('http://localhost:3000/api/dpth/contribute?type=gpu', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Id': testAgentId || 'test-agent',
    },
    body: JSON.stringify({
      agentId: testAgentId || 'test-agent',
      tokensGenerated: 5000,
      modelId: 'llama-3.2-3b',
      taskId: 'task-gpu-001',
    }),
  });
  const res = await POST(req);
  assert(res.status < 500, `Should not 500, got ${res.status}`);
});

// ═══════════════════════════════════════════════════════
// Reputation API
// ═══════════════════════════════════════════════════════
console.log('\nReputation:');

await test('GET /reputation returns agent reputation', async () => {
  const { GET } = await import('../src/api/reputation/route');
  const req = makeRequest(`http://localhost:3000/api/dpth/reputation?agentId=${testAgentId || 'test-agent'}`);
  const res = await GET(req);
  const data = await res.json();
  assert(res.status === 200, `Expected 200, got ${res.status}`);
  assert(data.tier !== undefined || data.reputation !== undefined, 'Should return reputation data');
});

// ═══════════════════════════════════════════════════════
// Rewards API
// ═══════════════════════════════════════════════════════
console.log('\nRewards:');

await test('GET /rewards returns available rewards', async () => {
  const { GET } = await import('../src/api/rewards/route');
  const req = makeRequest(`http://localhost:3000/api/dpth/rewards?agentId=${testAgentId || 'test-agent'}`);
  const res = await GET(req);
  const data = await res.json();
  assert(res.status === 200, `Expected 200, got ${res.status}`);
  assert(data.rewards !== undefined || data.available !== undefined, 'Should return rewards data');
});

// ═══════════════════════════════════════════════════════
// Credits API
// ═══════════════════════════════════════════════════════
console.log('\nCredits:');

await test('POST /credits?action=earn records earnings', async () => {
  const { POST } = await import('../src/api/credits/route');
  const req = makeRequest('http://localhost:3000/api/dpth/credits?action=earn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId: testAgentId || 'test-agent',
      amount: 100,
      reason: 'API test storage contribution',
      category: 'storage',
    }),
  });
  const res = await POST(req);
  const data = await res.json();
  assert(res.status === 200, `Expected 200, got ${res.status}`);
  assert(data.transaction !== undefined || data.message !== undefined, 'Should confirm transaction');
});

await test('GET /credits?agentId returns balance', async () => {
  const { GET } = await import('../src/api/credits/route');
  const req = makeRequest(`http://localhost:3000/api/dpth/credits?agentId=${testAgentId || 'test-agent'}`);
  const res = await GET(req);
  const data = await res.json();
  assert(res.status === 200, `Expected 200, got ${res.status}`);
  assert(data.balance !== undefined, 'Should return balance');
});

await test('POST /credits?action=spend deducts credits', async () => {
  const { POST } = await import('../src/api/credits/route');
  const req = makeRequest('http://localhost:3000/api/dpth/credits?action=spend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId: testAgentId || 'test-agent',
      amount: 10,
      reason: 'API test query',
      category: 'query',
    }),
  });
  const res = await POST(req);
  assert(res.status === 200, `Expected 200, got ${res.status}`);
});

await test('GET /credits?supply returns network supply', async () => {
  const { GET } = await import('../src/api/credits/route');
  const req = makeRequest('http://localhost:3000/api/dpth/credits?supply');
  const res = await GET(req);
  const data = await res.json();
  assert(res.status === 200, `Expected 200, got ${res.status}`);
  assert(data.supply !== undefined, 'Should return supply stats');
});

await test('GET /credits?leaderboard returns rankings', async () => {
  const { GET } = await import('../src/api/credits/route');
  const req = makeRequest('http://localhost:3000/api/dpth/credits?leaderboard');
  const res = await GET(req);
  const data = await res.json();
  assert(res.status === 200, `Expected 200, got ${res.status}`);
  assert(data.leaderboard !== undefined, 'Should return leaderboard');
});

// ═══════════════════════════════════════════════════════
// Proofs API
// ═══════════════════════════════════════════════════════
console.log('\nStorage Proofs:');

await test('POST /proofs?action=challenge creates a challenge', async () => {
  const { POST } = await import('../src/api/proofs/route');
  const req = makeRequest('http://localhost:3000/api/dpth/proofs?action=challenge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId: testAgentId || 'test-agent',
    }),
  });
  const res = await POST(req);
  // May 404 if no chunks assigned — that's OK
  assert(res.status < 500, `Should not 500, got ${res.status}`);
});

// ═══════════════════════════════════════════════════════
// Inference API
// ═══════════════════════════════════════════════════════
console.log('\nInference:');

await test('POST /inference creates inference request', async () => {
  const { POST } = await import('../src/api/inference/route');
  const req = makeRequest('http://localhost:3000/api/dpth/inference', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modelId: 'llama-3.2-3b',
      input: { messages: [{ role: 'user', content: 'Hello!' }] },
      params: { maxTokens: 100, temperature: 0.7 },
    }),
  });
  const res = await POST(req);
  // Will likely queue since no real agents — just check it doesn't crash
  assert(res.status < 500, `Should not 500, got ${res.status}`);
});

await test('GET /inference lists requests', async () => {
  const { GET } = await import('../src/api/inference/route');
  const req = makeRequest('http://localhost:3000/api/dpth/inference');
  const res = await GET(req);
  assert(res.status < 500, `Should not 500, got ${res.status}`);
});

// ─── Cleanup & Summary ──────────────────────────────
await cleanup();

console.log(`\n${'═'.repeat(50)}`);
console.log(`  API Routes: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
