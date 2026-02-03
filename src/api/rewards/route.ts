/**
 * dpth.io Agent Rewards API
 * 
 * What agents GET for contributing to the network.
 * Rewards are unlocked based on contribution score and reputation tier.
 * 
 * GET /api/dpth/rewards?agentId=xxx - Get agent's available rewards
 * POST /api/dpth/rewards/claim - Claim a reward
 * GET /api/dpth/rewards/catalog - List all available rewards
 */

import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs/promises';
import * as path from 'path';

// ─── Types ───────────────────────────────────────────

type RewardTier = 'newcomer' | 'contributor' | 'trusted' | 'elite' | 'legendary';

interface Reward {
  id: string;
  name: string;
  description: string;
  /** Minimum tier required */
  minTier: RewardTier;
  /** Minimum contribution score required */
  minScore: number;
  /** Type of reward */
  type: 'storage' | 'compute' | 'intelligence' | 'access';
  /** Reward-specific value */
  value: {
    /** For storage: GB of network storage */
    storageMb?: number;
    /** For compute: task priority boost */
    priorityBoost?: number;
    /** For intelligence: queries per day */
    queriesPerDay?: number;
    /** For access: feature flags */
    features?: string[];
  };
  /** Is this a one-time or recurring reward */
  recurring: boolean;
  /** If recurring, how often (days) */
  recurringDays?: number;
}

interface AgentRewards {
  agentId: string;
  /** Currently active rewards */
  activeRewards: Array<{
    rewardId: string;
    claimedAt: string;
    expiresAt?: string;
  }>;
  /** Total rewards claimed */
  totalClaimed: number;
  /** Current effective limits */
  effectiveLimits: {
    storageMb: number;
    queriesPerDay: number;
    priorityBoost: number;
    features: string[];
  };
}

interface RewardsRegistry {
  agents: Record<string, AgentRewards>;
}

// ─── Reward Catalog ──────────────────────────────────

const REWARD_CATALOG: Reward[] = [
  // Storage Rewards
  {
    id: 'storage-basic',
    name: 'Basic Storage',
    description: '100 MB of network storage for your data',
    minTier: 'newcomer',
    minScore: 0,
    type: 'storage',
    value: { storageMb: 100 },
    recurring: false,
  },
  {
    id: 'storage-contributor',
    name: 'Contributor Storage',
    description: '500 MB of network storage',
    minTier: 'contributor',
    minScore: 25,
    type: 'storage',
    value: { storageMb: 500 },
    recurring: false,
  },
  {
    id: 'storage-trusted',
    name: 'Trusted Storage',
    description: '2 GB of network storage',
    minTier: 'trusted',
    minScore: 50,
    type: 'storage',
    value: { storageMb: 2048 },
    recurring: false,
  },
  {
    id: 'storage-elite',
    name: 'Elite Storage',
    description: '10 GB of network storage',
    minTier: 'elite',
    minScore: 75,
    type: 'storage',
    value: { storageMb: 10240 },
    recurring: false,
  },
  {
    id: 'storage-unlimited',
    name: 'Unlimited Storage',
    description: 'Unlimited network storage',
    minTier: 'legendary',
    minScore: 95,
    type: 'storage',
    value: { storageMb: -1 }, // -1 = unlimited
    recurring: false,
  },
  
  // Intelligence Rewards
  {
    id: 'intelligence-basic',
    name: 'Basic Intelligence',
    description: '10 intelligence queries per day',
    minTier: 'newcomer',
    minScore: 10,
    type: 'intelligence',
    value: { queriesPerDay: 10 },
    recurring: true,
    recurringDays: 1,
  },
  {
    id: 'intelligence-contributor',
    name: 'Contributor Intelligence',
    description: '50 intelligence queries per day',
    minTier: 'contributor',
    minScore: 30,
    type: 'intelligence',
    value: { queriesPerDay: 50 },
    recurring: true,
    recurringDays: 1,
  },
  {
    id: 'intelligence-trusted',
    name: 'Trusted Intelligence',
    description: '200 intelligence queries per day',
    minTier: 'trusted',
    minScore: 55,
    type: 'intelligence',
    value: { queriesPerDay: 200 },
    recurring: true,
    recurringDays: 1,
  },
  {
    id: 'intelligence-elite',
    name: 'Elite Intelligence',
    description: '1000 intelligence queries per day',
    minTier: 'elite',
    minScore: 80,
    type: 'intelligence',
    value: { queriesPerDay: 1000 },
    recurring: true,
    recurringDays: 1,
  },
  {
    id: 'intelligence-unlimited',
    name: 'Unlimited Intelligence',
    description: 'Unlimited intelligence queries',
    minTier: 'legendary',
    minScore: 95,
    type: 'intelligence',
    value: { queriesPerDay: -1 },
    recurring: false,
  },
  
  // Compute Priority Rewards
  {
    id: 'priority-boost',
    name: 'Priority Boost',
    description: 'Your tasks get processed faster',
    minTier: 'contributor',
    minScore: 35,
    type: 'compute',
    value: { priorityBoost: 1 },
    recurring: false,
  },
  {
    id: 'priority-high',
    name: 'High Priority',
    description: 'Your tasks skip the queue',
    minTier: 'trusted',
    minScore: 60,
    type: 'compute',
    value: { priorityBoost: 2 },
    recurring: false,
  },
  {
    id: 'priority-critical',
    name: 'Critical Priority',
    description: 'Your tasks are processed immediately',
    minTier: 'elite',
    minScore: 85,
    type: 'compute',
    value: { priorityBoost: 3 },
    recurring: false,
  },
  
  // Access Rewards
  {
    id: 'access-entity-resolution',
    name: 'Entity Resolution',
    description: 'Access cross-source entity matching',
    minTier: 'contributor',
    minScore: 25,
    type: 'access',
    value: { features: ['entity_resolution'] },
    recurring: false,
  },
  {
    id: 'access-pattern-discovery',
    name: 'Pattern Discovery',
    description: 'Access network-wide pattern detection',
    minTier: 'trusted',
    minScore: 50,
    type: 'access',
    value: { features: ['pattern_discovery'] },
    recurring: false,
  },
  {
    id: 'access-semantic-search',
    name: 'Semantic Search',
    description: 'Search across all your data semantically',
    minTier: 'trusted',
    minScore: 55,
    type: 'access',
    value: { features: ['semantic_search'] },
    recurring: false,
  },
  {
    id: 'access-network-insights',
    name: 'Network Insights',
    description: 'Access anonymized network-wide insights',
    minTier: 'elite',
    minScore: 75,
    type: 'access',
    value: { features: ['network_insights'] },
    recurring: false,
  },
  {
    id: 'access-api',
    name: 'API Access',
    description: 'Programmatic access to dpth.io APIs',
    minTier: 'trusted',
    minScore: 50,
    type: 'access',
    value: { features: ['api_access'] },
    recurring: false,
  },
  {
    id: 'access-beta',
    name: 'Beta Features',
    description: 'Early access to new features',
    minTier: 'elite',
    minScore: 80,
    type: 'access',
    value: { features: ['beta_features'] },
    recurring: false,
  },
];

// ─── Storage ─────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR || 'data';
const REWARDS_FILE = path.join(DATA_DIR, 'dpth', 'rewards.json');
const REPUTATION_FILE = path.join(DATA_DIR, 'dpth', 'reputation.json');
const CONTRIBUTIONS_FILE = path.join(DATA_DIR, 'dpth', 'contributions.json');

async function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

async function loadRewards(): Promise<RewardsRegistry> {
  try {
    const data = await fs.readFile(REWARDS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { agents: {} };
  }
}

async function saveRewards(registry: RewardsRegistry): Promise<void> {
  await ensureDir(REWARDS_FILE);
  await fs.writeFile(REWARDS_FILE, JSON.stringify(registry, null, 2));
}

async function getAgentTierAndScore(agentId: string): Promise<{ tier: RewardTier; score: number }> {
  try {
    const repData = await fs.readFile(REPUTATION_FILE, 'utf-8');
    const reputation = JSON.parse(repData);
    const agent = reputation.agents?.[agentId];
    if (agent) {
      return { tier: agent.tier, score: agent.score };
    }
  } catch {}
  
  // Check contributions for score
  try {
    const contribData = await fs.readFile(CONTRIBUTIONS_FILE, 'utf-8');
    const contributions = JSON.parse(contribData);
    const storage = contributions.storage?.[agentId];
    const compute = contributions.compute?.[agentId];
    
    let score = 0;
    if (storage) {
      score += storage.totalBytes / 1024 / 1024; // 1 point per MB
    }
    if (compute) {
      score += compute.tasksCompleted * 10 * (compute.successRate || 1);
    }
    
    return { tier: 'newcomer', score: Math.min(100, score) };
  } catch {}
  
  return { tier: 'newcomer', score: 0 };
}

const TIER_ORDER: RewardTier[] = ['newcomer', 'contributor', 'trusted', 'elite', 'legendary'];

function tierMeetsMinimum(agentTier: RewardTier, minTier: RewardTier): boolean {
  return TIER_ORDER.indexOf(agentTier) >= TIER_ORDER.indexOf(minTier);
}

// ─── Handlers ────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');
    const catalog = searchParams.get('catalog');
    
    // Return full catalog
    if (catalog !== null) {
      return NextResponse.json({
        rewards: REWARD_CATALOG.map(r => ({
          id: r.id,
          name: r.name,
          description: r.description,
          minTier: r.minTier,
          minScore: r.minScore,
          type: r.type,
          value: r.value,
          recurring: r.recurring,
        })),
      });
    }
    
    // Agent-specific rewards
    if (agentId) {
      const { tier, score } = await getAgentTierAndScore(agentId);
      const registry = await loadRewards();
      const agentRewards = registry.agents[agentId];
      
      // Find available rewards (not yet claimed, meets requirements)
      const claimedIds = new Set(agentRewards?.activeRewards.map(r => r.rewardId) || []);
      
      const available = REWARD_CATALOG.filter(r => {
        if (claimedIds.has(r.id) && !r.recurring) return false;
        if (!tierMeetsMinimum(tier, r.minTier)) return false;
        if (score < r.minScore) return false;
        return true;
      });
      
      const claimed = agentRewards?.activeRewards || [];
      
      // Calculate effective limits
      const effectiveLimits = calculateEffectiveLimits(claimed);
      
      return NextResponse.json({
        agentId,
        tier,
        score,
        available: available.map(r => ({
          id: r.id,
          name: r.name,
          description: r.description,
          type: r.type,
          value: r.value,
        })),
        claimed: claimed.map(c => {
          const reward = REWARD_CATALOG.find(r => r.id === c.rewardId);
          return {
            ...c,
            name: reward?.name,
            type: reward?.type,
          };
        }),
        effectiveLimits,
      });
    }
    
    return NextResponse.json({ error: 'Missing agentId' }, { status: 400 });
    
  } catch (error) {
    console.error('Failed to get rewards:', error);
    return NextResponse.json({ error: 'Failed to get rewards' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentId, rewardId } = body;
    
    if (!agentId || !rewardId) {
      return NextResponse.json(
        { error: 'Missing agentId or rewardId' },
        { status: 400 }
      );
    }
    
    // Find reward
    const reward = REWARD_CATALOG.find(r => r.id === rewardId);
    if (!reward) {
      return NextResponse.json({ error: 'Reward not found' }, { status: 404 });
    }
    
    // Check eligibility
    const { tier, score } = await getAgentTierAndScore(agentId);
    
    if (!tierMeetsMinimum(tier, reward.minTier)) {
      return NextResponse.json(
        { error: `Requires ${reward.minTier} tier (you are ${tier})` },
        { status: 403 }
      );
    }
    
    if (score < reward.minScore) {
      return NextResponse.json(
        { error: `Requires ${reward.minScore} score (you have ${Math.round(score)})` },
        { status: 403 }
      );
    }
    
    const registry = await loadRewards();
    
    // Initialize agent if needed
    if (!registry.agents[agentId]) {
      registry.agents[agentId] = {
        agentId,
        activeRewards: [],
        totalClaimed: 0,
        effectiveLimits: {
          storageMb: 0,
          queriesPerDay: 0,
          priorityBoost: 0,
          features: [],
        },
      };
    }
    
    const agentRewards = registry.agents[agentId];
    
    // Check if already claimed (for non-recurring)
    if (!reward.recurring && agentRewards.activeRewards.some(r => r.rewardId === rewardId)) {
      return NextResponse.json(
        { error: 'Reward already claimed' },
        { status: 409 }
      );
    }
    
    // Claim the reward
    const now = new Date();
    const claimRecord = {
      rewardId,
      claimedAt: now.toISOString(),
      expiresAt: reward.recurring && reward.recurringDays
        ? new Date(now.getTime() + reward.recurringDays * 24 * 60 * 60 * 1000).toISOString()
        : undefined,
    };
    
    agentRewards.activeRewards.push(claimRecord);
    agentRewards.totalClaimed++;
    agentRewards.effectiveLimits = calculateEffectiveLimits(agentRewards.activeRewards);
    
    await saveRewards(registry);
    
    return NextResponse.json({
      message: 'Reward claimed',
      reward: {
        id: reward.id,
        name: reward.name,
        type: reward.type,
        value: reward.value,
      },
      effectiveLimits: agentRewards.effectiveLimits,
    });
    
  } catch (error) {
    console.error('Failed to claim reward:', error);
    return NextResponse.json({ error: 'Failed to claim reward' }, { status: 500 });
  }
}

// ─── Helpers ─────────────────────────────────────────

function calculateEffectiveLimits(activeRewards: Array<{ rewardId: string; expiresAt?: string }>): AgentRewards['effectiveLimits'] {
  const limits = {
    storageMb: 0,
    queriesPerDay: 0,
    priorityBoost: 0,
    features: [] as string[],
  };
  
  const now = new Date();
  
  for (const claim of activeRewards) {
    // Skip expired rewards
    if (claim.expiresAt && new Date(claim.expiresAt) < now) continue;
    
    const reward = REWARD_CATALOG.find(r => r.id === claim.rewardId);
    if (!reward) continue;
    
    // Accumulate limits (take max for storage/queries, sum for priority)
    if (reward.value.storageMb) {
      if (reward.value.storageMb === -1) {
        limits.storageMb = -1; // Unlimited
      } else if (limits.storageMb !== -1) {
        limits.storageMb = Math.max(limits.storageMb, reward.value.storageMb);
      }
    }
    
    if (reward.value.queriesPerDay) {
      if (reward.value.queriesPerDay === -1) {
        limits.queriesPerDay = -1; // Unlimited
      } else if (limits.queriesPerDay !== -1) {
        limits.queriesPerDay = Math.max(limits.queriesPerDay, reward.value.queriesPerDay);
      }
    }
    
    if (reward.value.priorityBoost) {
      limits.priorityBoost = Math.max(limits.priorityBoost, reward.value.priorityBoost);
    }
    
    if (reward.value.features) {
      limits.features.push(...reward.value.features);
    }
  }
  
  // Dedupe features
  limits.features = [...new Set(limits.features)];
  
  return limits;
}
