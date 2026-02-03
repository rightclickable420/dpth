/**
 * dpth.io Economics Engine
 * 
 * The credit system that makes agents want to contribute.
 * Every contribution earns credits, every query costs credits.
 * Designed for future token migration without rebuilding.
 * 
 * Core concepts:
 * - Credits are minted on contribution (storage, compute, GPU)
 * - Credits are burned on consumption (queries, inference)
 * - Tier multipliers reward long-term contributors
 * - Rate limits prevent abuse without killing free access
 * - Migration snapshots enable future token claims
 */

import { randomUUID } from 'crypto';

// ─── Types ───────────────────────────────────────────

export type CreditAction = 'earn' | 'spend' | 'bonus' | 'penalty' | 'transfer' | 'migration_snapshot';

export type CreditCategory = 
  | 'storage' | 'compute' | 'gpu' 
  | 'inference' | 'query' | 'training'
  | 'bonus' | 'penalty' | 'transfer' | 'system';

export interface CreditTransaction {
  id: string;
  agentId: string;
  action: CreditAction;
  amount: number;
  reason: string;
  category: CreditCategory;
  reference?: string;
  balanceAfter: number;
  timestamp: string;
  /** For transfers: recipient agent */
  toAgentId?: string;
}

export interface AgentBalance {
  agentId: string;
  balance: number;
  totalEarned: number;
  totalSpent: number;
  earningsByCategory: Record<string, number>;
  spendingByCategory: Record<string, number>;
  transactionCount: number;
  /** Claimable for future token migration */
  claimableCredits: number;
  /** Rate limit state */
  rateLimit: RateLimitState;
  /** Migration snapshot (if taken) */
  migrationSnapshot?: {
    balance: number;
    timestamp: string;
    snapshotId: string;
  };
  lastActivity: string;
  createdAt: string;
}

export interface RateLimitState {
  /** Queries remaining in current window */
  queriesRemaining: number;
  /** Inference requests remaining in current window */
  inferenceRemaining: number;
  /** Window reset time */
  windowResetAt: string;
  /** Current tier limits */
  tier: string;
}

export interface CreditRates {
  // Earning rates
  storagePerMbPerDay: number;
  computePerTask: number;
  gpuPerInferenceTask: number;
  gpuPer1kTokens: number;
  gpuPerImage: number;
  storageProofBonus: number;
  trainingRoundBonus: number;
  
  // Spending rates
  queryBaseCost: number;
  inferenceBaseCost: number;
  /** Per 1k tokens for inference requests */
  inferencePer1kTokens: number;
  
  // Multipliers
  tierMultipliers: Record<string, number>;
}

export interface TierLimits {
  /** Queries per hour */
  queriesPerHour: number;
  /** Inference requests per hour */
  inferencePerHour: number;
  /** Max single transaction */
  maxTransactionSize: number;
  /** Can participate in training */
  canTrain: boolean;
  /** Can transfer credits */
  canTransfer: boolean;
}

export interface NetworkSupply {
  totalMinted: number;
  totalBurned: number;
  totalCirculating: number;
  totalTransactions: number;
  /** Velocity: transactions in last 24h */
  velocity24h: number;
  /** Gini coefficient (0=equal, 1=concentrated) */
  giniCoefficient: number;
}

export interface PricingSignal {
  /** Current demand multiplier (>1 = high demand, <1 = low) */
  demandMultiplier: number;
  /** Network utilization (0-1) */
  utilization: number;
  /** Suggested query price */
  queryPrice: number;
  /** Suggested inference price */
  inferencePrice: number;
  timestamp: string;
}

// ─── Default Configuration ───────────────────────────

export const DEFAULT_RATES: CreditRates = {
  // Earning
  storagePerMbPerDay: 1,
  computePerTask: 10,
  gpuPerInferenceTask: 25,
  gpuPer1kTokens: 5,
  gpuPerImage: 15,
  storageProofBonus: 5,
  trainingRoundBonus: 50,
  
  // Spending
  queryBaseCost: 1,
  inferenceBaseCost: 10,
  inferencePer1kTokens: 2,
  
  // Tier multipliers
  tierMultipliers: {
    newcomer: 1.0,
    contributor: 1.2,
    trusted: 1.5,
    elite: 2.0,
    legendary: 3.0,
  },
};

export const TIER_LIMITS: Record<string, TierLimits> = {
  newcomer: {
    queriesPerHour: 10,
    inferencePerHour: 5,
    maxTransactionSize: 100,
    canTrain: false,
    canTransfer: false,
  },
  contributor: {
    queriesPerHour: 50,
    inferencePerHour: 20,
    maxTransactionSize: 500,
    canTrain: false,
    canTransfer: false,
  },
  trusted: {
    queriesPerHour: 200,
    inferencePerHour: 100,
    maxTransactionSize: 2000,
    canTrain: true,
    canTransfer: true,
  },
  elite: {
    queriesPerHour: 1000,
    inferencePerHour: 500,
    maxTransactionSize: 10000,
    canTrain: true,
    canTransfer: true,
  },
  legendary: {
    queriesPerHour: Infinity,
    inferencePerHour: Infinity,
    maxTransactionSize: Infinity,
    canTrain: true,
    canTransfer: true,
  },
};

// ─── In-Memory Ledger ────────────────────────────────

interface Ledger {
  transactions: CreditTransaction[];
  balances: Map<string, AgentBalance>;
  supply: NetworkSupply;
  rates: CreditRates;
  /** Recent transaction timestamps for velocity calc */
  recentTimestamps: number[];
}

const ledger: Ledger = {
  transactions: [],
  balances: new Map(),
  supply: {
    totalMinted: 0,
    totalBurned: 0,
    totalCirculating: 0,
    totalTransactions: 0,
    velocity24h: 0,
    giniCoefficient: 0,
  },
  rates: { ...DEFAULT_RATES },
  recentTimestamps: [],
};

// ─── Balance Management ──────────────────────────────

function ensureBalance(agentId: string): AgentBalance {
  let balance = ledger.balances.get(agentId);
  if (!balance) {
    const now = new Date().toISOString();
    balance = {
      agentId,
      balance: 0,
      totalEarned: 0,
      totalSpent: 0,
      earningsByCategory: {},
      spendingByCategory: {},
      transactionCount: 0,
      claimableCredits: 0,
      rateLimit: {
        queriesRemaining: TIER_LIMITS.newcomer.queriesPerHour,
        inferenceRemaining: TIER_LIMITS.newcomer.inferencePerHour,
        windowResetAt: new Date(Date.now() + 3600000).toISOString(),
        tier: 'newcomer',
      },
      lastActivity: now,
      createdAt: now,
    };
    ledger.balances.set(agentId, balance);
  }
  return balance;
}

function updateVelocity(): void {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  ledger.recentTimestamps = ledger.recentTimestamps.filter(t => t > cutoff);
  ledger.supply.velocity24h = ledger.recentTimestamps.length;
}

function updateGini(): void {
  const balances = Array.from(ledger.balances.values())
    .map(b => b.balance)
    .sort((a, b) => a - b);
  
  const n = balances.length;
  if (n === 0) { ledger.supply.giniCoefficient = 0; return; }
  
  const sum = balances.reduce((a, b) => a + b, 0);
  if (sum === 0) { ledger.supply.giniCoefficient = 0; return; }
  
  let cumulativeSum = 0;
  let giniNumerator = 0;
  for (let i = 0; i < n; i++) {
    cumulativeSum += balances[i];
    giniNumerator += (2 * (i + 1) - n - 1) * balances[i];
  }
  
  ledger.supply.giniCoefficient = Math.round((giniNumerator / (n * sum)) * 1000) / 1000;
}

// ─── Core Operations ─────────────────────────────────

/**
 * Earn credits for a contribution.
 * Amount is multiplied by the agent's tier multiplier.
 */
export function earnCredits(
  agentId: string,
  amount: number,
  reason: string,
  category: CreditCategory,
  options?: { reference?: string; tier?: string }
): CreditTransaction {
  if (amount <= 0) throw new Error('Earn amount must be positive');
  
  const balance = ensureBalance(agentId);
  const multiplier = options?.tier 
    ? (ledger.rates.tierMultipliers[options.tier] || 1) 
    : 1;
  const finalAmount = Math.round(amount * multiplier * 100) / 100;
  
  balance.balance += finalAmount;
  balance.totalEarned += finalAmount;
  balance.claimableCredits += finalAmount;
  balance.earningsByCategory[category] = (balance.earningsByCategory[category] || 0) + finalAmount;
  balance.transactionCount++;
  balance.lastActivity = new Date().toISOString();
  
  ledger.supply.totalMinted += finalAmount;
  ledger.supply.totalCirculating += finalAmount;
  
  const tx: CreditTransaction = {
    id: randomUUID(),
    agentId,
    action: 'earn',
    amount: finalAmount,
    reason,
    category,
    reference: options?.reference,
    balanceAfter: balance.balance,
    timestamp: new Date().toISOString(),
  };
  
  ledger.transactions.push(tx);
  ledger.supply.totalTransactions++;
  ledger.recentTimestamps.push(Date.now());
  
  return tx;
}

/**
 * Spend credits for a service (query, inference, etc).
 * Throws if insufficient balance.
 */
export function spendCredits(
  agentId: string,
  amount: number,
  reason: string,
  category: CreditCategory,
  options?: { reference?: string }
): CreditTransaction {
  if (amount <= 0) throw new Error('Spend amount must be positive');
  
  const balance = ensureBalance(agentId);
  if (balance.balance < amount) {
    throw new InsufficientCreditsError(agentId, balance.balance, amount);
  }
  
  balance.balance -= amount;
  balance.totalSpent += amount;
  balance.spendingByCategory[category] = (balance.spendingByCategory[category] || 0) + amount;
  balance.transactionCount++;
  balance.lastActivity = new Date().toISOString();
  
  ledger.supply.totalBurned += amount;
  ledger.supply.totalCirculating -= amount;
  
  const tx: CreditTransaction = {
    id: randomUUID(),
    agentId,
    action: 'spend',
    amount,
    reason,
    category,
    reference: options?.reference,
    balanceAfter: balance.balance,
    timestamp: new Date().toISOString(),
  };
  
  ledger.transactions.push(tx);
  ledger.supply.totalTransactions++;
  ledger.recentTimestamps.push(Date.now());
  
  return tx;
}

/**
 * Transfer credits between agents.
 * Requires trusted tier or above.
 */
export function transferCredits(
  fromAgentId: string,
  toAgentId: string,
  amount: number,
  reason: string,
  fromTier: string = 'newcomer'
): { fromTx: CreditTransaction; toTx: CreditTransaction } {
  const limits = TIER_LIMITS[fromTier] || TIER_LIMITS.newcomer;
  if (!limits.canTransfer) {
    throw new Error(`Tier '${fromTier}' cannot transfer credits. Requires trusted or above.`);
  }
  if (amount > limits.maxTransactionSize) {
    throw new Error(`Transfer exceeds max transaction size for tier '${fromTier}': ${limits.maxTransactionSize}`);
  }
  
  const fromBalance = ensureBalance(fromAgentId);
  if (fromBalance.balance < amount) {
    throw new InsufficientCreditsError(fromAgentId, fromBalance.balance, amount);
  }
  
  // Debit sender
  fromBalance.balance -= amount;
  fromBalance.totalSpent += amount;
  fromBalance.spendingByCategory['transfer'] = (fromBalance.spendingByCategory['transfer'] || 0) + amount;
  fromBalance.transactionCount++;
  fromBalance.lastActivity = new Date().toISOString();
  
  const fromTx: CreditTransaction = {
    id: randomUUID(),
    agentId: fromAgentId,
    action: 'transfer',
    amount,
    reason,
    category: 'transfer',
    toAgentId,
    balanceAfter: fromBalance.balance,
    timestamp: new Date().toISOString(),
  };
  
  // Credit receiver
  const toBalance = ensureBalance(toAgentId);
  toBalance.balance += amount;
  toBalance.totalEarned += amount;
  toBalance.earningsByCategory['transfer'] = (toBalance.earningsByCategory['transfer'] || 0) + amount;
  toBalance.transactionCount++;
  toBalance.lastActivity = new Date().toISOString();
  
  const toTx: CreditTransaction = {
    id: randomUUID(),
    agentId: toAgentId,
    action: 'earn',
    amount,
    reason: `Transfer from ${fromAgentId}: ${reason}`,
    category: 'transfer',
    reference: fromTx.id,
    balanceAfter: toBalance.balance,
    timestamp: new Date().toISOString(),
  };
  
  ledger.transactions.push(fromTx, toTx);
  ledger.supply.totalTransactions += 2;
  ledger.recentTimestamps.push(Date.now(), Date.now());
  
  return { fromTx, toTx };
}

/**
 * Apply a penalty (bad behavior, failed proofs, etc).
 */
export function penalizeAgent(
  agentId: string,
  amount: number,
  reason: string,
  reference?: string
): CreditTransaction {
  const balance = ensureBalance(agentId);
  const actualPenalty = Math.min(amount, balance.balance);
  
  balance.balance -= actualPenalty;
  balance.claimableCredits = Math.max(0, balance.claimableCredits - amount);
  balance.transactionCount++;
  balance.lastActivity = new Date().toISOString();
  
  ledger.supply.totalBurned += actualPenalty;
  ledger.supply.totalCirculating -= actualPenalty;
  
  const tx: CreditTransaction = {
    id: randomUUID(),
    agentId,
    action: 'penalty',
    amount,
    reason,
    category: 'penalty',
    reference,
    balanceAfter: balance.balance,
    timestamp: new Date().toISOString(),
  };
  
  ledger.transactions.push(tx);
  ledger.supply.totalTransactions++;
  
  return tx;
}

// ─── Rate Limiting ───────────────────────────────────

/**
 * Check if an agent can perform an action under rate limits.
 * Automatically resets windows and adjusts by tier.
 */
export function checkRateLimit(
  agentId: string,
  action: 'query' | 'inference',
  tier: string = 'newcomer'
): { allowed: boolean; remaining: number; resetAt: string } {
  const balance = ensureBalance(agentId);
  const limits = TIER_LIMITS[tier] || TIER_LIMITS.newcomer;
  const rl = balance.rateLimit;
  
  // Reset window if expired
  if (new Date(rl.windowResetAt).getTime() <= Date.now()) {
    rl.queriesRemaining = limits.queriesPerHour;
    rl.inferenceRemaining = limits.inferencePerHour;
    rl.windowResetAt = new Date(Date.now() + 3600000).toISOString();
    rl.tier = tier;
  }
  
  // Update tier if changed
  if (rl.tier !== tier) {
    rl.queriesRemaining = limits.queriesPerHour;
    rl.inferenceRemaining = limits.inferencePerHour;
    rl.tier = tier;
  }
  
  if (action === 'query') {
    const allowed = rl.queriesRemaining > 0;
    if (allowed) rl.queriesRemaining--;
    return { allowed, remaining: rl.queriesRemaining, resetAt: rl.windowResetAt };
  } else {
    const allowed = rl.inferenceRemaining > 0;
    if (allowed) rl.inferenceRemaining--;
    return { allowed, remaining: rl.inferenceRemaining, resetAt: rl.windowResetAt };
  }
}

// ─── Dynamic Pricing ─────────────────────────────────

/**
 * Calculate current pricing based on network conditions.
 * High demand → higher prices → incentivizes more supply.
 * Low demand → lower prices → encourages usage.
 */
export function getPricingSignal(): PricingSignal {
  updateVelocity();
  
  const agentCount = ledger.balances.size;
  if (agentCount === 0) {
    return {
      demandMultiplier: 1,
      utilization: 0,
      queryPrice: ledger.rates.queryBaseCost,
      inferencePrice: ledger.rates.inferenceBaseCost,
      timestamp: new Date().toISOString(),
    };
  }
  
  // Utilization: ratio of transactions to agent capacity
  // Assume each agent can handle ~100 requests/hour
  const maxCapacity = agentCount * 100 * 24;
  const utilization = Math.min(1, ledger.supply.velocity24h / maxCapacity);
  
  // Demand curve: sigmoid around 0.7 utilization
  // Below 0.5 → discount (0.5x-1x)
  // 0.5-0.8 → normal (1x)
  // Above 0.8 → premium (1x-3x)
  let demandMultiplier: number;
  if (utilization < 0.5) {
    demandMultiplier = 0.5 + utilization;
  } else if (utilization < 0.8) {
    demandMultiplier = 1;
  } else {
    demandMultiplier = 1 + (utilization - 0.8) * 10; // Up to 3x at 100%
  }
  
  demandMultiplier = Math.round(demandMultiplier * 100) / 100;
  
  return {
    demandMultiplier,
    utilization: Math.round(utilization * 1000) / 1000,
    queryPrice: Math.round(ledger.rates.queryBaseCost * demandMultiplier * 100) / 100,
    inferencePrice: Math.round(ledger.rates.inferenceBaseCost * demandMultiplier * 100) / 100,
    timestamp: new Date().toISOString(),
  };
}

// ─── Auto-Earn Hooks ─────────────────────────────────

/**
 * Auto-calculate and award credits for a storage contribution.
 */
export function rewardStorage(agentId: string, megabytes: number, tier?: string): CreditTransaction {
  const amount = megabytes * ledger.rates.storagePerMbPerDay;
  return earnCredits(agentId, amount, `Storage contribution: ${megabytes}MB`, 'storage', { tier });
}

/**
 * Auto-calculate and award credits for a compute task.
 */
export function rewardCompute(agentId: string, taskId: string, tier?: string): CreditTransaction {
  return earnCredits(agentId, ledger.rates.computePerTask, `Compute task: ${taskId}`, 'compute', { reference: taskId, tier });
}

/**
 * Auto-calculate and award credits for GPU inference.
 */
export function rewardGpuInference(
  agentId: string,
  tokensGenerated: number,
  taskId: string,
  tier?: string
): CreditTransaction {
  const baseReward = ledger.rates.gpuPerInferenceTask;
  const tokenReward = (tokensGenerated / 1000) * ledger.rates.gpuPer1kTokens;
  const total = baseReward + tokenReward;
  return earnCredits(agentId, total, `GPU inference: ${tokensGenerated} tokens`, 'gpu', { reference: taskId, tier });
}

/**
 * Auto-calculate and award credits for a training round.
 */
export function rewardTraining(agentId: string, roundId: string, tier?: string): CreditTransaction {
  return earnCredits(agentId, ledger.rates.trainingRoundBonus, `Training round: ${roundId}`, 'training', { reference: roundId, tier });
}

/**
 * Charge for an inference request based on token count.
 */
export function chargeInference(agentId: string, tokensUsed: number, requestId: string): CreditTransaction {
  const cost = ledger.rates.inferenceBaseCost + (tokensUsed / 1000) * ledger.rates.inferencePer1kTokens;
  return spendCredits(agentId, Math.round(cost * 100) / 100, `Inference: ${tokensUsed} tokens`, 'inference', { reference: requestId });
}

// ─── Migration ───────────────────────────────────────

/**
 * Create a migration snapshot of all balances.
 * Used when transitioning from credits to tokens.
 * Returns snapshot metadata.
 */
export function createMigrationSnapshot(): {
  snapshotId: string;
  timestamp: string;
  agentsSnapshotted: number;
  totalClaimable: number;
} {
  const snapshotId = randomUUID();
  const timestamp = new Date().toISOString();
  let totalClaimable = 0;
  
  for (const balance of ledger.balances.values()) {
    balance.migrationSnapshot = {
      balance: balance.claimableCredits,
      timestamp,
      snapshotId,
    };
    totalClaimable += balance.claimableCredits;
  }
  
  return {
    snapshotId,
    timestamp,
    agentsSnapshotted: ledger.balances.size,
    totalClaimable,
  };
}

// ─── Queries ─────────────────────────────────────────

export function getBalance(agentId: string): AgentBalance | undefined {
  return ledger.balances.get(agentId);
}

export function getSupply(): NetworkSupply {
  updateVelocity();
  updateGini();
  return { ...ledger.supply };
}

export function getLeaderboard(
  limit: number = 10,
  sortBy: 'balance' | 'earned' | 'spent' = 'earned'
): Array<{ rank: number; agentId: string; balance: number; totalEarned: number; totalSpent: number }> {
  return Array.from(ledger.balances.values())
    .sort((a, b) => {
      if (sortBy === 'balance') return b.balance - a.balance;
      if (sortBy === 'spent') return b.totalSpent - a.totalSpent;
      return b.totalEarned - a.totalEarned;
    })
    .slice(0, limit)
    .map((b, i) => ({
      rank: i + 1,
      agentId: b.agentId,
      balance: b.balance,
      totalEarned: b.totalEarned,
      totalSpent: b.totalSpent,
    }));
}

export function getTransactionHistory(
  agentId: string,
  limit: number = 20
): CreditTransaction[] {
  return ledger.transactions
    .filter(tx => tx.agentId === agentId)
    .slice(-limit)
    .reverse();
}

export function getRates(): CreditRates {
  return { ...ledger.rates };
}

export function updateRates(updates: Partial<CreditRates>): CreditRates {
  Object.assign(ledger.rates, updates);
  return { ...ledger.rates };
}

export function getTierLimits(tier: string): TierLimits {
  return TIER_LIMITS[tier] || TIER_LIMITS.newcomer;
}

// ─── Reset (Testing) ────────────────────────────────

export function clearEconomics(): void {
  ledger.transactions = [];
  ledger.balances.clear();
  ledger.supply = {
    totalMinted: 0,
    totalBurned: 0,
    totalCirculating: 0,
    totalTransactions: 0,
    velocity24h: 0,
    giniCoefficient: 0,
  };
  ledger.rates = { ...DEFAULT_RATES };
  ledger.recentTimestamps = [];
}

// ─── Error Types ─────────────────────────────────────

export class InsufficientCreditsError extends Error {
  public readonly agentId: string;
  public readonly balance: number;
  public readonly required: number;
  
  constructor(agentId: string, balance: number, required: number) {
    super(`Insufficient credits for agent '${agentId}': have ${balance}, need ${required}`);
    this.name = 'InsufficientCreditsError';
    this.agentId = agentId;
    this.balance = balance;
    this.required = required;
  }
}
