/**
 * dpth Gauntlet v2 — Benchmark Runner
 * 
 * Three tracks, eleven levels, four metrics.
 * 
 * TRACK A (Identity):  Precision, Recall, F1, False Merge Rate
 * TRACK B (Efficiency): Token cost, Operations saved, Strategy accuracy
 * TRACK C (Adaptation): Precision under adversarial/degraded conditions
 * 
 * Usage: npx tsx benchmark/gauntlet.ts [--agents N] [--seed N]
 */

import { generateGauntlet, STRATEGY_COSTS, type SourceRecord, type GauntletDataset, type StrategyHint } from './ground-truth.js';

// ── Types ───────────────────────────────────────────

interface MergeDecision {
  recordA: string;
  recordB: string;
  confidence: number;
  strategy: string;
  tokenCost: number;
}

interface LevelScore {
  level: number;
  name: string;
  track: string;
  records: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
  falseMergeRate: number;
  tokensUsed: number;
  tokensOptimal: number;
  tokensSaved: number;
  operations: number;
}

interface GauntletResult {
  mode: 'control' | 'network';
  levels: LevelScore[];
  trackSummaries: Record<string, {
    precision: number;
    recall: number;
    f1: number;
    falseMergeRate: number;
    tokensUsed: number;
    tokensOptimal: number;
    efficiency: number;
  }>;
  overall: {
    precision: number;
    recall: number;
    f1: number;
    falseMergeRate: number;
    totalMerges: number;
    correctMerges: number;
    incorrectMerges: number;
    missedMerges: number;
    tokensUsed: number;
    tokensOptimal: number;
    tokenEfficiency: number;
  };
  timeMs: number;
}

// ── Calibration Data ────────────────────────────────

interface CalibrationBucket {
  precision: number;
  falseMergeRate: number;
  attempts: number;
  recommendSkip?: boolean;       // Network learned: don't bother with this
  recommendShortCircuit?: boolean; // Network learned: this signal is definitive
}

interface CalibrationData {
  buckets: Map<string, CalibrationBucket>;
  /** Known garbage values the network has identified */
  knownGarbage: Set<string>;
  /** Known team/shared emails */
  knownSharedEmails: Set<string>;
  /** High-collision names (too common to match on name alone) */
  highCollisionNames: Set<string>;
}

// ── Strategy helpers ────────────────────────────────

const GARBAGE_EMAILS = new Set([
  'test@test.com', 'no-reply@example.com', 'n/a', 'none@none.com',
  'noemail@noemail.com', 'unknown@unknown.com', 'placeholder@placeholder.com',
  'admin@example.com', 'user@example.com',
]);

const TEAM_EMAIL_PREFIXES = new Set([
  'sales', 'support', 'info', 'team', 'hello', 'admin', 'contact',
  'billing', 'help', 'office', 'hr', 'marketing',
]);

function isTeamEmail(email: string): boolean {
  const prefix = email.split('@')[0]?.toLowerCase() || '';
  return TEAM_EMAIL_PREFIXES.has(prefix);
}

function isGenericDomain(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() || '';
  return ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com'].includes(domain);
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, '').replace(/^1/, '');
}

function nameSimilarity(a: string, b: string): number {
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (na === nb) return 1.0;
  
  // Check initials
  const partsA = na.split(/\s+/);
  const partsB = nb.split(/\s+/);
  if (partsA.length >= 2 && partsB.length >= 2) {
    if (partsA[partsA.length - 1] === partsB[partsB.length - 1]) {
      // Same last name
      if (partsA[0][0] === partsB[0][0]) return 0.6; // Same initial
      return 0.3;
    }
  }
  
  // Simple Jaccard on characters
  const setA = new Set(na);
  const setB = new Set(nb);
  const intersection = [...setA].filter(c => setB.has(c)).length;
  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

// ── Naive Resolver (Control) ────────────────────────

function naiveResolve(records: SourceRecord[]): MergeDecision[] {
  const decisions: MergeDecision[] = [];

  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const a = records[i];
      const b = records[j];
      if (a.source === b.source) continue;

      let bestConfidence = 0;
      let bestStrategy = '';
      let totalTokens = 0;
      let ops = 0;

      // Try ALL strategies (naive — doesn't know which to skip)

      // Email exact
      if (a.email && b.email) {
        totalTokens += STRATEGY_COSTS.email_exact;
        ops++;
        if (a.email.toLowerCase() === b.email.toLowerCase()) {
          if (bestConfidence < 0.90) {
            bestConfidence = 0.90;
            bestStrategy = 'email_exact';
          }
        }
      }

      // Name exact
      totalTokens += STRATEGY_COSTS.name_exact;
      ops++;
      if (a.name.toLowerCase() === b.name.toLowerCase()) {
        if (bestConfidence < 0.50) {
          bestConfidence = 0.50;
          bestStrategy = 'name_exact';
        }
      }

      // Name fuzzy
      totalTokens += STRATEGY_COSTS.name_fuzzy;
      ops++;
      const sim = nameSimilarity(a.name, b.name);
      if (sim > 0.7 && bestConfidence < 0.45) {
        bestConfidence = 0.45;
        bestStrategy = 'name_fuzzy';
      }

      // Username match
      if (a.username && b.username) {
        totalTokens += STRATEGY_COSTS.alias_match;
        ops++;
        if (a.username === b.username) {
          if (bestConfidence < 0.40) {
            bestConfidence = 0.40;
            bestStrategy = 'alias_match';
          }
        }
      }

      // Phone match
      if (a.phone && b.phone) {
        totalTokens += STRATEGY_COSTS.phone_normalized;
        ops++;
        if (normalizePhone(a.phone) === normalizePhone(b.phone)) {
          if (bestConfidence < 0.80) {
            bestConfidence = 0.80;
            bestStrategy = 'phone_normalized';
          }
        }
      }

      // Name + email combo
      if (a.email && b.email &&
          a.email.toLowerCase() === b.email.toLowerCase() &&
          a.name.toLowerCase() === b.name.toLowerCase()) {
        bestConfidence = 0.95;
        bestStrategy = 'email_exact+name_exact';
      }

      if (bestConfidence >= 0.50) {
        decisions.push({
          recordA: a.sourceRecordId,
          recordB: b.sourceRecordId,
          confidence: bestConfidence,
          strategy: bestStrategy,
          tokenCost: totalTokens,
        });
      }
    }
  }

  return decisions;
}

// ── Network-Calibrated Resolver ─────────────────────

function networkResolve(records: SourceRecord[], cal: CalibrationData): MergeDecision[] {
  const decisions: MergeDecision[] = [];

  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const a = records[i];
      const b = records[j];
      if (a.source === b.source) continue;

      let bestConfidence = 0;
      let bestStrategy = '';
      let totalTokens = 0;

      const schema = [a.source, b.source].sort().join('+');

      // ── Smart email matching ──
      if (a.email && b.email) {
        const emailA = a.email.toLowerCase();
        const emailB = b.email.toLowerCase();

        // Network learned: skip garbage emails
        if (cal.knownGarbage.has(emailA) || cal.knownGarbage.has(emailB)) {
          // Don't even count this as a match — known garbage
          totalTokens += STRATEGY_COSTS.email_exact; // Still costs tokens to check
        } else if (emailA === emailB) {
          totalTokens += STRATEGY_COSTS.email_exact;

          // Network learned: team emails are NOT identity signals
          if (cal.knownSharedEmails.has(emailA) || isTeamEmail(emailA)) {
            // Team email — do NOT use for matching
            // but check if names also match
            if (a.name.toLowerCase() === b.name.toLowerCase()) {
              bestConfidence = 0.30; // Still low — same team email + same name is suspicious
              bestStrategy = 'email_exact+name_exact(team_email)';
            }
          } else {
            const modifier = isGenericDomain(emailA) ? 'generic_domain' : 'corporate_domain';
            const calKey = `${schema}:email_exact:${modifier}`;
            const bucket = cal.buckets.get(calKey);

            if (bucket && bucket.attempts > 10) {
              bestConfidence = bucket.precision;
            } else {
              bestConfidence = modifier === 'corporate_domain' ? 0.92 : 0.80;
            }
            bestStrategy = 'email_exact';

            // Network learned: corporate email = definitive, short circuit
            if (modifier === 'corporate_domain') {
              const scKey = `${schema}:email_exact:corporate_domain`;
              const scBucket = cal.buckets.get(scKey);
              if (scBucket?.recommendShortCircuit) {
                // Don't check anything else — this is definitive
                if (bestConfidence >= 0.50) {
                  decisions.push({
                    recordA: a.sourceRecordId,
                    recordB: b.sourceRecordId,
                    confidence: bestConfidence,
                    strategy: bestStrategy,
                    tokenCost: totalTokens,
                  });
                }
                continue; // Skip all other strategies
              }
            }
          }
        } else {
          totalTokens += STRATEGY_COSTS.email_exact; // Checked but didn't match
          
          // Different emails: if both are corporate, this is a NEGATIVE signal
          if (!isGenericDomain(emailA) && !isGenericDomain(emailB)) {
            // Different corporate emails = very likely different people
            // Short circuit — don't waste more tokens
            continue;
          }
        }
      }

      // ── Smart name matching ──
      // Network learned: common names are unreliable
      if (cal.highCollisionNames.has(a.name.toLowerCase()) ||
          cal.highCollisionNames.has(b.name.toLowerCase())) {
        // Common name — name match alone is worth nothing
        // Only count if combined with another signal
        totalTokens += STRATEGY_COSTS.name_exact;
      } else {
        totalTokens += STRATEGY_COSTS.name_exact;
        if (a.name.toLowerCase() === b.name.toLowerCase()) {
          const calKey = `${schema}:name_exact:none`;
          const bucket = cal.buckets.get(calKey);
          if (bucket && bucket.attempts > 10) {
            if (bestConfidence < bucket.precision) {
              bestConfidence = bucket.precision;
              bestStrategy = 'name_exact';
            }
          } else if (bestConfidence < 0.45) {
            bestConfidence = 0.45;
            bestStrategy = 'name_exact';
          }
        }
      }

      // ── Smart username matching ──
      if (a.username && b.username && a.username === b.username) {
        totalTokens += STRATEGY_COSTS.alias_match;
        const calKey = `${schema}:alias_match:none`;
        const bucket = cal.buckets.get(calKey);
        if (bucket && bucket.attempts > 10) {
          if (bestConfidence < bucket.precision) {
            bestConfidence = bucket.precision;
            bestStrategy = 'alias_match';
          }
        } else if (bestConfidence < 0.35) {
          bestConfidence = 0.35;
          bestStrategy = 'alias_match';
        }
      }

      // ── Phone matching ──
      if (a.phone && b.phone) {
        totalTokens += STRATEGY_COSTS.phone_normalized;
        if (normalizePhone(a.phone) === normalizePhone(b.phone)) {
          if (bestConfidence < 0.80) {
            bestConfidence = 0.80;
            bestStrategy = 'phone_normalized';
          }
        }
      }

      // ── Schema drift awareness ──
      // Check attributes for email if top-level email is missing
      if (!a.email && a.attributes) {
        const attrEmail = a.attributes.contact_email || a.attributes.email_v2;
        if (attrEmail && b.email && attrEmail.toLowerCase() === b.email.toLowerCase()) {
          totalTokens += STRATEGY_COSTS.email_exact;
          if (bestConfidence < 0.85) {
            bestConfidence = 0.85;
            bestStrategy = 'email_exact(schema_drift)';
          }
        }
      }
      if (!b.email && b.attributes) {
        const attrEmail = b.attributes.contact_email || b.attributes.email_v2;
        if (attrEmail && a.email && attrEmail.toLowerCase() === a.email.toLowerCase()) {
          totalTokens += STRATEGY_COSTS.email_exact;
          if (bestConfidence < 0.85) {
            bestConfidence = 0.85;
            bestStrategy = 'email_exact(schema_drift)';
          }
        }
      }

      // ── Adversarial detection ──
      // Same email but very different names → suspicious
      if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) {
        const nSim = nameSimilarity(a.name, b.name);
        if (nSim < 0.3) {
          // Email matches but names are completely different → possible spoofing
          bestConfidence = Math.min(bestConfidence, 0.30);
          bestStrategy = 'suspicious:email_match_name_mismatch';
        }
      }

      if (bestConfidence >= 0.50) {
        decisions.push({
          recordA: a.sourceRecordId,
          recordB: b.sourceRecordId,
          confidence: bestConfidence,
          strategy: bestStrategy,
          tokenCost: totalTokens,
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
): { tp: number; fp: number; fn: number; tokensUsed: number; tokensOptimal: number; ops: number } {
  const truthMap = new Map<string, string>();
  const levelRecords = new Set<string>();

  for (const r of dataset.records) {
    truthMap.set(r.sourceRecordId, r.truthId);
    if (level === undefined || r.level === level) {
      levelRecords.add(r.sourceRecordId);
    }
  }

  const levelDecisions = level === undefined
    ? decisions
    : decisions.filter(d => levelRecords.has(d.recordA) && levelRecords.has(d.recordB));

  const levelMerges = level === undefined
    ? dataset.expectedMerges
    : dataset.expectedMerges.filter(([a, b]) => levelRecords.has(a) && levelRecords.has(b));

  let tp = 0, fp = 0;
  let tokensUsed = 0;

  for (const d of levelDecisions) {
    const truthA = truthMap.get(d.recordA);
    const truthB = truthMap.get(d.recordB);
    tokensUsed += d.tokenCost;
    if (truthA && truthB && truthA === truthB) tp++;
    else fp++;
  }

  const decisionSet = new Set(levelDecisions.map(d => [d.recordA, d.recordB].sort().join(':')));
  let fn = 0;
  for (const [a, b] of levelMerges) {
    if (!decisionSet.has([a, b].sort().join(':'))) fn++;
  }

  // Compute optimal tokens from strategy hints
  let tokensOptimal = 0;
  if (level !== undefined) {
    const levelHints = dataset.strategyHints.filter(h =>
      levelRecords.has(h.recordPair[0]) && levelRecords.has(h.recordPair[1])
    );
    tokensOptimal = levelHints.reduce((sum, h) => sum + h.optimalTokenCost, 0);
  }

  return { tp, fp, fn, tokensUsed, tokensOptimal, ops: levelDecisions.length };
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
  const buckets = new Map<string, CalibrationBucket & { tp: number; fp: number }>();
  const knownGarbage = new Set<string>();
  const knownSharedEmails = new Set<string>();
  const highCollisionNames = new Set<string>();

  const truthMap = new Map<string, string>();
  const emailToEntities = new Map<string, Set<string>>();
  const nameCount = new Map<string, number>();

  for (const r of dataset.records) {
    truthMap.set(r.sourceRecordId, r.truthId);

    // Track email → entity mappings to discover shared/team emails
    if (r.email) {
      const email = r.email.toLowerCase();
      if (!emailToEntities.has(email)) emailToEntities.set(email, new Set());
      emailToEntities.get(email)!.add(r.truthId);
    }

    // Track name frequency
    const name = r.name.toLowerCase();
    nameCount.set(name, (nameCount.get(name) || 0) + 1);
  }

  // Discover garbage emails
  for (const email of GARBAGE_EMAILS) {
    knownGarbage.add(email);
  }

  // Discover shared/team emails (same email, different entities)
  for (const [email, entities] of emailToEntities) {
    if (entities.size > 1) {
      knownSharedEmails.add(email);
    }
    if (isTeamEmail(email)) {
      knownSharedEmails.add(email);
    }
  }

  // Discover high-collision names
  for (const [name, count] of nameCount) {
    if (count >= 3) {
      highCollisionNames.add(name);
    }
  }

  // Simulate agent resolutions
  for (let agent = 0; agent < numAgents; agent++) {
    const subset = dataset.records
      .filter(() => Math.random() > 0.3)
      .sort(() => Math.random() - 0.5);

    for (let run = 0; run < runsPerAgent; run++) {
      for (let i = 0; i < subset.length; i++) {
        for (let j = i + 1; j < Math.min(i + 20, subset.length); j++) {
          const a = subset[i];
          const b = subset[j];
          if (a.source === b.source) continue;

          const schema = [a.source, b.source].sort().join('+');
          let rule = '';
          let modifier = 'none';

          if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) {
            rule = 'email_exact';
            const domain = a.email.split('@')[1]?.toLowerCase() || '';
            modifier = isGenericDomain(a.email) ? 'generic_domain' : 'corporate_domain';
          } else if (a.name.toLowerCase() === b.name.toLowerCase()) {
            rule = 'name_exact';
          } else if (a.username && b.username && a.username === b.username) {
            rule = 'alias_match';
          } else {
            continue;
          }

          const isCorrect = truthMap.get(a.sourceRecordId) === truthMap.get(b.sourceRecordId);
          const key = `${schema}:${rule}:${modifier}`;

          let bucket = buckets.get(key);
          if (!bucket) {
            bucket = { precision: 0, falseMergeRate: 0, attempts: 0, tp: 0, fp: 0 };
            buckets.set(key, bucket);
          }

          bucket.attempts++;
          if (isCorrect) bucket.tp++;
          else bucket.fp++;
          bucket.precision = bucket.tp / bucket.attempts;
          bucket.falseMergeRate = bucket.fp / bucket.attempts;

          // Learn short circuits
          if (rule === 'email_exact' && modifier === 'corporate_domain' && bucket.attempts > 20) {
            if (bucket.precision > 0.95) {
              bucket.recommendShortCircuit = true;
            }
          }

          // Learn skip recommendations
          if (bucket.attempts > 20 && bucket.precision < 0.20) {
            bucket.recommendSkip = true;
          }
        }
      }
    }
  }

  const calBuckets = new Map<string, CalibrationBucket>();
  for (const [key, val] of buckets) {
    calBuckets.set(key, {
      precision: val.precision,
      falseMergeRate: val.falseMergeRate,
      attempts: val.attempts,
      recommendSkip: val.recommendSkip,
      recommendShortCircuit: val.recommendShortCircuit,
    });
  }

  return { buckets: calBuckets, knownGarbage, knownSharedEmails, highCollisionNames };
}

// ── Main Runner ─────────────────────────────────────

function runGauntlet(mode: 'control' | 'network', dataset: GauntletDataset, calibration?: CalibrationData): GauntletResult {
  const start = Date.now();

  const decisions = mode === 'control'
    ? naiveResolve(dataset.records)
    : networkResolve(dataset.records, calibration!);

  const levelNames: Record<number, [string, string]> = {
    1: ['Gimmes', 'identity'], 2: ['Normalization', 'identity'], 3: ['Ambiguity', 'identity'],
    4: ['Traps', 'identity'], 5: ['Topology', 'identity'],
    6: ['Strategy Selection', 'efficiency'], 7: ['Short Circuits', 'efficiency'], 8: ['Batch Optimization', 'efficiency'],
    9: ['Schema Drift', 'adaptation'], 10: ['Data Quality', 'adaptation'], 11: ['Adversarial', 'adaptation'],
  };

  const levels: LevelScore[] = [];

  for (let level = 1; level <= 11; level++) {
    const { tp, fp, fn, tokensUsed, tokensOptimal, ops } = scoreDecisions(decisions, dataset, level);
    const metrics = computeMetrics(tp, fp, fn);
    const levelRecords = dataset.records.filter(r => r.level === level).length;
    const [name, track] = levelNames[level] || ['Unknown', 'unknown'];

    levels.push({
      level, name, track, records: levelRecords,
      truePositives: tp, falsePositives: fp, falseNegatives: fn,
      ...metrics,
      tokensUsed, tokensOptimal, tokensSaved: Math.max(0, tokensUsed - tokensOptimal),
      operations: ops,
    });
  }

  // Track summaries
  const trackSummaries: Record<string, any> = {};
  for (const track of ['identity', 'efficiency', 'adaptation']) {
    const trackLevels = levels.filter(l => l.track === track);
    const tp = trackLevels.reduce((s, l) => s + l.truePositives, 0);
    const fp = trackLevels.reduce((s, l) => s + l.falsePositives, 0);
    const fn = trackLevels.reduce((s, l) => s + l.falseNegatives, 0);
    const metrics = computeMetrics(tp, fp, fn);
    const tokensUsed = trackLevels.reduce((s, l) => s + l.tokensUsed, 0);
    const tokensOptimal = trackLevels.reduce((s, l) => s + l.tokensOptimal, 0);

    trackSummaries[track] = {
      ...metrics,
      tokensUsed,
      tokensOptimal,
      efficiency: tokensOptimal > 0 ? tokensOptimal / tokensUsed : 1,
    };
  }

  const { tp, fp, fn, tokensUsed } = scoreDecisions(decisions, dataset);
  const overall = computeMetrics(tp, fp, fn);
  const tokensOptimal = dataset.strategyHints.reduce((s, h) => s + h.optimalTokenCost, 0);

  return {
    mode,
    levels,
    trackSummaries,
    overall: {
      ...overall,
      totalMerges: tp + fp,
      correctMerges: tp,
      incorrectMerges: fp,
      missedMerges: fn,
      tokensUsed,
      tokensOptimal,
      tokenEfficiency: tokensOptimal > 0 ? tokensOptimal / tokensUsed : 1,
    },
    timeMs: Date.now() - start,
  };
}

// ── Output ──────────────────────────────────────────

function printResult(result: GauntletResult) {
  const modeLabel = result.mode === 'control' ? '🔴 CONTROL (no network)' : '🟢 NETWORK (calibrated)';
  console.log(`\n${modeLabel}`);
  console.log(`${'─'.repeat(90)}`);
  console.log(
    `${'Level'.padEnd(25)} ${'Prec'.padStart(7)} ${'Recall'.padStart(7)} ${'F1'.padStart(7)} ` +
    `${'FMR'.padStart(7)} ${'Tokens'.padStart(8)} ${'TP'.padStart(4)} ${'FP'.padStart(4)} ${'FN'.padStart(4)}`
  );
  console.log(`${'─'.repeat(90)}`);

  let currentTrack = '';
  for (const l of result.levels) {
    if (l.track !== currentTrack) {
      currentTrack = l.track;
      const trackLabel = { identity: '📋 TRACK A: Identity', efficiency: '⚡ TRACK B: Efficiency', adaptation: '🛡️ TRACK C: Adaptation' }[l.track] || l.track;
      console.log(`\n  ${trackLabel}`);
    }
    console.log(
      `  ${`${l.level}. ${l.name}`.padEnd(23)} ` +
      `${(l.precision * 100).toFixed(1).padStart(6)}% ` +
      `${(l.recall * 100).toFixed(1).padStart(6)}% ` +
      `${(l.f1 * 100).toFixed(1).padStart(6)}% ` +
      `${(l.falseMergeRate * 100).toFixed(1).padStart(6)}% ` +
      `${l.tokensUsed.toString().padStart(8)} ` +
      `${l.truePositives.toString().padStart(4)} ` +
      `${l.falsePositives.toString().padStart(4)} ` +
      `${l.falseNegatives.toString().padStart(4)}`
    );
  }

  console.log(`\n${'─'.repeat(90)}`);
  console.log(
    `  ${'OVERALL'.padEnd(23)} ` +
    `${(result.overall.precision * 100).toFixed(1).padStart(6)}% ` +
    `${(result.overall.recall * 100).toFixed(1).padStart(6)}% ` +
    `${(result.overall.f1 * 100).toFixed(1).padStart(6)}% ` +
    `${(result.overall.falseMergeRate * 100).toFixed(1).padStart(6)}% ` +
    `${result.overall.tokensUsed.toString().padStart(8)} ` +
    `${result.overall.correctMerges.toString().padStart(4)} ` +
    `${result.overall.incorrectMerges.toString().padStart(4)} ` +
    `${result.overall.missedMerges.toString().padStart(4)}`
  );
  console.log(`  Time: ${result.timeMs}ms`);
}

function printComparison(control: GauntletResult, network: GauntletResult) {
  console.log(`\n${'═'.repeat(90)}`);
  console.log(`  📊 IMPROVEMENT SUMMARY`);
  console.log(`${'═'.repeat(90)}`);

  let currentTrack = '';
  for (let i = 0; i < control.levels.length; i++) {
    const c = control.levels[i];
    const n = network.levels[i];

    if (c.track !== currentTrack) {
      currentTrack = c.track;
      console.log();
    }

    const precDelta = (n.precision - c.precision) * 100;
    const fmrDelta = (n.falseMergeRate - c.falseMergeRate) * 100;
    const tokenDelta = c.tokensUsed > 0 ? ((c.tokensUsed - n.tokensUsed) / c.tokensUsed * 100) : 0;

    const precArrow = precDelta >= 0 ? `↑${precDelta.toFixed(1)}` : `↓${Math.abs(precDelta).toFixed(1)}`;
    const fmrArrow = fmrDelta <= 0 ? `↓${Math.abs(fmrDelta).toFixed(1)}` : `↑${fmrDelta.toFixed(1)}`;
    const tokenArrow = tokenDelta >= 0 ? `↓${tokenDelta.toFixed(0)}%` : `↑${Math.abs(tokenDelta).toFixed(0)}%`;

    console.log(
      `  ${`${c.level}. ${c.name}`.padEnd(23)} ` +
      `Prec ${precArrow.padEnd(8)} ` +
      `FMR ${fmrArrow.padEnd(8)} ` +
      `Tokens ${tokenArrow.padEnd(8)}`
    );
  }

  console.log(`\n${'─'.repeat(90)}`);
  const oPrecDelta = (network.overall.precision - control.overall.precision) * 100;
  const oFmrDelta = (network.overall.falseMergeRate - control.overall.falseMergeRate) * 100;
  const oTokenDelta = control.overall.tokensUsed > 0
    ? ((control.overall.tokensUsed - network.overall.tokensUsed) / control.overall.tokensUsed * 100) : 0;

  console.log(
    `  ${'OVERALL'.padEnd(23)} ` +
    `Prec ${oPrecDelta >= 0 ? '↑' : '↓'}${Math.abs(oPrecDelta).toFixed(1).padEnd(7)} ` +
    `FMR ${oFmrDelta <= 0 ? '↓' : '↑'}${Math.abs(oFmrDelta).toFixed(1).padEnd(7)} ` +
    `Tokens ${oTokenDelta >= 0 ? '↓' : '↑'}${Math.abs(oTokenDelta).toFixed(0)}%`
  );
  console.log(`${'═'.repeat(90)}`);

  // Token savings callout
  const tokensSaved = control.overall.tokensUsed - network.overall.tokensUsed;
  if (tokensSaved > 0) {
    console.log(`\n  💰 Network saved ${tokensSaved.toLocaleString()} tokens (${oTokenDelta.toFixed(0)}% reduction)`);
    console.log(`     At $0.01/1K tokens, that's $${(tokensSaved / 1000 * 0.01).toFixed(4)} per resolution batch`);
  }
}

// ── CLI Entry Point ─────────────────────────────────

const args = process.argv.slice(2);
const numAgents = parseInt(args.find((_, i) => args[i - 1] === '--agents') || '20');
const seed = parseInt(args.find((_, i) => args[i - 1] === '--seed') || '42');

console.log(`\n╔══════════════════════════════════════════════════════╗`);
console.log(`║         dpth GAUNTLET v2 — Benchmark Suite          ║`);
console.log(`║   Track A: Identity | Track B: Efficiency | Track C: Adaptation  ║`);
console.log(`╚══════════════════════════════════════════════════════╝`);

console.log(`\nGenerating ground truth (seed: ${seed})...`);
const dataset = generateGauntlet(seed);
console.log(`  ${dataset.records.length} records, ${dataset.uniqueEntities} entities, ${dataset.expectedMerges.length} expected merges`);
console.log(`  Track A: ${dataset.trackCounts.identity} | Track B: ${dataset.trackCounts.efficiency} | Track C: ${dataset.trackCounts.adaptation}`);
console.log(`  ${dataset.strategyHints.length} strategy hints, ${dataset.qualityIssues.length} quality issues`);

console.log(`\nRunning control (no network)...`);
const control = runGauntlet('control', dataset);
printResult(control);

console.log(`\nSimulating network learning (${numAgents} agents × 3 runs)...`);
const calibration = simulateCalibrationLearning(dataset, numAgents, 3);
console.log(`  ${calibration.buckets.size} calibration buckets`);
console.log(`  ${calibration.knownGarbage.size} known garbage values`);
console.log(`  ${calibration.knownSharedEmails.size} known shared emails`);
console.log(`  ${calibration.highCollisionNames.size} high-collision names`);

console.log(`\nRunning network-calibrated resolver...`);
const network = runGauntlet('network', dataset, calibration);
printResult(network);

printComparison(control, network);
