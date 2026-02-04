/**
 * dpth.io Network E2E Test
 * 
 * Tests the full agent lifecycle against the LIVE coordinator at api.dpth.io.
 * Run: npx tsx test/network-e2e.ts
 */

const API = process.env.DPTH_API || 'https://api.dpth.io';

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

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  });
  return { status: res.status, data: await res.json() };
}

async function main() {
  console.log(`\n🌐 dpth.io Network E2E Test (${API})\n`);
  
  // ── 1. Status ──
  console.log('📊 Network Status');
  const { data: status } = await api('/');
  assert(status.network.name === 'dpth.io', 'network name is dpth.io');
  assert(status.network.version === '0.4.0', 'version is 0.4.0');
  assert(typeof status.agents.total === 'number', 'agents.total is number');
  
  // ── 2. Register Agent ──
  console.log('\n🤖 Agent Registration');
  const { status: regStatus, data: regData } = await api('/agents', {
    method: 'POST',
    body: JSON.stringify({
      publicKey: 'test-e2e-key',
      capabilities: { storageCapacityMb: 512, cpuCores: 2, hasGpu: false },
    }),
  });
  assert(regStatus === 201, 'registration returns 201');
  assert(regData.agent.id.startsWith('agent_'), 'agent ID has correct prefix');
  assert(regData.credits.balance === 10, 'starter credits = 10');
  const agentId = regData.agent.id;
  
  // ── 3. Heartbeat ──
  console.log('\n💓 Heartbeat');
  const { data: hbData } = await api(`/agents/${agentId}/heartbeat`, { method: 'POST' });
  assert(hbData.ok === true, 'heartbeat acknowledged');
  
  // ── 4. Submit Resolution Signal ──
  console.log('\n📡 Resolution Signals');
  const { status: sigStatus, data: sigData } = await api('/signals', {
    method: 'POST',
    body: JSON.stringify({
      agentId,
      schema: 'stripe+hubspot',
      rule: 'email_exact_match',
      modifier: 'corporate_domain',
      truePositives: 423,
      falsePositives: 3,
      totalAttempts: 426,
    }),
  });
  assert(sigStatus === 201, 'signal accepted');
  assert(sigData.signal.precision > 0.99, `precision ${sigData.signal.precision} > 0.99`);
  
  // Submit a second signal from same agent, different schema
  await api('/signals', {
    method: 'POST',
    body: JSON.stringify({
      agentId,
      schema: 'stripe+hubspot',
      rule: 'fuzzy_name',
      truePositives: 180,
      falsePositives: 45,
      totalAttempts: 225,
    }),
  });
  
  // ── 5. Query Calibration ──
  console.log('\n🎯 Calibration');
  const { data: calData } = await api('/signals/calibrate?schema=stripe%2Bhubspot&rule=email_exact_match');
  assert(calData.calibration !== null, 'calibration data returned');
  assert(calData.calibration.precision > 0.99, `calibrated precision ${calData.calibration.precision}`);
  assert(calData.calibration.contributorCount >= 1, `${calData.calibration.contributorCount} contributors`);
  
  // Check fuzzy_name calibration too
  const { data: fuzzyCalData } = await api('/signals/calibrate?schema=stripe%2Bhubspot&rule=fuzzy_name');
  assert(fuzzyCalData.calibration.precision < 0.9, `fuzzy_name precision ${fuzzyCalData.calibration.precision} < 0.9 (expected)`);
  
  // ── 6. List Signals ──
  console.log('\n📋 Signal Aggregation');
  const { data: sigList } = await api('/signals?schema=stripe%2Bhubspot');
  assert(sigList.signals.length >= 2, `${sigList.signals.length} signal groups for stripe+hubspot`);
  
  // ── 7. Credits ──
  console.log('\n💰 Credits');
  const { data: credData } = await api(`/credits/${agentId}`);
  assert(credData.balance > 10, `balance ${credData.balance} > 10 (earned from signals)`);
  assert(credData.totalEarned > 10, `totalEarned ${credData.totalEarned}`);
  
  // Leaderboard
  const { data: lbData } = await api('/credits');
  assert(lbData.leaderboard.length >= 1, `${lbData.leaderboard.length} agents on leaderboard`);
  assert(lbData.networkSupply > 0, `network supply: ${lbData.networkSupply}`);
  
  // ── 8. Tasks ──
  console.log('\n📋 Tasks');
  const { status: taskStatus, data: taskData } = await api('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      agentId,
      type: 'resolve',
      payload: { sources: ['stripe', 'hubspot'], entityType: 'person' },
    }),
  });
  assert(taskStatus === 201, 'task created');
  const taskId = taskData.task.id;
  
  // Claim it
  const { data: claimData } = await api(`/tasks/${taskId}/claim`, {
    method: 'POST',
    body: JSON.stringify({ agentId }),
  });
  assert(claimData.task.status === 'claimed', 'task claimed');
  
  // Complete it
  const { data: completeData } = await api(`/tasks/${taskId}/complete`, {
    method: 'POST',
    body: JSON.stringify({ agentId, result: { entitiesResolved: 42 }, reward: 5 }),
  });
  assert(completeData.task.status === 'completed', 'task completed');
  
  // Check credits increased
  const { data: credAfter } = await api(`/credits/${agentId}`);
  assert(credAfter.balance > credData.balance, `credits increased: ${credData.balance} → ${credAfter.balance}`);
  
  // ── 9. Final Status ──
  console.log('\n📊 Final Network Status');
  const { data: finalStatus } = await api('/');
  assert(finalStatus.intelligence.resolutionSignals > 0, `${finalStatus.intelligence.resolutionSignals} signals in network`);
  
  // ── Summary ──
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  Network E2E: ${passed} passed, ${failed} failed`);
  console.log(`${'═'.repeat(50)}\n`);
  
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
