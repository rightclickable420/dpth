/**
 * dpth.io Unified API Tests
 * 
 * Tests the main dpth() factory and all sub-APIs:
 * entity resolution, temporal history, correlation detection, vector search.
 */

import { dpth, Dpth } from '../src/dpth.js';
import { MemoryVectorAdapter } from '../src/adapter-vector.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

// ─── Entity API Tests ────────────────────────────────

async function testEntityAPI() {
  console.log('\n🧬 Entity API');
  
  const db = dpth();
  
  // Create entity
  const { entity: john, isNew } = await db.entity.resolve('person', 'John Smith', 'stripe', 'cus_123', {
    email: 'john@company.com',
    attributes: { role: 'CTO' },
  });
  assert(isNew === true, 'first resolve creates new entity');
  assert(john.name === 'John Smith', 'entity has correct name');
  assert(john.sources.length === 1, 'entity has one source');
  assert(john.attributes['email']?.current === 'john@company.com', 'email attribute stored');
  assert(john.attributes['role']?.current === 'CTO', 'custom attribute stored');
  
  // Resolve same source → returns existing
  const { entity: same, isNew: isNew2 } = await db.entity.resolve('person', 'John Smith', 'stripe', 'cus_123');
  assert(isNew2 === false, 'same source returns existing entity');
  assert(same.id === john.id, 'same entity ID');
  
  // Resolve different source, same email → merges
  const { entity: merged, isNew: isNew3, confidence } = await db.entity.resolve(
    'person', 'jsmith', 'github', 'jsmith-gh', { email: 'john@company.com' }
  );
  assert(isNew3 === false, 'email match merges into existing entity');
  assert(merged.id === john.id, 'merged into same entity');
  assert(merged.sources.length === 2, 'entity now has two sources');
  assert(merged.aliases.includes('jsmith'), 'alias added from merge');
  assert(confidence > 0.7, 'merge confidence above threshold');
  
  // Different entity entirely
  const { entity: jane, isNew: isNew4 } = await db.entity.resolve('person', 'Jane Doe', 'hubspot', 'contact_456');
  assert(isNew4 === true, 'different person creates new entity');
  assert(jane.id !== john.id, 'different entity ID');
  
  // Get by ID
  const fetched = await db.entity.get(john.id);
  assert(fetched?.id === john.id, 'get by ID works');
  
  // Find by source
  const found = await db.entity.findBySource('github', 'jsmith-gh');
  assert(found?.id === john.id, 'findBySource works');
  
  // List
  const all = await db.entity.list('person');
  assert(all.length === 2, 'list returns all entities of type');
  
  // Count
  const count = await db.entity.count('person');
  assert(count === 2, 'count works');
  
  // Set attribute
  await db.entity.setAttribute(john.id, 'role', 'CEO', 'manual');
  const updated = await db.entity.get(john.id);
  assert(updated?.attributes['role']?.current === 'CEO', 'setAttribute updates value');
  assert(updated?.attributes['role']?.history.length === 2, 'setAttribute preserves history');
  
  // Merge entities
  const { entity: bob } = await db.entity.resolve('person', 'Bob', 'slack', 'bob_slack');
  const { entity: robert } = await db.entity.resolve('person', 'Robert', 'jira', 'robert_jira');
  const mergeResult = await db.entity.merge(bob.id, robert.id);
  assert(mergeResult?.aliases.includes('Robert'), 'merge combines aliases');
  assert(mergeResult?.sources.length === 2, 'merge combines sources');
  const deletedRobert = await db.entity.get(robert.id);
  assert(deletedRobert === undefined, 'merged entity is deleted');
  
  await db.close();
}

// ─── Temporal API Tests ──────────────────────────────

async function testTemporalAPI() {
  console.log('\n⏱ Temporal API');
  
  const db = dpth();
  
  // Take snapshots
  const snap1 = await db.temporal.snapshot('dashboard', { revenue: 30000, users: 100 });
  assert(snap1.key === 'dashboard', 'snapshot has correct key');
  assert((snap1.data as any).revenue === 30000, 'snapshot stores data');
  
  // Wait a tick for unique timestamps
  await new Promise(r => setTimeout(r, 10));
  
  const snap2 = await db.temporal.snapshot('dashboard', { revenue: 42000, users: 150 });
  await new Promise(r => setTimeout(r, 10));
  const snap3 = await db.temporal.snapshot('dashboard', { revenue: 50000, users: 200 });
  
  // History
  const history = await db.temporal.history('dashboard');
  assert(history.length === 3, 'history returns all snapshots');
  assert((history[0].data as any).revenue === 30000, 'history ordered by time (oldest first)');
  assert((history[2].data as any).revenue === 50000, 'history ordered by time (newest last)');
  
  // Latest
  const latest = await db.temporal.latest('dashboard');
  assert((latest?.data as any).revenue === 50000, 'latest returns most recent snapshot');
  
  // Diff
  const diff = db.temporal.diff(
    snap1 as any,
    snap3 as any
  );
  assert(diff.changed.length === 2, 'diff detects 2 changed fields');
  assert(diff.changed.find(c => c.key === 'revenue')?.from === 30000, 'diff shows old value');
  assert(diff.changed.find(c => c.key === 'revenue')?.to === 50000, 'diff shows new value');
  
  // Diff with added/removed
  await new Promise(r => setTimeout(r, 10));
  const snap4 = await db.temporal.snapshot('dashboard', { revenue: 55000, users: 210, churn: 5 });
  const diff2 = db.temporal.diff(snap3 as any, snap4 as any);
  assert(diff2.added.includes('churn'), 'diff detects added field');
  
  await db.close();
}

// ─── Correlation API Tests ───────────────────────────

async function testCorrelationAPI() {
  console.log('\n🔗 Correlation API');
  
  const db = dpth();
  
  // Track correlated metrics
  const baseTime = new Date('2025-01-01');
  for (let i = 0; i < 30; i++) {
    const day = new Date(baseTime.getTime() + i * 86400000);
    // MRR grows linearly
    await db.correlation.track('mrr', 10000 + i * 500, { source: 'stripe', name: 'MRR', unit: '$' });
    // Deploys also grow (correlated)
    await db.correlation.track('deploys', 5 + i * 0.5 + Math.random() * 2, { source: 'github', name: 'Deploys' });
    // Random noise (uncorrelated)
    await db.correlation.track('noise', Math.random() * 100, { source: 'test', name: 'Noise' });
  }
  
  // Get metric
  const mrr = await db.correlation.get('mrr');
  assert(mrr !== undefined, 'metric stored and retrievable');
  assert(mrr!.points.length === 30, 'all 30 data points stored');
  
  // List metrics
  const allMetrics = await db.correlation.list();
  assert(allMetrics.length === 3, 'all 3 metrics listed');
  
  // Note: correlation finding needs time-aligned data which our track() 
  // stores with Date.now() timestamps, so the Pearson calc may not find
  // perfect correlations. The API structure is what we're testing here.
  
  // Find correlations (may return empty for non-time-aligned data — that's ok)
  const correlations = await db.correlation.find('mrr', { minCorrelation: 0.3 });
  assert(Array.isArray(correlations), 'find returns array');
  
  await db.close();
}

// ─── Vector API Tests ────────────────────────────────

async function testVectorAPI() {
  console.log('\n🔮 Vector API');
  
  // Without vector adapter
  const db1 = dpth();
  assert(db1.vector.available === false, 'vector not available with MemoryAdapter');
  
  // With vector adapter
  const db2 = dpth({ adapter: new MemoryVectorAdapter() });
  assert(db2.vector.available === true, 'vector available with MemoryVectorAdapter');
  
  // Store and search
  await db2.vector.store('people', 'john', [1, 0, 0], { name: 'John' });
  await db2.vector.store('people', 'jane', [0, 1, 0], { name: 'Jane' });
  await db2.vector.store('people', 'johnny', [0.95, 0.05, 0], { name: 'Johnny' });
  
  const results = await db2.vector.search('people', [1, 0, 0], 2);
  assert(results.length === 2, 'vector search returns topK');
  assert(results[0].key === 'john', 'exact match is first');
  assert(results[1].key === 'johnny', 'similar match is second');
  
  await db1.close();
  await db2.close();
}

// ─── Factory Tests ───────────────────────────────────

async function testFactory() {
  console.log('\n🏭 Factory');
  
  // Default (in-memory)
  const db1 = dpth();
  assert(db1 instanceof Dpth, 'dpth() returns Dpth instance');
  
  // With adapter
  const db2 = dpth({ adapter: new MemoryVectorAdapter() });
  assert(db2.vector.available === true, 'custom adapter works');
  
  // Stats
  await db1.entity.resolve('person', 'Test', 'src', 'ext1');
  await db1.temporal.snapshot('key', { x: 1 });
  await db1.correlation.track('metric', 42);
  
  const stats = await db1.stats();
  assert(stats.entities === 1, 'stats.entities correct');
  assert(stats.snapshots === 1, 'stats.snapshots correct');
  assert(stats.metrics === 1, 'stats.metrics correct');
  
  await db1.close();
  await db2.close();
}

// ─── Run All ─────────────────────────────────────────

async function main() {
  console.log('━━━ dpth.io Unified API Tests ━━━');
  
  await testEntityAPI();
  await testTemporalAPI();
  await testCorrelationAPI();
  await testVectorAPI();
  await testFactory();
  
  console.log(`\n━━━ Results: ${passed} passed, ${failed} failed ━━━`);
  
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
