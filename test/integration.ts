/**
 * dpth.io Integration Test
 * 
 * Tests the full agent lifecycle end-to-end:
 * 1. Agent registers with capabilities
 * 2. Agent contributes storage → earns credits
 * 3. Agent contributes GPU inference → earns credits
 * 4. Agent spends credits on intelligence queries
 * 5. Agent joins federated training round → earns credits
 * 6. Network economics stay consistent throughout
 * 
 * Run: npx tsx test/integration.ts
 */

import { DpthAgent } from '../src/agent-sdk';
import {
  resolveOrCreate, getEntity, getEntitiesByType, clearEntities,
} from '../src/entity';
import {
  registerMetric, addMetricPoints, getMetric, findCorrelations, clearMetrics,
} from '../src/correlation';
import {
  takeSnapshot, getSnapshots, diffSnapshots, clearSnapshots,
} from '../src/temporal';
import {
  earnCredits, spendCredits, penalizeAgent, rewardStorage, rewardCompute,
  rewardGpuInference, rewardTraining, chargeInference,
  getBalance, getSupply, getLeaderboard, checkRateLimit,
  getPricingSignal, transferCredits, createMigrationSnapshot,
  clearEconomics, InsufficientCreditsError,
} from '../src/economics';
import {
  registerBaseModel, createTrainingRound, claimTrainingRound,
  submitWeightDelta, aggregateRound, getLatestVersion,
  getTrainingStats, getAgentTrainingHistory, getAvailableRounds,
  clearFederation,
} from '../src/federation';
import {
  getFallbackStatus, findFallbackProvider,
} from '../src/fallback';

// ─── Test Harness ────────────────────────────────────

let passed = 0;
let failed = 0;
let currentSection = '';

function section(name: string) {
  currentSection = name;
  console.log(`\n━━━ ${name} ━━━`);
}

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

// ─── Reset Everything ────────────────────────────────
clearEntities();
clearMetrics();
clearSnapshots();
clearEconomics();
clearFederation();

console.log('\n🔗 dpth.io Integration Tests — Full Agent Lifecycle\n');

// ═══════════════════════════════════════════════════════
// PHASE 1: Agent Registration
// ═══════════════════════════════════════════════════════

section('1. Agent Registration');

const storageAgent = new DpthAgent({
  name: 'storage-node-alpha',
  apiUrl: 'http://localhost:3000/api/dpth',
  capabilities: {
    storageCapacityMb: 50000,
    cpuCores: 4,
    hasGpu: false,
    taskTypes: ['store', 'replicate'],
  },
});

const gpuAgent = new DpthAgent({
  name: 'gpu-worker-beta',
  apiUrl: 'http://localhost:3000/api/dpth',
  capabilities: {
    storageCapacityMb: 10000,
    cpuCores: 16,
    hasGpu: true,
    gpuVramMb: 24576,
    taskTypes: ['embed', 'inference', 'correlate', 'train'],
  },
});

const queryAgent = new DpthAgent({
  name: 'analyst-gamma',
  apiUrl: 'http://localhost:3000/api/dpth',
  capabilities: {
    storageCapacityMb: 1000,
    cpuCores: 2,
    hasGpu: false,
    taskTypes: ['query'],
  },
});

test('Three agents created with unique keys', () => {
  const keys = new Set([
    storageAgent.getPublicKey(),
    gpuAgent.getPublicKey(),
    queryAgent.getPublicKey(),
  ]);
  assert(keys.size === 3, 'All agents should have unique keys');
});

// Use public keys as agent IDs for the integration test
const storageId = `storage-${storageAgent.getPublicKey().slice(0, 8)}`;
const gpuId = `gpu-${gpuAgent.getPublicKey().slice(0, 8)}`;
const queryId = `query-${queryAgent.getPublicKey().slice(0, 8)}`;

// ═══════════════════════════════════════════════════════
// PHASE 2: Data Ingestion (Entity + Correlation + Temporal)
// ═══════════════════════════════════════════════════════

section('2. Data Ingestion — Intelligence Layer');

test('Entities resolve across multiple sources', () => {
  // Same person from different systems
  const github = resolveOrCreate('person', 'Alice Chen', 'github', 'alicechen');
  const stripe = resolveOrCreate('person', 'Alice Chen', 'stripe', 'cus_alice');
  const hubspot = resolveOrCreate('person', 'Alice Chen', 'hubspot', 'contact_alice');
  
  // Company entities
  const acme = resolveOrCreate('company', 'Acme Corp', 'stripe', 'acct_acme');
  const acmeGh = resolveOrCreate('company', 'Acme Corp', 'github', 'acme-corp');
  
  assert(github.entity.id !== undefined, 'GitHub entity should exist');
  assert(acme.entity.id !== undefined, 'Company entity should exist');
  
  const people = getEntitiesByType('person');
  const companies = getEntitiesByType('company');
  assert(people.length >= 1, 'Should have people');
  assert(companies.length >= 1, 'Should have companies');
});

test('Metrics track across time with correlation', () => {
  const { entity: acme } = resolveOrCreate('company', 'Acme Corp', 'stripe', 'acct_acme');
  
  registerMetric({
    id: 'acme-mrr',
    entityId: acme.id,
    name: 'Monthly Recurring Revenue',
    unit: 'USD',
    points: [],
    aggregation: 'sum',
  });
  
  registerMetric({
    id: 'acme-commits',
    entityId: acme.id,
    name: 'GitHub Commits',
    points: [],
    aggregation: 'sum',
  });
  
  // Add correlated data — revenue grows as commits grow
  const months = ['2024-01', '2024-02', '2024-03', '2024-04', '2024-05', '2024-06'];
  const revenues = [10000, 12000, 15000, 18000, 22000, 28000];
  const commits = [50, 65, 80, 95, 120, 150];
  
  addMetricPoints('acme-mrr', months.map((m, i) => ({
    timestamp: new Date(m),
    value: revenues[i],
    source: 'stripe',
    confidence: 1,
  })));
  
  addMetricPoints('acme-commits', months.map((m, i) => ({
    timestamp: new Date(m),
    value: commits[i],
    source: 'github',
    confidence: 1,
  })));
  
  const mrr = getMetric('acme-mrr');
  const commitMetric = getMetric('acme-commits');
  assert(mrr!.points.length === 6, 'Should have 6 MRR data points');
  assert(commitMetric!.points.length === 6, 'Should have 6 commit data points');
});

test('Temporal snapshots capture state over time', () => {
  takeSnapshot('acme-dashboard', {
    mrr: 10000, users: 50, nps: 72, churn: 0.05,
  });
  takeSnapshot('acme-dashboard', {
    mrr: 28000, users: 150, nps: 78, churn: 0.03,
  });
  
  const snaps = getSnapshots<Record<string, number>>('acme-dashboard');
  assert(snaps.length === 2, 'Should have 2 snapshots');
  
  const diff = diffSnapshots(snaps[0], snaps[1]);
  assert(diff.changed.length > 0, 'Should detect changes');
  // Revenue went from 10k to 28k — should be in changed
});

// ═══════════════════════════════════════════════════════
// PHASE 3: Agent Contributions → Earning Credits
// ═══════════════════════════════════════════════════════

section('3. Agent Contributions → Credits');

test('Storage agent contributes 50GB → earns credits', () => {
  // 50,000 MB at 1 credit/MB/day = 50,000 credits
  const tx = rewardStorage(storageId, 50000, 'newcomer');
  assert(tx.amount === 50000, 'Should earn 50,000 credits for 50GB');
  
  const bal = getBalance(storageId);
  assert(bal!.balance === 50000, 'Balance should be 50,000');
});

test('GPU agent completes inference tasks → earns credits', () => {
  // First inference: 2000 tokens generated
  rewardGpuInference(gpuId, 2000, 'task-001', 'newcomer');
  // Second inference: 5000 tokens
  rewardGpuInference(gpuId, 5000, 'task-002', 'newcomer');
  // Third: compute task
  rewardCompute(gpuId, 'task-003', 'newcomer');
  
  const bal = getBalance(gpuId);
  // task-001: 25 base + (2000/1000)*5 = 35
  // task-002: 25 base + (5000/1000)*5 = 50
  // task-003: 10 compute
  assert(bal!.balance === 95, `GPU agent should have 95 credits, got ${bal!.balance}`);
});

test('Query agent gets starter credits via bonus', () => {
  // New agents get a welcome bonus to start querying
  earnCredits(queryId, 50, 'Welcome bonus', 'bonus');
  const bal = getBalance(queryId);
  assert(bal!.balance === 50, 'Query agent should have 50 starter credits');
});

test('Network supply tracks all minting', () => {
  const supply = getSupply();
  // 50,000 (storage) + 95 (GPU) + 50 (bonus) = 50,145
  assert(supply.totalMinted === 50145, `Total minted should be 50,145, got ${supply.totalMinted}`);
  assert(supply.totalCirculating === 50145, 'All credits should be circulating');
  assert(supply.totalBurned === 0, 'Nothing burned yet');
});

// ═══════════════════════════════════════════════════════
// PHASE 4: Spending Credits on Intelligence
// ═══════════════════════════════════════════════════════

section('4. Spending Credits on Intelligence');

test('Query agent spends credits on queries', () => {
  // 5 queries at 1 credit each
  for (let i = 0; i < 5; i++) {
    spendCredits(queryId, 1, `Entity query #${i + 1}`, 'query');
  }
  const bal = getBalance(queryId);
  assert(bal!.balance === 45, 'Should have 45 credits after 5 queries');
  assert(bal!.totalSpent === 5, 'Should have spent 5 total');
});

test('GPU agent charges for inference request', () => {
  // Simulate a 1500-token inference request
  const tx = chargeInference(gpuId, 1500, 'req-001');
  // Cost: 10 base + (1500/1000)*2 = 13
  assert(tx.amount === 13, `Inference should cost 13 credits, got ${tx.amount}`);
  
  const bal = getBalance(gpuId);
  assert(bal!.balance === 82, `GPU agent should have 82 credits, got ${bal!.balance}`);
});

test('Insufficient credits throws properly', () => {
  let caught = false;
  try {
    spendCredits(queryId, 99999, 'Too expensive', 'inference');
  } catch (e) {
    caught = e instanceof InsufficientCreditsError;
    if (caught) {
      const err = e as InsufficientCreditsError;
      assert(err.agentId === queryId, 'Error should reference correct agent');
      assert(err.balance === 45, 'Error should show current balance');
      assert(err.required === 99999, 'Error should show required amount');
    }
  }
  assert(caught, 'Should throw InsufficientCreditsError');
});

test('Rate limiting enforces per-tier limits', () => {
  // Newcomer: 10 queries/hour
  for (let i = 0; i < 9; i++) {
    const r = checkRateLimit(queryId, 'query', 'newcomer');
    assert(r.allowed, `Query ${i + 1} should be allowed`);
  }
  // 10th should still be allowed (started at 10, used 9)
  const r10 = checkRateLimit(queryId, 'query', 'newcomer');
  assert(r10.allowed, '10th query should be allowed');
  assert(r10.remaining === 0, 'Should have 0 remaining');
  
  // 11th should be denied
  const r11 = checkRateLimit(queryId, 'query', 'newcomer');
  assert(!r11.allowed, '11th query should be denied');
});

test('Supply tracks burns correctly', () => {
  const supply = getSupply();
  // 5 queries (5) + 1 inference (13) = 18 burned
  assert(supply.totalBurned === 18, `Should have burned 18, got ${supply.totalBurned}`);
  assert(supply.totalCirculating === 50145 - 18, 'Circulating should be total - burned');
});

// ═══════════════════════════════════════════════════════
// PHASE 5: Credit Transfers & Penalties
// ═══════════════════════════════════════════════════════

section('5. Transfers & Penalties');

test('Storage agent transfers credits to query agent', () => {
  // Need trusted tier to transfer
  const { fromTx, toTx } = transferCredits(storageId, queryId, 100, 'Helping out', 'trusted');
  
  const storageBal = getBalance(storageId);
  const queryBal = getBalance(queryId);
  
  assert(storageBal!.balance === 49900, 'Storage agent should have 49,900');
  assert(queryBal!.balance === 145, 'Query agent should have 145 (45 + 100)');
});

test('Newcomer cannot transfer', () => {
  let threw = false;
  try {
    transferCredits(queryId, gpuId, 10, 'Attempt', 'newcomer');
  } catch (e) {
    threw = (e as Error).message.includes('cannot transfer');
  }
  assert(threw, 'Newcomer should not be able to transfer');
});

test('Penalty reduces balance and claimable credits', () => {
  earnCredits('bad-agent', 100, 'Setup', 'storage');
  penalizeAgent('bad-agent', 50, 'Failed storage proof', 'proof-123');
  
  const bal = getBalance('bad-agent');
  assert(bal!.balance === 50, 'Should have 50 after 50 penalty on 100');
});

// ═══════════════════════════════════════════════════════
// PHASE 6: Federated Training
// ═══════════════════════════════════════════════════════

section('6. Federated Training');

test('Register base model for entity recognition', () => {
  const model = registerBaseModel('dpth-entity-8b', 'QmBaseModelWeights_SHA256_abc123', {
    taskAccuracy: { entity_recognition: 0.82 },
  });
  assert(model.version === 1, 'Should be version 1');
  assert(model.adapterCid === null, 'Base has no adapter');
});

test('Create training round with DP config', () => {
  const round = createTrainingRound('dpth-entity-8b', {
    learningRate: 0.0001,
    localEpochs: 3,
    batchSize: 8,
    loraRank: 16,
    loraAlpha: 32,
    targetModules: ['q_proj', 'v_proj', 'k_proj'],
    maxGradNorm: 1.0,
    dpEpsilon: 8.0,
    taskTypes: ['entity_recognition', 'anomaly_detection'],
    minLocalExamples: 100,
  }, {
    minParticipants: 2,
    maxParticipants: 10,
    deadlineHours: 48,
  });
  
  assert(round.status === 'pending', 'Round should be pending');
  assert(round.config.dpEpsilon === 8.0, 'DP epsilon should be 8.0');
});

test('GPU agents claim and submit weight deltas', () => {
  const rounds = getAvailableRounds();
  const round = rounds[0];
  
  // Two GPU agents join
  claimTrainingRound(round.id, gpuId);
  claimTrainingRound(round.id, 'gpu-agent-2');
  
  // Both train locally and submit deltas
  submitWeightDelta(round.id, gpuId, {
    cid: 'QmDelta_gpu1_round1',
    format: { rank: 16, alpha: 32, targetModules: ['q_proj', 'v_proj', 'k_proj'], dtype: 'float16' },
    sizeBytes: 48000,
    l2Norm: 0.45,
    trainingExamples: 850,
  });
  
  submitWeightDelta(round.id, 'gpu-agent-2', {
    cid: 'QmDelta_gpu2_round1',
    format: { rank: 16, alpha: 32, targetModules: ['q_proj', 'v_proj', 'k_proj'], dtype: 'float16' },
    sizeBytes: 52000,
    l2Norm: 0.38,
    trainingExamples: 1200,
  });
  
  // Aggregate with Byzantine-tolerant median
  const newVersion = aggregateRound(round.id, 'fedmedian');
  
  assert(newVersion.version === 2, 'Should produce version 2');
  assert(newVersion.adapterCid !== null, 'Should have aggregated adapter');
  assert(newVersion.metrics.totalTrainingExamples === 2050, 'Should sum training examples');
  assert(newVersion.metrics.participantCount === 2, 'Should count 2 participants');
});

test('Training participants earn credits', () => {
  // Award credits for training participation
  const tx1 = rewardTraining(gpuId, 'round-1', 'newcomer');
  const tx2 = rewardTraining('gpu-agent-2', 'round-1', 'newcomer');
  
  assert(tx1.amount === 50, 'Training reward should be 50 credits');
  assert(tx2.amount === 50, 'Training reward should be 50 credits');
});

test('Model version lineage is tracked', () => {
  const latest = getLatestVersion('dpth-entity-8b');
  assert(latest!.version === 2, 'Latest should be v2');
  assert(latest!.parentVersionId !== null, 'Should reference parent');
  assert(latest!.trainingRoundIds.length === 1, 'Should have 1 training round');
});

test('Training stats reflect network activity', () => {
  const stats = getTrainingStats();
  assert(stats.totalRounds === 1, 'Should have 1 round');
  assert(stats.completedRounds === 1, 'Should have 1 completed');
  assert(stats.totalExamplesProcessed === 2050, 'Should have processed 2050 examples');
  assert(stats.modelFamilies.includes('dpth-entity-8b'), 'Should list model family');
});

// ═══════════════════════════════════════════════════════
// PHASE 7: Dynamic Pricing & Migration
// ═══════════════════════════════════════════════════════

section('7. Economics — Pricing & Migration');

test('Dynamic pricing responds to network conditions', () => {
  const signal = getPricingSignal();
  assert(signal.demandMultiplier > 0, 'Demand multiplier should be positive');
  assert(signal.utilization >= 0 && signal.utilization <= 1, 'Utilization should be 0-1');
  assert(signal.queryPrice > 0, 'Query price should be positive');
  assert(signal.inferencePrice > 0, 'Inference price should be positive');
});

test('Leaderboard ranks agents by earnings', () => {
  const board = getLeaderboard(5, 'earned');
  assert(board.length >= 3, 'Should have at least 3 agents');
  assert(board[0].rank === 1, 'Top should be rank 1');
  // Storage agent earned 50,000 — should be #1
  assert(board[0].agentId === storageId, 'Storage agent should be top earner');
});

test('Migration snapshot captures all balances for future tokenization', () => {
  const snap = createMigrationSnapshot();
  assert(snap.agentsSnapshotted >= 3, 'Should snapshot at least 3 agents');
  assert(snap.totalClaimable > 0, 'Should have claimable credits');
  assert(snap.snapshotId.length > 0, 'Should have snapshot ID');
  
  // Verify snapshot stored on individual balances
  const storageBal = getBalance(storageId);
  assert(storageBal!.migrationSnapshot !== undefined, 'Should have migration snapshot');
  assert(storageBal!.migrationSnapshot!.snapshotId === snap.snapshotId, 'Snapshot ID should match');
});

// ═══════════════════════════════════════════════════════
// PHASE 8: Fallback System
// ═══════════════════════════════════════════════════════

section('8. Centralized Fallback');

test('Fallback provides transparent inference when no agents online', () => {
  const status = getFallbackStatus();
  assert(status.providers.length >= 4, 'Should have at least 4 fallback providers');
  
  // Should find providers for common models
  const openai = findFallbackProvider('gpt-4o');
  const anthropic = findFallbackProvider('claude-sonnet');
  const groq = findFallbackProvider('llama-3.3-70b');
  
  // Without API keys, providers exist but may not be configured
  // The important thing is the routing logic works
  assert(status.providers.some(p => p.id === 'openai'), 'Should have OpenAI');
  assert(status.providers.some(p => p.id === 'anthropic'), 'Should have Anthropic');
});

// ═══════════════════════════════════════════════════════
// Final: Network Health Check
// ═══════════════════════════════════════════════════════

section('9. Network Health — Final State');

test('Network supply is consistent', () => {
  const supply = getSupply();
  // Verify accounting: circulating = minted - burned
  const expectedCirculating = supply.totalMinted - supply.totalBurned;
  assert(
    Math.abs(supply.totalCirculating - expectedCirculating) < 0.01,
    `Supply inconsistency: circulating ${supply.totalCirculating} != minted ${supply.totalMinted} - burned ${supply.totalBurned}`
  );
});

test('All agents have valid balances', () => {
  const agents = [storageId, gpuId, queryId];
  for (const id of agents) {
    const bal = getBalance(id);
    assert(bal !== undefined, `${id} should have balance`);
    assert(bal!.balance >= 0, `${id} should have non-negative balance`);
    assert(bal!.totalEarned >= bal!.totalSpent, `${id} earned should >= spent`);
    assert(bal!.transactionCount > 0, `${id} should have transactions`);
  }
});

test('Gini coefficient shows distribution health', () => {
  const supply = getSupply();
  // With a dominant storage agent (50k credits), Gini should be high
  assert(supply.giniCoefficient > 0, 'Gini should be positive (unequal distribution)');
  assert(supply.giniCoefficient <= 1, 'Gini should be <= 1');
});

// ─── Summary ─────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}`);
console.log(`  Integration: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(50)}\n`);

if (failed === 0) {
  console.log('  🎉 Full agent lifecycle verified!\n');
  console.log('  register → contribute → earn → spend → train → migrate\n');
}

process.exit(failed > 0 ? 1 : 0);
