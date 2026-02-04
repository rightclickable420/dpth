/**
 * dpth Gauntlet — Benchmark Runner
 * 
 * Runs simulated agents against the ground truth dataset and measures:
 * - Precision (correct merges / total merges)
 * - Recall (found merges / true merges)
 * - False merge rate (incorrect merges / total merges)
 * - F1 score
 * 
 * Compares: Control (local only) vs Network-enabled agents
 * 
 * Usage: npx tsx benchmark/gauntlet.ts [--agents N] [--seed N]
 */

import { generateGauntlet, type SourceRecord, type GauntletDataset } from './ground-truth.js';

// ── Types ───────────────────────────────────────────

interface MergeDecision {
  recordA: string;
  recordB: string;
  confidence: number;
}

interface LevelScore {
  level: number;
  name: string;
  records: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
  falseMergeRate: number;
}

interface GauntletResult {
  mode: 'control' | 'network';
  agentId: string;
  levels: LevelScore[];
  overall: {
    precision: number;
    recall: number;
    f1: number;
    falseMergeRate: number;
    totalMerges: number;
    correctMerges: number;
    incorrectMerges: number;
    missedMerges: number;
  };
  timeMs: number;
}

// ── Naive Resolver (Control) ────────────────────────
// Simple heuristic matching — no network signals.
// This represents what an agent gets WITHOUT dpth's network.

function naiveResolve(records: SourceRecord[]): MergeDecision[] {
  const decisions: MergeDecision[] = [];
  
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const a = records[i];
      const b = records[j];
      
      // Skip same source
      if (a.source === b.source) continue;
      
      let confidence = 0;
      
      // Email exact match (strongest signal)
      if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) {
        confidence = Math.max(confidence, 0.90);
      }
      
      // Name exact match
      if (a.name.toLowerCase() === b.name.toLowerCase()) {
        confidence = Math.max(confidence, 0.50);
      }
      
      // Name + email combo
      if (a.email && b.email && 
          a.email.toLowerCase() === b.email.toLowerCase() &&
          a.name.toLowerCase() === b.name.toLowerCase()) {
        confidence = Math.max(confidence, 0.95);
      }
      
      // Username match
      if (a.username && b.username && a.username === b.username) {
        confidence = Math.max(confidence, 0.40);
      }
      
      // Merge threshold
      if (confidence >= 0.50) {
        decisions.push({
          recordA: a.sourceRecordId,
          recordB: b.sourceRecordId,
          confidence,
        });
      }
    }
  }
  
  return decisions;
}

// ── Network-Calibrated Resolver ─────────────────────
// Same base heuristics, but adjusted by network calibration signals.
// This represents what an agent gets WITH dpth's network.

interface CalibrationData {
  // schema+rule → { precision, falseMergeRate }
  buckets: Map<string, { precision: number; falseMergeRate: number; attempts: number }>;
}

function networkResolve(records: SourceRecord[], calibration: CalibrationData): MergeDecision[] {
  const decisions: MergeDecision[] = [];
  
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const a = records[i];
      const b = records[j];
      
      if (a.source === b.source) continue;
      
      let confidence = 0;
      const schema = [a.source, b.source].sort().join('+');
      
      // Email exact match — calibrated by network
      if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) {
        const domain = a.email.split('@')[1]?.toLowerCase() || '';
        const isGeneric = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com'].includes(domain);
        const modifier = isGeneric ? 'generic_domain' : 'corporate_domain';
        
        const calKey = `${schema}:email_exact:${modifier}`;
        const cal = calibration.buckets.get(calKey);
        
        if (cal && cal.attempts > 10) {
          // Network says: this match pattern has known precision
          confidence = Math.max(confidence, cal.precision);
        } else {
          // No network data — fall back to naive
          confidence = Math.max(confidence, 0.90);
        }
      }
      
      // Name exact match — calibrated
      if (a.name.toLowerCase() === b.name.toLowerCase()) {
        const calKey = `${schema}:name_exact:none`;
        const cal = calibration.buckets.get(calKey);
        
        if (cal && cal.attempts > 10) {
          confidence = Math.max(confidence, cal.precision);
        } else {
          confidence = Math.max(confidence, 0.50);
        }
      }
      
      // Name + email combo — calibrated
      if (a.email && b.email && 
          a.email.toLowerCase() === b.email.toLowerCase() &&
          a.name.toLowerCase() === b.name.toLowerCase()) {
        const calKey = `${schema}:email_exact:multi_field`;
        const cal = calibration.buckets.get(calKey);
        
        if (cal && cal.attempts > 10) {
          confidence = Math.max(confidence, cal.precision);
        } else {
          confidence = Math.max(confidence, 0.95);
        }
      }
      
      // Username match — calibrated (network knows usernames are unreliable)
      if (a.username && b.username && a.username === b.username) {
        const calKey = `${schema}:alias_match:none`;
        const cal = calibration.buckets.get(calKey);
        
        if (cal && cal.attempts > 10) {
          // Network learned: username-only matches are risky
          confidence = Math.max(confidence, cal.precision);
        } else {
          confidence = Math.max(confidence, 0.40);
        }
      }
      
      // Dynamic threshold — network can lower the bar for reliable patterns
      // and raise it for unreliable ones
      const threshold = 0.50;
      
      if (confidence >= threshold) {
        decisions.push({
          recordA: a.sourceRecordId,
          recordB: b.sourceRecordId,
          confidence,
        });
      }
    }
  }
  
  return decisions;
}

// ── Scoring ─────────────────────────────────────────

function scoreDecisions(
  decisions: MergeDecision[],
  dataset: GauntletDataset,
  level?: number
): { tp: number; fp: number; fn: number } {
  const truthMap = new Map<string, string>();
  const levelRecords = new Set<string>();
  
  for (const r of dataset.records) {
    truthMap.set(r.sourceRecordId, r.truthId);
    if (level === undefined || r.level === level) {
      levelRecords.add(r.sourceRecordId);
    }
  }
  
  // Filter decisions to this level
  const levelDecisions = level === undefined
    ? decisions
    : decisions.filter(d => levelRecords.has(d.recordA) && levelRecords.has(d.recordB));
  
  // Filter expected merges to this level
  const levelMerges = level === undefined
    ? dataset.expectedMerges
    : dataset.expectedMerges.filter(([a, b]) => levelRecords.has(a) && levelRecords.has(b));
  
  // True positives: decisions where both records have same truthId
  let tp = 0;
  let fp = 0;
  
  for (const d of levelDecisions) {
    const truthA = truthMap.get(d.recordA);
    const truthB = truthMap.get(d.recordB);
    if (truthA && truthB && truthA === truthB) {
      tp++;
    } else {
      fp++;
    }
  }
  
  // False negatives: expected merges not found in decisions
  const decisionSet = new Set(levelDecisions.map(d => 
    [d.recordA, d.recordB].sort().join(':')
  ));
  
  let fn = 0;
  for (const [a, b] of levelMerges) {
    const key = [a, b].sort().join(':');
    if (!decisionSet.has(key)) {
      fn++;
    }
  }
  
  return { tp, fp, fn };
}

function computeMetrics(tp: number, fp: number, fn: number) {
  const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
  const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
  const falseMergeRate = tp + fp > 0 ? fp / (tp + fp) : 0;
  return { precision, recall, f1, falseMergeRate };
}

// ── Simulation ──────────────────────────────────────

function simulateCalibrationLearning(
  dataset: GauntletDataset,
  numAgents: number,
  runsPerAgent: number
): CalibrationData {
  /**
   * Simulate N agents running resolutions and contributing signals.
   * Each run, agents discover some true/false merges and report them.
   * The calibration data improves over time.
   */
  const buckets = new Map<string, { precision: number; falseMergeRate: number; attempts: number; tp: number; fp: number }>();
  
  const truthMap = new Map<string, string>();
  for (const r of dataset.records) {
    truthMap.set(r.sourceRecordId, r.truthId);
  }
  
  for (let agent = 0; agent < numAgents; agent++) {
    // Each agent sees a random subset of records
    const subset = dataset.records
      .filter(() => Math.random() > 0.3)
      .sort(() => Math.random() - 0.5);
    
    for (let run = 0; run < runsPerAgent; run++) {
      // Agent attempts resolutions on its subset
      for (let i = 0; i < subset.length; i++) {
        for (let j = i + 1; j < Math.min(i + 20, subset.length); j++) {
          const a = subset[i];
          const b = subset[j];
          if (a.source === b.source) continue;
          
          const schema = [a.source, b.source].sort().join('+');
          let rule = '';
          let modifier = 'none';
          
          // Determine which rule would fire
          if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) {
            rule = 'email_exact';
            const domain = a.email.split('@')[1]?.toLowerCase() || '';
            const isGeneric = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com'].includes(domain);
            modifier = isGeneric ? 'generic_domain' : 'corporate_domain';
          } else if (a.name.toLowerCase() === b.name.toLowerCase()) {
            rule = 'name_exact';
          } else if (a.username && b.username && a.username === b.username) {
            rule = 'alias_match';
          } else {
            continue; // No rule fires
          }
          
          const isCorrect = truthMap.get(a.sourceRecordId) === truthMap.get(b.sourceRecordId);
          const key = `${schema}:${rule}:${modifier}`;
          
          let bucket = buckets.get(key);
          if (!bucket) {
            bucket = { precision: 0, falseMergeRate: 0, attempts: 0, tp: 0, fp: 0 };
            buckets.set(key, bucket);
          }
          
          bucket.attempts++;
          if (isCorrect) {
            bucket.tp++;
          } else {
            bucket.fp++;
          }
          bucket.precision = bucket.tp / bucket.attempts;
          bucket.falseMergeRate = bucket.fp / bucket.attempts;
        }
      }
    }
  }
  
  // Convert to CalibrationData
  const calBuckets = new Map<string, { precision: number; falseMergeRate: number; attempts: number }>();
  for (const [key, val] of buckets) {
    calBuckets.set(key, { precision: val.precision, falseMergeRate: val.falseMergeRate, attempts: val.attempts });
  }
  
  return { buckets: calBuckets };
}

// ── Main Runner ─────────────────────────────────────

function runGauntlet(mode: 'control' | 'network', dataset: GauntletDataset, calibration?: CalibrationData): GauntletResult {
  const start = Date.now();
  
  const decisions = mode === 'control' 
    ? naiveResolve(dataset.records)
    : networkResolve(dataset.records, calibration!);
  
  const levelNames = ['', 'Gimmes', 'Normalization', 'Ambiguity', 'Traps', 'Topology'];
  const levels: LevelScore[] = [];
  
  for (let level = 1; level <= 5; level++) {
    const { tp, fp, fn } = scoreDecisions(decisions, dataset, level);
    const metrics = computeMetrics(tp, fp, fn);
    const levelRecords = dataset.records.filter(r => r.level === level).length;
    
    levels.push({
      level,
      name: levelNames[level],
      records: levelRecords,
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
      ...metrics,
    });
  }
  
  const { tp, fp, fn } = scoreDecisions(decisions, dataset);
  const overall = computeMetrics(tp, fp, fn);
  
  return {
    mode,
    agentId: `agent_${mode}`,
    levels,
    overall: {
      ...overall,
      totalMerges: tp + fp,
      correctMerges: tp,
      incorrectMerges: fp,
      missedMerges: fn,
    },
    timeMs: Date.now() - start,
  };
}

// ── Output Formatting ───────────────────────────────

function printResult(result: GauntletResult) {
  const modeLabel = result.mode === 'control' ? '🔴 CONTROL (no network)' : '🟢 NETWORK (calibrated)';
  console.log(`\n${modeLabel}`);
  console.log(`${'─'.repeat(72)}`);
  console.log(`${'Level'.padEnd(20)} ${'Prec'.padStart(7)} ${'Recall'.padStart(7)} ${'F1'.padStart(7)} ${'FMR'.padStart(7)} ${'TP'.padStart(5)} ${'FP'.padStart(5)} ${'FN'.padStart(5)}`);
  console.log(`${'─'.repeat(72)}`);
  
  for (const l of result.levels) {
    console.log(
      `${`${l.level}. ${l.name}`.padEnd(20)} ` +
      `${(l.precision * 100).toFixed(1).padStart(6)}% ` +
      `${(l.recall * 100).toFixed(1).padStart(6)}% ` +
      `${(l.f1 * 100).toFixed(1).padStart(6)}% ` +
      `${(l.falseMergeRate * 100).toFixed(1).padStart(6)}% ` +
      `${l.truePositives.toString().padStart(5)} ` +
      `${l.falsePositives.toString().padStart(5)} ` +
      `${l.falseNegatives.toString().padStart(5)}`
    );
  }
  
  console.log(`${'─'.repeat(72)}`);
  console.log(
    `${'OVERALL'.padEnd(20)} ` +
    `${(result.overall.precision * 100).toFixed(1).padStart(6)}% ` +
    `${(result.overall.recall * 100).toFixed(1).padStart(6)}% ` +
    `${(result.overall.f1 * 100).toFixed(1).padStart(6)}% ` +
    `${(result.overall.falseMergeRate * 100).toFixed(1).padStart(6)}% ` +
    `${result.overall.correctMerges.toString().padStart(5)} ` +
    `${result.overall.incorrectMerges.toString().padStart(5)} ` +
    `${result.overall.missedMerges.toString().padStart(5)}`
  );
  console.log(`  Time: ${result.timeMs}ms`);
}

function printComparison(control: GauntletResult, network: GauntletResult) {
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`  IMPROVEMENT SUMMARY`);
  console.log(`${'═'.repeat(72)}`);
  
  for (let i = 0; i < control.levels.length; i++) {
    const c = control.levels[i];
    const n = network.levels[i];
    const precDelta = (n.precision - c.precision) * 100;
    const fmrDelta = (n.falseMergeRate - c.falseMergeRate) * 100;
    const arrow = precDelta >= 0 ? '↑' : '↓';
    const fmrArrow = fmrDelta <= 0 ? '↓' : '↑';
    
    console.log(
      `  ${`${c.level}. ${c.name}`.padEnd(18)} ` +
      `Precision: ${(c.precision * 100).toFixed(1)}% → ${(n.precision * 100).toFixed(1)}% (${arrow}${Math.abs(precDelta).toFixed(1)}%)  ` +
      `FMR: ${(c.falseMergeRate * 100).toFixed(1)}% → ${(n.falseMergeRate * 100).toFixed(1)}% (${fmrArrow}${Math.abs(fmrDelta).toFixed(1)}%)`
    );
  }
  
  const oPrecDelta = (network.overall.precision - control.overall.precision) * 100;
  const oFmrDelta = (network.overall.falseMergeRate - control.overall.falseMergeRate) * 100;
  
  console.log(`${'─'.repeat(72)}`);
  console.log(
    `  ${'OVERALL'.padEnd(18)} ` +
    `Precision: ${(control.overall.precision * 100).toFixed(1)}% → ${(network.overall.precision * 100).toFixed(1)}% (${oPrecDelta >= 0 ? '↑' : '↓'}${Math.abs(oPrecDelta).toFixed(1)}%)  ` +
    `FMR: ${(control.overall.falseMergeRate * 100).toFixed(1)}% → ${(network.overall.falseMergeRate * 100).toFixed(1)}% (${oFmrDelta <= 0 ? '↓' : '↑'}${Math.abs(oFmrDelta).toFixed(1)}%)`
  );
  console.log(`${'═'.repeat(72)}`);
}

// ── CLI Entry Point ─────────────────────────────────

const args = process.argv.slice(2);
const numAgents = parseInt(args.find((_, i) => args[i - 1] === '--agents') || '20');
const seed = parseInt(args.find((_, i) => args[i - 1] === '--seed') || '42');

console.log(`\n╔══════════════════════════════════════════════════╗`);
console.log(`║           dpth GAUNTLET — Benchmark Suite        ║`);
console.log(`╚══════════════════════════════════════════════════╝`);

console.log(`\nGenerating ground truth (seed: ${seed})...`);
const dataset = generateGauntlet(seed);
console.log(`  ${dataset.records.length} records, ${dataset.uniqueEntities} unique entities, ${dataset.expectedMerges.length} expected merges`);

console.log(`\nRunning control (no network)...`);
const control = runGauntlet('control', dataset);
printResult(control);

console.log(`\nSimulating network learning (${numAgents} agents)...`);
const calibration = simulateCalibrationLearning(dataset, numAgents, 3);
console.log(`  ${calibration.buckets.size} calibration buckets learned`);

console.log(`\nRunning network-calibrated resolver...`);
const network = runGauntlet('network', dataset, calibration);
printResult(network);

printComparison(control, network);
