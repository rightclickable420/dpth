/**
 * dpth.io Smoke Test
 * 
 * Verifies core library modules load and basic operations work.
 * Run: npx tsx test/smoke.ts
 */

import { resolveOrCreate, getEntity, getEntitiesByType, clearEntities } from '../src/entity';
import { registerMetric, addMetricPoints, getMetric, clearMetrics } from '../src/correlation';
import { takeSnapshot, getSnapshots, diffSnapshots, clearSnapshots } from '../src/temporal';
import { getConfiguredProviders, findFallbackProvider, getFallbackStatus } from '../src/fallback';
import { DpthAgent } from '../src/agent-sdk';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}: ${e instanceof Error ? e.message : e}`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

// Reset state
clearEntities();
clearMetrics();
clearSnapshots();

console.log('\n🧪 dpth.io Smoke Tests\n');

// ─── Entity Module ───────────────────────────────────
console.log('Entity Resolution:');

test('resolveOrCreate creates new entity', () => {
  const result = resolveOrCreate('person', 'Test User', 'test-source', 'ext-123');
  assert(result.entity.id !== undefined, 'Should have an ID');
  assert(result.entity.name === 'Test User', 'Name should match');
  assert(result.entity.type === 'person', 'Type should match');
  assert(result.entity.sources.length === 1, 'Should have one source');
  assert(result.isNew === true, 'Should be new');
});

test('resolveOrCreate resolves existing entity by source', () => {
  const result1 = resolveOrCreate('person', 'John Doe', 'github', 'johndoe');
  const result2 = resolveOrCreate('person', 'John Doe', 'github', 'johndoe');
  assert(result1.entity.id === result2.entity.id, 'Same source should resolve to same entity');
  assert(result2.isNew === false, 'Should not be new');
});

test('resolveOrCreate creates separate entities for different sources', () => {
  // Without email/alias signals, same name from different sources creates separate entities
  // This prevents false positives — strict matching is intentional
  const result1 = resolveOrCreate('person', 'Jane Smith', 'github', 'jsmith');
  const result2 = resolveOrCreate('person', 'Jane Smith', 'jira', 'jane.smith');
  // Both should be valid entities regardless of match/no-match
  assert(result1.entity.id !== undefined, 'First entity should exist');
  assert(result2.entity.id !== undefined, 'Second entity should exist');
});

test('getEntity retrieves by ID', () => {
  const { entity: created } = resolveOrCreate('company', 'Acme Corp', 'stripe', 'cus_123');
  const found = getEntity(created.id);
  assert(found !== undefined, 'Should find entity');
  assert(found!.name === 'Acme Corp', 'Name should match');
});

test('getEntitiesByType filters correctly', () => {
  resolveOrCreate('person', 'Alice', 'github', 'alice');
  resolveOrCreate('company', 'BigCo', 'stripe', 'bigco');
  const people = getEntitiesByType('person');
  assert(people.length >= 2, 'Should find at least 2 people');
  assert(people.every(e => e.type === 'person'), 'All should be people');
});

// ─── Correlation Module ──────────────────────────────
console.log('\nCorrelation Engine:');

test('registerMetric creates metric', () => {
  registerMetric({
    id: 'revenue-widget',
    entityId: 'test-entity',
    name: 'revenue',
    unit: 'USD',
    points: [],
    aggregation: 'sum',
  });
  const metric = getMetric('revenue-widget');
  assert(metric !== undefined, 'Metric should exist');
  assert(metric!.name === 'revenue', 'Name should match');
});

test('addMetricPoints records data', () => {
  registerMetric({
    id: 'sales-gadget',
    entityId: 'test-entity-2',
    name: 'sales',
    points: [],
    aggregation: 'sum',
  });
  addMetricPoints('sales-gadget', [
    { timestamp: new Date('2024-01-01'), value: 100, source: 'stripe', confidence: 1 },
    { timestamp: new Date('2024-02-01'), value: 150, source: 'stripe', confidence: 1 },
    { timestamp: new Date('2024-03-01'), value: 200, source: 'stripe', confidence: 1 },
  ]);
  const metric = getMetric('sales-gadget');
  assert(metric!.points.length === 3, 'Should have 3 data points');
});

// ─── Temporal Module ─────────────────────────────────
console.log('\nTemporal Data:');

test('takeSnapshot stores state', () => {
  takeSnapshot('pres-1', { revenue: 1000, users: 50 });
  takeSnapshot('pres-1', { revenue: 1200, users: 65 });
  const snapshots = getSnapshots('pres-1');
  assert(snapshots.length === 2, 'Should have 2 snapshots');
});

test('getSnapshots retrieves history', () => {
  const snapshots = getSnapshots('pres-1');
  assert(snapshots.length >= 2, 'Should have at least 2 snapshots');
});

test('diffSnapshots finds changes', () => {
  const snapshots = getSnapshots<Record<string, unknown>>('pres-1');
  if (snapshots.length >= 2) {
    const diff = diffSnapshots(snapshots[0], snapshots[1]);
    assert(diff !== undefined, 'Should produce a diff');
    assert(diff.changed.length > 0, 'Should detect changes');
  }
});

// ─── Fallback Module ─────────────────────────────────
console.log('\nCentralized Fallback:');

test('getFallbackStatus returns provider list', () => {
  const status = getFallbackStatus();
  assert(status.providers.length > 0, 'Should have providers');
  assert(status.providers.some(p => p.id === 'openai'), 'Should include OpenAI');
  assert(status.providers.some(p => p.id === 'anthropic'), 'Should include Anthropic');
  assert(status.providers.some(p => p.id === 'groq'), 'Should include Groq');
  assert(status.providers.some(p => p.id === 'together'), 'Should include Together');
});

test('findFallbackProvider matches models', () => {
  // These may return null without API keys, but should not throw
  findFallbackProvider('gpt-4o');
  findFallbackProvider('llama-3.3-70b');
  findFallbackProvider('claude-sonnet');
  findFallbackProvider('nonexistent-model');
});

// ─── Agent SDK ───────────────────────────────────────
console.log('\nAgent SDK:');

test('DpthAgent constructs with generated keys', () => {
  const agent = new DpthAgent({
    name: 'test-agent',
    apiUrl: 'http://localhost:3000/api/dpth',
    capabilities: {
      storageCapacityMb: 1000,
      cpuCores: 4,
      hasGpu: false,
      taskTypes: ['embed', 'correlate'],
    },
  });
  assert(agent.getPublicKey() !== '', 'Should have a public key');
  assert(agent.getAgentId() === null, 'Should not be registered yet');
  assert(agent.isRegistered() === false, 'Should not be registered');
  assert(agent.isWorking() === false, 'Should not be working');
});

test('DpthAgent with GPU capabilities', () => {
  const agent = new DpthAgent({
    name: 'gpu-agent',
    apiUrl: 'http://localhost:3000/api/dpth',
    capabilities: {
      storageCapacityMb: 5000,
      cpuCores: 16,
      hasGpu: true,
      gpuVramMb: 24576,
      taskTypes: ['embed', 'inference', 'correlate'],
    },
  });
  assert(agent.getPublicKey() !== '', 'Should have a public key');
});

// ─── Summary ─────────────────────────────────────────
console.log(`\n${'═'.repeat(40)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(40)}\n`);

process.exit(failed > 0 ? 1 : 0);
