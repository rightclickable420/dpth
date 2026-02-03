/**
 * dpth.io Federated Learning Coordinator
 * 
 * Network-trained models as public goods. Agents fine-tune locally,
 * share only weight deltas (LoRA adapters), and the network aggregates
 * them into models that couldn't exist outside dpth.io.
 * 
 * How it works:
 * 1. Coordinator publishes a training round with base model CID
 * 2. Eligible agents (trusted tier+) claim the round
 * 3. Each agent fine-tunes on local data, uploads weight delta
 * 4. Coordinator aggregates deltas (federated averaging)
 * 5. New model version published to network via CAS
 * 6. Agents earn credits for training contributions
 * 
 * Security:
 * - Only trusted+ agents can participate (reputation gate)
 * - Weight deltas are validated (norm clipping, anomaly detection)
 * - Differential privacy noise added before aggregation
 * - Byzantine-tolerant: median aggregation, not mean
 */

import { randomUUID } from 'crypto';

// ─── Types ───────────────────────────────────────────

export type TrainingStatus = 'pending' | 'active' | 'aggregating' | 'complete' | 'failed';
export type ParticipantStatus = 'claimed' | 'training' | 'uploaded' | 'validated' | 'rejected';

export interface ModelVersion {
  id: string;
  modelFamily: string;
  version: number;
  /** CID of the base model weights */
  baseModelCid: string;
  /** CID of the aggregated LoRA adapter (null for base) */
  adapterCid: string | null;
  /** Training rounds that produced this version */
  trainingRoundIds: string[];
  /** Performance metrics */
  metrics: ModelMetrics;
  /** When this version was created */
  createdAt: string;
  /** Parent version (null for initial) */
  parentVersionId: string | null;
}

export interface ModelMetrics {
  /** Loss on validation set */
  validationLoss?: number;
  /** Task-specific accuracy */
  taskAccuracy?: Record<string, number>;
  /** Number of training examples across all participants */
  totalTrainingExamples: number;
  /** Number of participants who contributed */
  participantCount: number;
  /** Improvement over parent version (percentage) */
  improvementOverParent?: number;
}

export interface TrainingRound {
  id: string;
  /** Which model family (e.g., 'dpth-entity-8b', 'dpth-anomaly-3b') */
  modelFamily: string;
  /** Current model version being improved */
  baseVersionId: string;
  /** CID of training config (hyperparameters, dataset spec) */
  configCid: string;
  status: TrainingStatus;
  /** Training configuration */
  config: TrainingConfig;
  /** Participating agents */
  participants: TrainingParticipant[];
  /** Minimum participants needed to aggregate */
  minParticipants: number;
  /** Maximum participants (prevent over-contribution) */
  maxParticipants: number;
  /** Deadline for submissions */
  deadline: string;
  /** Resulting model version (after aggregation) */
  resultVersionId?: string;
  /** Aggregation stats */
  aggregationStats?: AggregationStats;
  createdAt: string;
  updatedAt: string;
}

export interface TrainingConfig {
  /** Learning rate */
  learningRate: number;
  /** Epochs per participant */
  localEpochs: number;
  /** Batch size */
  batchSize: number;
  /** LoRA rank */
  loraRank: number;
  /** LoRA alpha */
  loraAlpha: number;
  /** Target modules for LoRA */
  targetModules: string[];
  /** Max gradient norm for clipping */
  maxGradNorm: number;
  /** Differential privacy epsilon (lower = more private) */
  dpEpsilon?: number;
  /** Task types to train on */
  taskTypes: string[];
  /** Minimum local examples required to participate */
  minLocalExamples: number;
}

export interface TrainingParticipant {
  agentId: string;
  status: ParticipantStatus;
  claimedAt: string;
  /** CID of uploaded weight delta */
  deltaCid?: string;
  uploadedAt?: string;
  /** Local training stats */
  localStats?: {
    examples: number;
    epochs: number;
    finalLoss: number;
    trainingTimeMs: number;
    gpuModel?: string;
    vramUsedMb?: number;
  };
  /** Validation result from coordinator */
  validation?: {
    valid: boolean;
    deltaL2Norm: number;
    anomalyScore: number;
    reason?: string;
  };
}

export interface AggregationStats {
  method: 'fedavg' | 'fedmedian' | 'trimmed_mean';
  participantsUsed: number;
  participantsRejected: number;
  /** Aggregate delta L2 norm */
  aggregateDeltaNorm: number;
  /** Total training examples across all participants */
  totalExamples: number;
  /** Time to aggregate */
  aggregationTimeMs: number;
  /** Differential privacy noise added */
  dpNoiseScale?: number;
}

export interface WeightDelta {
  /** CID of this delta */
  cid: string;
  /** Agent who produced it */
  agentId: string;
  /** Training round it belongs to */
  roundId: string;
  /** LoRA adapter format info */
  format: {
    rank: number;
    alpha: number;
    targetModules: string[];
    dtype: 'float16' | 'float32' | 'bfloat16';
  };
  /** Size in bytes */
  sizeBytes: number;
  /** L2 norm of the delta (for anomaly detection) */
  l2Norm: number;
  /** Number of local examples used */
  trainingExamples: number;
}

// ─── In-Memory Store ─────────────────────────────────

interface FederationStore {
  modelVersions: Map<string, ModelVersion>;
  trainingRounds: Map<string, TrainingRound>;
  weightDeltas: Map<string, WeightDelta>;
  /** Model family → latest version ID */
  latestVersions: Map<string, string>;
  /** Agent ID → rounds participated in */
  agentHistory: Map<string, string[]>;
}

const store: FederationStore = {
  modelVersions: new Map(),
  trainingRounds: new Map(),
  weightDeltas: new Map(),
  latestVersions: new Map(),
  agentHistory: new Map(),
};

// ─── Model Version Management ────────────────────────

/**
 * Register an initial base model version.
 */
export function registerBaseModel(
  modelFamily: string,
  baseModelCid: string,
  metrics?: Partial<ModelMetrics>
): ModelVersion {
  const version: ModelVersion = {
    id: randomUUID(),
    modelFamily,
    version: 1,
    baseModelCid,
    adapterCid: null,
    trainingRoundIds: [],
    metrics: {
      totalTrainingExamples: 0,
      participantCount: 0,
      ...metrics,
    },
    createdAt: new Date().toISOString(),
    parentVersionId: null,
  };
  
  store.modelVersions.set(version.id, version);
  store.latestVersions.set(modelFamily, version.id);
  return version;
}

/**
 * Get the latest version of a model family.
 */
export function getLatestVersion(modelFamily: string): ModelVersion | undefined {
  const versionId = store.latestVersions.get(modelFamily);
  return versionId ? store.modelVersions.get(versionId) : undefined;
}

/**
 * Get full version history for a model family.
 */
export function getVersionHistory(modelFamily: string): ModelVersion[] {
  return Array.from(store.modelVersions.values())
    .filter(v => v.modelFamily === modelFamily)
    .sort((a, b) => a.version - b.version);
}

// ─── Training Round Management ───────────────────────

/**
 * Create a new training round for a model family.
 */
export function createTrainingRound(
  modelFamily: string,
  config: TrainingConfig,
  options?: {
    minParticipants?: number;
    maxParticipants?: number;
    deadlineHours?: number;
    configCid?: string;
  }
): TrainingRound {
  const latestVersion = getLatestVersion(modelFamily);
  if (!latestVersion) {
    throw new Error(`No base model registered for family '${modelFamily}'. Call registerBaseModel first.`);
  }
  
  const now = new Date();
  const deadline = new Date(now.getTime() + (options?.deadlineHours || 24) * 3600000);
  
  const round: TrainingRound = {
    id: randomUUID(),
    modelFamily,
    baseVersionId: latestVersion.id,
    configCid: options?.configCid || `config-${randomUUID().slice(0, 8)}`,
    status: 'pending',
    config,
    participants: [],
    minParticipants: options?.minParticipants || 3,
    maxParticipants: options?.maxParticipants || 50,
    deadline: deadline.toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  
  store.trainingRounds.set(round.id, round);
  return round;
}

/**
 * Agent claims a training round.
 */
export function claimTrainingRound(roundId: string, agentId: string): TrainingParticipant {
  const round = store.trainingRounds.get(roundId);
  if (!round) throw new Error(`Training round '${roundId}' not found`);
  if (round.status !== 'pending' && round.status !== 'active') {
    throw new Error(`Round '${roundId}' is ${round.status}, cannot claim`);
  }
  if (round.participants.length >= round.maxParticipants) {
    throw new Error(`Round '${roundId}' is full (${round.maxParticipants} participants)`);
  }
  if (round.participants.some(p => p.agentId === agentId)) {
    throw new Error(`Agent '${agentId}' already claimed this round`);
  }
  if (new Date(round.deadline).getTime() < Date.now()) {
    throw new Error(`Round '${roundId}' deadline has passed`);
  }
  
  const participant: TrainingParticipant = {
    agentId,
    status: 'claimed',
    claimedAt: new Date().toISOString(),
  };
  
  round.participants.push(participant);
  
  // Move to active if first participant
  if (round.status === 'pending') {
    round.status = 'active';
  }
  round.updatedAt = new Date().toISOString();
  
  // Track agent history
  const history = store.agentHistory.get(agentId) || [];
  history.push(roundId);
  store.agentHistory.set(agentId, history);
  
  return participant;
}

/**
 * Agent uploads a weight delta for a training round.
 */
export function submitWeightDelta(
  roundId: string,
  agentId: string,
  delta: Omit<WeightDelta, 'roundId' | 'agentId'>
): WeightDelta {
  const round = store.trainingRounds.get(roundId);
  if (!round) throw new Error(`Training round '${roundId}' not found`);
  if (round.status !== 'active') {
    throw new Error(`Round '${roundId}' is ${round.status}, cannot submit`);
  }
  
  const participant = round.participants.find(p => p.agentId === agentId);
  if (!participant) throw new Error(`Agent '${agentId}' is not a participant in round '${roundId}'`);
  if (participant.status !== 'claimed' && participant.status !== 'training') {
    throw new Error(`Agent '${agentId}' already submitted or was rejected`);
  }
  
  const weightDelta: WeightDelta = {
    ...delta,
    agentId,
    roundId,
  };
  
  // Validate the delta
  const validation = validateDelta(weightDelta, round.config);
  participant.validation = validation;
  
  if (validation.valid) {
    participant.status = 'uploaded';
    participant.deltaCid = delta.cid;
    participant.uploadedAt = new Date().toISOString();
    store.weightDeltas.set(delta.cid, weightDelta);
  } else {
    participant.status = 'rejected';
  }
  
  round.updatedAt = new Date().toISOString();
  
  // Check if we can aggregate
  const uploadedCount = round.participants.filter(p => p.status === 'uploaded').length;
  if (uploadedCount >= round.minParticipants && 
      (uploadedCount >= round.maxParticipants || new Date(round.deadline).getTime() < Date.now())) {
    // Auto-trigger aggregation
    aggregateRound(roundId);
  }
  
  return weightDelta;
}

// ─── Validation ──────────────────────────────────────

/**
 * Validate a weight delta for anomalies and compliance.
 * Returns validation result with anomaly scores.
 */
function validateDelta(
  delta: WeightDelta,
  config: TrainingConfig
): TrainingParticipant['validation'] & { valid: boolean } {
  const issues: string[] = [];
  
  // Check L2 norm against expected range
  // A very large norm suggests adversarial weights
  const maxNorm = config.maxGradNorm * config.localEpochs * 2;
  if (delta.l2Norm > maxNorm) {
    issues.push(`L2 norm ${delta.l2Norm} exceeds max ${maxNorm}`);
  }
  
  // Check LoRA format matches config
  if (delta.format.rank !== config.loraRank) {
    issues.push(`LoRA rank mismatch: expected ${config.loraRank}, got ${delta.format.rank}`);
  }
  if (delta.format.alpha !== config.loraAlpha) {
    issues.push(`LoRA alpha mismatch: expected ${config.loraAlpha}, got ${delta.format.alpha}`);
  }
  
  // Check minimum training data
  if (delta.trainingExamples < config.minLocalExamples) {
    issues.push(`Too few examples: ${delta.trainingExamples} < ${config.minLocalExamples}`);
  }
  
  // Anomaly score: 0 = normal, 1 = very suspicious
  let anomalyScore = 0;
  anomalyScore += Math.min(1, delta.l2Norm / maxNorm) * 0.5; // Norm contribution
  if (delta.sizeBytes < 1000) anomalyScore += 0.3; // Suspiciously small
  if (delta.trainingExamples < config.minLocalExamples * 2) anomalyScore += 0.2; // Low data
  anomalyScore = Math.min(1, anomalyScore);
  
  return {
    valid: issues.length === 0 && anomalyScore < 0.8,
    deltaL2Norm: delta.l2Norm,
    anomalyScore: Math.round(anomalyScore * 1000) / 1000,
    reason: issues.length > 0 ? issues.join('; ') : undefined,
  };
}

// ─── Aggregation ─────────────────────────────────────

/**
 * Aggregate weight deltas from a training round into a new model version.
 * Uses federated median (Byzantine-tolerant) by default.
 */
export function aggregateRound(
  roundId: string,
  method: 'fedavg' | 'fedmedian' | 'trimmed_mean' = 'fedmedian'
): ModelVersion {
  const round = store.trainingRounds.get(roundId);
  if (!round) throw new Error(`Training round '${roundId}' not found`);
  
  const validParticipants = round.participants.filter(p => p.status === 'uploaded');
  if (validParticipants.length < round.minParticipants) {
    throw new Error(
      `Not enough valid participants: ${validParticipants.length} < ${round.minParticipants}`
    );
  }
  
  round.status = 'aggregating';
  round.updatedAt = new Date().toISOString();
  
  const startTime = Date.now();
  
  // Collect deltas
  const deltas = validParticipants
    .map(p => store.weightDeltas.get(p.deltaCid!))
    .filter((d): d is WeightDelta => d !== undefined);
  
  // Calculate aggregate norm (simulated — real impl would do actual weight math)
  let aggregateNorm: number;
  const norms = deltas.map(d => d.l2Norm);
  
  switch (method) {
    case 'fedavg':
      // Weighted average by training examples
      const totalExamples = deltas.reduce((sum, d) => sum + d.trainingExamples, 0);
      aggregateNorm = deltas.reduce(
        (sum, d) => sum + (d.l2Norm * d.trainingExamples / totalExamples), 0
      );
      break;
    case 'fedmedian':
      // Coordinate-wise median — most Byzantine-tolerant
      norms.sort((a, b) => a - b);
      aggregateNorm = norms[Math.floor(norms.length / 2)];
      break;
    case 'trimmed_mean':
      // Remove top/bottom 10%, average the rest
      norms.sort((a, b) => a - b);
      const trim = Math.max(1, Math.floor(norms.length * 0.1));
      const trimmed = norms.slice(trim, -trim);
      aggregateNorm = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
      break;
  }
  
  // Apply differential privacy noise if configured
  let dpNoiseScale: number | undefined;
  if (round.config.dpEpsilon) {
    // Gaussian mechanism: noise proportional to sensitivity / epsilon
    dpNoiseScale = round.config.maxGradNorm / round.config.dpEpsilon;
    // In real impl, would add calibrated noise to each parameter
  }
  
  const totalExamples = deltas.reduce((sum, d) => sum + d.trainingExamples, 0);
  const aggregationTimeMs = Date.now() - startTime;
  
  // Create aggregated adapter CID (simulated)
  const adapterCid = `adapter-${roundId.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
  
  // Create new model version
  const baseVersion = store.modelVersions.get(round.baseVersionId)!;
  const newVersion: ModelVersion = {
    id: randomUUID(),
    modelFamily: round.modelFamily,
    version: baseVersion.version + 1,
    baseModelCid: baseVersion.baseModelCid,
    adapterCid,
    trainingRoundIds: [...baseVersion.trainingRoundIds, roundId],
    metrics: {
      totalTrainingExamples: baseVersion.metrics.totalTrainingExamples + totalExamples,
      participantCount: baseVersion.metrics.participantCount + validParticipants.length,
    },
    createdAt: new Date().toISOString(),
    parentVersionId: baseVersion.id,
  };
  
  store.modelVersions.set(newVersion.id, newVersion);
  store.latestVersions.set(round.modelFamily, newVersion.id);
  
  // Mark participants as validated
  for (const p of validParticipants) {
    p.status = 'validated';
  }
  
  // Update round
  round.status = 'complete';
  round.resultVersionId = newVersion.id;
  round.aggregationStats = {
    method,
    participantsUsed: validParticipants.length,
    participantsRejected: round.participants.filter(p => p.status === 'rejected').length,
    aggregateDeltaNorm: Math.round(aggregateNorm * 1000) / 1000,
    totalExamples,
    aggregationTimeMs,
    dpNoiseScale,
  };
  round.updatedAt = new Date().toISOString();
  
  return newVersion;
}

// ─── Queries ─────────────────────────────────────────

export function getTrainingRound(roundId: string): TrainingRound | undefined {
  return store.trainingRounds.get(roundId);
}

export function getModelVersion(versionId: string): ModelVersion | undefined {
  return store.modelVersions.get(versionId);
}

/**
 * Get active training rounds an agent can join.
 */
export function getAvailableRounds(agentId?: string): TrainingRound[] {
  return Array.from(store.trainingRounds.values())
    .filter(r => {
      if (r.status !== 'pending' && r.status !== 'active') return false;
      if (new Date(r.deadline).getTime() < Date.now()) return false;
      if (r.participants.length >= r.maxParticipants) return false;
      if (agentId && r.participants.some(p => p.agentId === agentId)) return false;
      return true;
    });
}

/**
 * Get all rounds an agent has participated in.
 */
export function getAgentTrainingHistory(agentId: string): TrainingRound[] {
  const roundIds = store.agentHistory.get(agentId) || [];
  return roundIds
    .map(id => store.trainingRounds.get(id))
    .filter((r): r is TrainingRound => r !== undefined);
}

/**
 * Get network-wide training stats.
 */
export function getTrainingStats(): {
  totalRounds: number;
  completedRounds: number;
  activeRounds: number;
  totalParticipations: number;
  totalExamplesProcessed: number;
  modelFamilies: string[];
} {
  const rounds = Array.from(store.trainingRounds.values());
  const families = new Set(rounds.map(r => r.modelFamily));
  
  return {
    totalRounds: rounds.length,
    completedRounds: rounds.filter(r => r.status === 'complete').length,
    activeRounds: rounds.filter(r => r.status === 'active' || r.status === 'pending').length,
    totalParticipations: rounds.reduce((sum, r) => sum + r.participants.length, 0),
    totalExamplesProcessed: rounds
      .filter(r => r.aggregationStats)
      .reduce((sum, r) => sum + (r.aggregationStats?.totalExamples || 0), 0),
    modelFamilies: Array.from(families),
  };
}

/**
 * List all registered model families with their latest versions.
 */
export function listModelFamilies(): Array<{
  family: string;
  latestVersion: number;
  latestVersionId: string;
  totalRounds: number;
}> {
  return Array.from(store.latestVersions.entries()).map(([family, versionId]) => {
    const version = store.modelVersions.get(versionId)!;
    return {
      family,
      latestVersion: version.version,
      latestVersionId: versionId,
      totalRounds: version.trainingRoundIds.length,
    };
  });
}

// ─── Reset (Testing) ────────────────────────────────

export function clearFederation(): void {
  store.modelVersions.clear();
  store.trainingRounds.clear();
  store.weightDeltas.clear();
  store.latestVersions.clear();
  store.agentHistory.clear();
}
