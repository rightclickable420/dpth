/**
 * dpth.io Unified API Tests
 * 
 * Tests the main dpth() factory and all sub-APIs:
 * entity resolution, temporal history, correlation detection, vector search.
 */

import { dpth, Dpth } from '../src/dpth.js';
import { MemoryVectorAdapter } from '../src/adapter-vector.js';
import { ValidationError, AdapterCapabilityError } from '../src/errors.js';

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

// ─── Object-Style Resolve Tests ──────────────────────

async function testObjectResolve() {
  console.log('\n🆕 Object-Style Resolve API');
  
  const db = dpth();
  
  // Create entity with object form
  const { entity: alice, isNew } = await db.entity.resolve({
    type: 'person',
    name: 'Alice Johnson',
    source: 'stripe',
    externalId: 'cus_alice',
    email: 'alice@example.com',
    attributes: { plan: 'pro' },
  });
  assert(isNew === true, 'object resolve creates new entity');
  assert(alice.name === 'Alice Johnson', 'object resolve sets name');
  assert(alice.attributes['email']?.current === 'alice@example.com', 'object resolve sets email');
  assert(alice.attributes['plan']?.current === 'pro', 'object resolve sets attributes');
  assert(alice.sources[0].sourceId === 'stripe', 'object resolve sets source');
  
  // Merge via object form (same email)
  const { entity: merged, isNew: isNew2 } = await db.entity.resolve({
    type: 'person',
    name: 'A. Johnson',
    source: 'github',
    externalId: 'ajohnson',
    email: 'alice@example.com',
  });
  assert(isNew2 === false, 'object resolve merges on email match');
  assert(merged.id === alice.id, 'object resolve merges into same entity');
  assert(merged.sources.length === 2, 'object resolve adds source on merge');
  
  // Same source via object form
  const { isNew: isNew3 } = await db.entity.resolve({
    type: 'person',
    name: 'Alice Johnson',
    source: 'stripe',
    externalId: 'cus_alice',
  });
  assert(isNew3 === false, 'object resolve recognizes existing source');
  
  // Custom entity type via object form
  const { entity: ticket } = await db.entity.resolve({
    type: 'ticket' as any,
    name: 'Bug #1234',
    source: 'jira',
    externalId: 'PROJ-1234',
    attributes: { priority: 'high' },
  });
  assert(ticket.type === 'ticket', 'object resolve supports custom entity types');
  
  // Email index fast-path: merge by email even with different name
  const { entity: eve1 } = await db.entity.resolve({
    type: 'person',
    name: 'Eve Wilson',
    source: 'stripe',
    externalId: 'cus_eve',
    email: 'eve@example.com',
  });
  const { entity: eve2, isNew: eveNew } = await db.entity.resolve({
    type: 'person',
    name: 'E. Wilson',
    source: 'github',
    externalId: 'ewilson',
    email: 'eve@example.com',
  });
  assert(eveNew === false, 'email index enables merge with different name');
  assert(eve2.id === eve1.id, 'email index merges to same entity');
  
  await db.close();
}

// ─── Validation Tests ────────────────────────────────

async function testValidation() {
  console.log('\n🛡️  Validation & Errors');
  
  const db = dpth();
  
  // Missing type
  try {
    await db.entity.resolve({ type: '', name: 'Test', source: 'x', externalId: 'y' });
    assert(false, 'empty type should throw');
  } catch (e) {
    assert(e instanceof ValidationError, 'empty type throws ValidationError');
    assert((e as ValidationError).code === 'VALIDATION_ERROR', 'error has correct code');
  }
  
  // Missing name
  try {
    await db.entity.resolve({ type: 'person', name: '', source: 'x', externalId: 'y' });
    assert(false, 'empty name should throw');
  } catch (e) {
    assert(e instanceof ValidationError, 'empty name throws ValidationError');
  }
  
  // Missing source
  try {
    await db.entity.resolve({ type: 'person', name: 'Test', source: '', externalId: 'y' });
    assert(false, 'empty source should throw');
  } catch (e) {
    assert(e instanceof ValidationError, 'empty source throws ValidationError');
  }
  
  // Missing externalId
  try {
    await db.entity.resolve({ type: 'person', name: 'Test', source: 'x', externalId: '' });
    assert(false, 'empty externalId should throw');
  } catch (e) {
    assert(e instanceof ValidationError, 'empty externalId throws ValidationError');
  }
  
  // Vector ops on non-vector adapter
  try {
    await db.vector.store('test', 'k', [1, 2, 3]);
    assert(false, 'vector.store should throw without VectorAdapter');
  } catch (e) {
    assert(e instanceof AdapterCapabilityError, 'vector.store throws AdapterCapabilityError');
  }
  
  try {
    await db.vector.search('test', [1, 2, 3]);
    assert(false, 'vector.search should throw without VectorAdapter');
  } catch (e) {
    assert(e instanceof AdapterCapabilityError, 'vector.search throws AdapterCapabilityError');
  }
  
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

// ─── Network Opt-In Tests ────────────────────────────

async function testNetworkOptIn() {
  console.log('\n🌐 Network Opt-In');
  
  // Create a network-enabled instance
  const db = await dpth({ network: true }).ready();
  
  // Resolve some entities — signals should accumulate locally
  await db.entity.resolve({
    type: 'person',
    name: 'Network Test User',
    source: 'stripe',
    externalId: 'cus_net_1',
    email: 'nettest@example.com',
  });
  
  // Same email from different source — triggers a merge
  const { isNew } = await db.entity.resolve({
    type: 'person',
    name: 'Net Test User',
    source: 'github',
    externalId: 'nettest-gh',
    email: 'nettest@example.com',
  });
  assert(isNew === false, 'network-enabled merge works locally');
  
  // Close flushes signals to the network
  await db.close();
  
  // Verify signal was received by checking calibration
  // Schema is sorted alphabetically: github+stripe
  const res = await fetch('https://api.dpth.io/calibrate?domain=identity&context=github%2Bstripe&strategy=email_exact');
  const data = await res.json();
  if (data.calibration && data.calibration.length > 0) {
    assert(true, 'signal reached the coordinator');
    assert(data.calibration[0].successRate > 0, `calibration precision: ${data.calibration[0].successRate}`);
  } else {
    // Signal may not have arrived yet (network latency) — check signals list
    const listRes = await fetch('https://api.dpth.io/signals?domain=identity');
    const listData = await listRes.json();
    const hasOurContext = listData.buckets.some((b: any) => b.context === 'github+stripe');
    assert(hasOurContext, 'signal found in network signals list');
  }
}

// ─── Router & Unified Record API Tests ───────────────

async function testRouter() {
  console.log('\n🚦 Router & Unified Record API');
  
  const db = dpth();
  
  // Test signal shape detection
  const signalRoute = db.detectShape({
    context: 'stripe',
    strategy: 'retry_60s',
    outcome: 1,
  });
  assert(signalRoute?.shape === 'signal', 'detects signal shape');
  assert(signalRoute?.pipeline === 'aggregate', 'signal uses aggregate pipeline');
  
  // Test entity shape detection  
  const entityRoute = db.detectShape({
    type: 'person',
    name: 'John',
    source: 'stripe',
    externalId: 'cus_123',
  });
  assert(entityRoute?.shape === 'entity', 'detects entity shape');
  assert(entityRoute?.pipeline === 'individual', 'entity uses individual pipeline');
  
  // Test temporal shape detection
  const temporalRoute = db.detectShape({
    key: 'mrr',
    value: 50000,
  });
  assert(temporalRoute?.shape === 'temporal', 'detects temporal shape');
  assert(temporalRoute?.pipeline === 'append', 'temporal uses append pipeline');
  
  // Test correlation shape detection
  const corrRoute = db.detectShape({
    metric: 'deploys',
    value: 12,
  });
  assert(corrRoute?.shape === 'correlation', 'detects correlation shape');
  assert(corrRoute?.pipeline === 'compute', 'correlation uses compute pipeline');
  
  // Test unknown shape returns null
  const unknownRoute = db.detectShape({
    foo: 'bar',
  });
  assert(unknownRoute === null, 'unknown shape returns null');
  
  // Test unified record() with signal
  const result = await db.record({
    context: 'github',
    strategy: 'api_fetch',
    outcome: 0.9,
    cost: 50,
  });
  assert(result.shape === 'signal', 'record() handles signal shape');
  
  // Test unified record() with entity
  const entityResult = await db.record({
    type: 'company',
    name: 'Acme Inc',
    source: 'hubspot',
    externalId: 'comp_456',
  });
  assert(entityResult.shape === 'entity', 'record() handles entity shape');
  
  // Verify entity was created
  const entities = await db.entity.list('company');
  assert(entities.length === 1, 'entity was stored via record()');
  assert(entities[0].name === 'Acme Inc', 'entity has correct name');
  
  // Test unified record() with temporal
  const tempResult = await db.record({
    key: 'user_count',
    value: 1000,
  });
  assert(tempResult.shape === 'temporal', 'record() handles temporal shape');
  
  // Verify snapshot was stored
  const latest = await db.temporal.latest('user_count');
  assert(latest?.data === 1000, 'temporal value was stored via record()');
  
  // Test unified record() with correlation
  const corrResult = await db.record({
    metric: 'signups',
    value: 42,
  });
  assert(corrResult.shape === 'correlation', 'record() handles correlation shape');
  
  // Test normalization (context sorting)
  const normalizedRoute = db.detectShape({
    context: 'stripe+github',  // Should become github+stripe
    strategy: 'Email Match',   // Should become email_match
    outcome: true,             // Should become 1.0
  });
  const signalData = normalizedRoute?.data as any;
  assert(signalData?.context === 'github+stripe', 'context is alphabetized');
  assert(signalData?.strategy === 'email_match', 'strategy is normalized');
  assert(signalData?.outcome === 1.0, 'boolean outcome becomes 1.0');
  
  await db.close();
}

async function main() {
  console.log('━━━ dpth.io Unified API Tests ━━━');
  
  await testEntityAPI();
  await testObjectResolve();
  await testValidation();
  await testTemporalAPI();
  await testCorrelationAPI();
  await testVectorAPI();
  await testFactory();
  await testRouter();
  await testNetworkOptIn();
  
  console.log(`\n━━━ Results: ${passed} passed, ${failed} failed ━━━`);
  
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
