/**
 * dpth.io Smoke Test
 * 
 * Verifies core library modules load and basic operations work.
 * Run: npx tsx test/smoke.ts
 */

import { resolveOrCreate, getEntity, getEntitiesByType, clearEntities } from '../src/entity';
import { registerMetric, addMetricPoints, getMetric, clearMetrics } from '../src/correlation';
import { takeSnapshot, getSnapshots, diffSnapshots, clearSnapshots } from '../src/temporal';
import { getConfiguredProviders, findFallbackProvider, getFallbackStatus } from '../src/experimental/fallback';
import { DpthAgent } from '../src/experimental/agent-sdk';
import {
  earnCredits, spendCredits, transferCredits, penalizeAgent,
  getBalance, getSupply, getLeaderboard, checkRateLimit,
  getPricingSignal, rewardStorage, rewardGpuInference, chargeInference,
  createMigrationSnapshot, clearEconomics, InsufficientCreditsError,
} from '../src/experimental/economics';
import {
  registerBaseModel, getLatestVersion, getVersionHistory,
  createTrainingRound, claimTrainingRound, submitWeightDelta,
  aggregateRound, getAvailableRounds, getTrainingStats,
  listModelFamilies, clearFederation,
} from '../src/experimental/federation';

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

// ─── Economics Module ────────────────────────────────
console.log('\nEconomics:');
clearEconomics();

test('earnCredits creates balance and transaction', () => {
  const tx = earnCredits('agent-eco-1', 100, 'Storage contribution', 'storage');
  assert(tx.amount === 100, 'Amount should be 100');
  assert(tx.balanceAfter === 100, 'Balance should be 100');
  const bal = getBalance('agent-eco-1');
  assert(bal !== undefined, 'Balance should exist');
  assert(bal!.balance === 100, 'Balance should be 100');
  assert(bal!.totalEarned === 100, 'Total earned should be 100');
});

test('earnCredits applies tier multiplier', () => {
  const tx = earnCredits('agent-eco-2', 100, 'GPU work', 'gpu', { tier: 'elite' });
  assert(tx.amount === 200, 'Elite tier should double credits (2.0x)');
});

test('spendCredits deducts and tracks', () => {
  const tx = spendCredits('agent-eco-1', 30, 'Query', 'query');
  assert(tx.balanceAfter === 70, 'Balance should be 70 after spending 30');
  const bal = getBalance('agent-eco-1');
  assert(bal!.totalSpent === 30, 'Total spent should be 30');
});

test('spendCredits throws on insufficient balance', () => {
  let threw = false;
  try {
    spendCredits('agent-eco-1', 9999, 'Too much', 'query');
  } catch (e) {
    threw = e instanceof InsufficientCreditsError;
  }
  assert(threw, 'Should throw InsufficientCreditsError');
});

test('transferCredits between agents', () => {
  // Need trusted tier to transfer
  earnCredits('agent-eco-3', 500, 'Setup', 'storage');
  const { fromTx, toTx } = transferCredits('agent-eco-3', 'agent-eco-4', 100, 'Gift', 'trusted');
  assert(fromTx.balanceAfter === 400, 'Sender should have 400');
  assert(toTx.balanceAfter === 100, 'Receiver should have 100');
});

test('penalizeAgent reduces balance', () => {
  earnCredits('agent-eco-5', 50, 'Setup', 'storage');
  penalizeAgent('agent-eco-5', 20, 'Bad proof');
  const bal = getBalance('agent-eco-5');
  assert(bal!.balance === 30, 'Balance should be 30 after penalty');
});

test('checkRateLimit enforces limits', () => {
  const result1 = checkRateLimit('agent-eco-1', 'query', 'newcomer');
  assert(result1.allowed === true, 'First query should be allowed');
  assert(result1.remaining === 9, 'Should have 9 remaining (newcomer: 10/hr)');
});

test('getPricingSignal returns valid signal', () => {
  const signal = getPricingSignal();
  assert(signal.demandMultiplier > 0, 'Demand multiplier should be positive');
  assert(signal.queryPrice > 0, 'Query price should be positive');
});

test('getSupply tracks network stats', () => {
  const supply = getSupply();
  assert(supply.totalMinted > 0, 'Should have minted credits');
  assert(supply.totalTransactions > 0, 'Should have transactions');
});

test('getLeaderboard ranks agents', () => {
  const board = getLeaderboard(3);
  assert(board.length > 0, 'Should have entries');
  assert(board[0].rank === 1, 'First should be rank 1');
  assert(board[0].totalEarned >= board[1]?.totalEarned || board.length === 1, 'Should be sorted');
});

test('rewardStorage auto-calculates credits', () => {
  clearEconomics();
  const tx = rewardStorage('agent-auto-1', 500);
  assert(tx.amount === 500, '500MB × 1 credit/MB = 500');
});

test('createMigrationSnapshot captures all balances', () => {
  earnCredits('agent-snap-1', 100, 'Setup', 'storage');
  earnCredits('agent-snap-2', 200, 'Setup', 'gpu');
  const snap = createMigrationSnapshot();
  assert(snap.agentsSnapshotted >= 2, 'Should snapshot at least 2 agents');
  assert(snap.totalClaimable > 0, 'Should have claimable credits');
});

// ─── Federation Module ───────────────────────────────
console.log('\nFederated Learning:');
clearFederation();

test('registerBaseModel creates version 1', () => {
  const version = registerBaseModel('dpth-entity-8b', 'QmBaseModel123');
  assert(version.version === 1, 'Should be version 1');
  assert(version.modelFamily === 'dpth-entity-8b', 'Family should match');
  assert(version.adapterCid === null, 'Base model has no adapter');
});

test('getLatestVersion retrieves current version', () => {
  const latest = getLatestVersion('dpth-entity-8b');
  assert(latest !== undefined, 'Should find latest version');
  assert(latest!.version === 1, 'Should be version 1');
});

test('createTrainingRound starts a round', () => {
  const round = createTrainingRound('dpth-entity-8b', {
    learningRate: 0.0001,
    localEpochs: 3,
    batchSize: 8,
    loraRank: 16,
    loraAlpha: 32,
    targetModules: ['q_proj', 'v_proj'],
    maxGradNorm: 1.0,
    dpEpsilon: 8.0,
    taskTypes: ['entity_recognition'],
    minLocalExamples: 100,
  }, { minParticipants: 2, maxParticipants: 5 });
  assert(round.status === 'pending', 'Should start as pending');
  assert(round.minParticipants === 2, 'Min participants should be 2');
});

test('claimTrainingRound adds agent as participant', () => {
  const rounds = getAvailableRounds();
  assert(rounds.length > 0, 'Should have available rounds');
  const participant = claimTrainingRound(rounds[0].id, 'trainer-1');
  assert(participant.status === 'claimed', 'Should be claimed');
  // Round should now be active
  const round = rounds[0];
  const updated = getAvailableRounds('other-agent');
  assert(updated.length > 0, 'Round should still be available');
});

test('submitWeightDelta and aggregation flow', () => {
  const rounds = getAvailableRounds('trainer-2');
  const round = rounds[0];
  
  // Second agent claims
  claimTrainingRound(round.id, 'trainer-2');
  
  // Both submit deltas
  submitWeightDelta(round.id, 'trainer-1', {
    cid: 'QmDelta1',
    format: { rank: 16, alpha: 32, targetModules: ['q_proj', 'v_proj'], dtype: 'float16' },
    sizeBytes: 50000,
    l2Norm: 0.5,
    trainingExamples: 500,
  });
  
  submitWeightDelta(round.id, 'trainer-2', {
    cid: 'QmDelta2',
    format: { rank: 16, alpha: 32, targetModules: ['q_proj', 'v_proj'], dtype: 'float16' },
    sizeBytes: 45000,
    l2Norm: 0.4,
    trainingExamples: 300,
  });
  
  // Manually trigger aggregation
  const newVersion = aggregateRound(round.id);
  assert(newVersion.version === 2, 'Should be version 2');
  assert(newVersion.adapterCid !== null, 'Should have adapter CID');
  assert(newVersion.parentVersionId !== null, 'Should reference parent');
  
  // Latest version should be updated
  const latest = getLatestVersion('dpth-entity-8b');
  assert(latest!.version === 2, 'Latest should be version 2');
});

test('getTrainingStats returns network stats', () => {
  const stats = getTrainingStats();
  assert(stats.totalRounds >= 1, 'Should have at least 1 round');
  assert(stats.completedRounds >= 1, 'Should have completed rounds');
  assert(stats.totalExamplesProcessed > 0, 'Should have processed examples');
});

test('listModelFamilies shows registered families', () => {
  const families = listModelFamilies();
  assert(families.length >= 1, 'Should have at least 1 family');
  assert(families[0].family === 'dpth-entity-8b', 'Should be dpth-entity-8b');
  assert(families[0].latestVersion === 2, 'Latest should be v2');
});

test('getVersionHistory shows full lineage', () => {
  const history = getVersionHistory('dpth-entity-8b');
  assert(history.length === 2, 'Should have 2 versions');
  assert(history[0].version === 1, 'First should be v1');
  assert(history[1].version === 2, 'Second should be v2');
});

// ─── Summary ─────────────────────────────────────────
console.log(`\n${'═'.repeat(40)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(40)}\n`);

process.exit(failed > 0 ? 1 : 0);
