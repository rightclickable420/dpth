/**
 * dpth.io Reputation System
 * 
 * Agents earn reputation through contributions and lose it through failures.
 * Reputation affects task priority, storage allocation, and network privileges.
 * 
 * GET /api/dpth/reputation?agentId=xxx - Get agent's reputation
 * GET /api/dpth/reputation/leaderboard - Top agents by reputation
 * POST /api/dpth/reputation - Update reputation (internal use)
 */

import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs/promises';
import * as path from 'path';

// ─── Types ───────────────────────────────────────────

interface ReputationEvent {
  type: 'task_complete' | 'task_fail' | 'storage_verify' | 'storage_fail' | 'uptime_bonus' | 'penalty';
  delta: number;
  timestamp: string;
  details?: string;
}

interface AgentReputation {
  agentId: string;
  /** Current reputation score (0-100) */
  score: number;
  /** Reputation tier */
  tier: 'newcomer' | 'contributor' | 'trusted' | 'elite' | 'legendary';
  /** Recent events affecting reputation */
  recentEvents: ReputationEvent[];
  /** Lifetime stats */
  lifetime: {
    tasksCompleted: number;
    tasksFailed: number;
    storageVerified: number;
    storageFailed: number;
    totalEarned: number;
    totalLost: number;
  };
  /** Privileges unlocked at this tier */
  privileges: string[];
  /** When agent joined */
  joinedAt: string;
  /** Last activity */
  lastActive: string;
}

interface ReputationRegistry {
  agents: Record<string, AgentReputation>;
}

// ─── Constants ───────────────────────────────────────

const REPUTATION_DELTAS = {
  task_complete: 2,
  task_fail: -5,
  storage_verify: 1,
  storage_fail: -10,
  uptime_bonus: 5,  // Daily bonus for staying online
  penalty: -20,     // Manual penalty for bad behavior
};

const TIER_THRESHOLDS = {
  newcomer: 0,
  contributor: 25,
  trusted: 50,
  elite: 75,
  legendary: 95,
};

const TIER_PRIVILEGES: Record<string, string[]> = {
  newcomer: ['basic_tasks', 'basic_storage'],
  contributor: ['priority_tasks', 'extended_storage', 'network_stats'],
  trusted: ['high_priority_tasks', 'large_storage', 'api_access'],
  elite: ['critical_tasks', 'unlimited_storage', 'beta_features'],
  legendary: ['governance_voting', 'task_creation', 'network_admin'],
};

// ─── Storage ─────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR || 'data';
const REPUTATION_FILE = path.join(DATA_DIR, 'dpth', 'reputation.json');

async function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

async function loadReputation(): Promise<ReputationRegistry> {
  try {
    const data = await fs.readFile(REPUTATION_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { agents: {} };
  }
}

async function saveReputation(registry: ReputationRegistry): Promise<void> {
  await ensureDir(REPUTATION_FILE);
  await fs.writeFile(REPUTATION_FILE, JSON.stringify(registry, null, 2));
}

function getTier(score: number): AgentReputation['tier'] {
  if (score >= TIER_THRESHOLDS.legendary) return 'legendary';
  if (score >= TIER_THRESHOLDS.elite) return 'elite';
  if (score >= TIER_THRESHOLDS.trusted) return 'trusted';
  if (score >= TIER_THRESHOLDS.contributor) return 'contributor';
  return 'newcomer';
}

function getPrivileges(tier: AgentReputation['tier']): string[] {
  const privileges: string[] = [];
  const tiers = ['newcomer', 'contributor', 'trusted', 'elite', 'legendary'];
  const tierIndex = tiers.indexOf(tier);
  
  for (let i = 0; i <= tierIndex; i++) {
    privileges.push(...TIER_PRIVILEGES[tiers[i]]);
  }
  
  return [...new Set(privileges)];
}

// ─── Handlers ────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');
    const leaderboard = searchParams.get('leaderboard');
    
    const registry = await loadReputation();
    
    // Leaderboard
    if (leaderboard !== null) {
      const limit = parseInt(searchParams.get('limit') || '20');
      
      const ranked = Object.values(registry.agents)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((agent, rank) => ({
          rank: rank + 1,
          agentId: agent.agentId,
          score: agent.score,
          tier: agent.tier,
          tasksCompleted: agent.lifetime.tasksCompleted,
          joinedAt: agent.joinedAt,
        }));
      
      return NextResponse.json({
        leaderboard: ranked,
        totalAgents: Object.keys(registry.agents).length,
      });
    }
    
    // Single agent
    if (agentId) {
      const agent = registry.agents[agentId];
      
      if (!agent) {
        // Return default for new agent
        return NextResponse.json({
          agentId,
          score: 50,
          tier: 'newcomer',
          privileges: TIER_PRIVILEGES.newcomer,
          lifetime: {
            tasksCompleted: 0,
            tasksFailed: 0,
            storageVerified: 0,
            storageFailed: 0,
            totalEarned: 0,
            totalLost: 0,
          },
          isNew: true,
        });
      }
      
      return NextResponse.json({
        agentId: agent.agentId,
        score: agent.score,
        tier: agent.tier,
        privileges: agent.privileges,
        recentEvents: agent.recentEvents.slice(-10),
        lifetime: agent.lifetime,
        joinedAt: agent.joinedAt,
        lastActive: agent.lastActive,
        nextTier: getNextTierInfo(agent.score),
      });
    }
    
    // Network summary
    const agents = Object.values(registry.agents);
    const tierCounts = {
      newcomer: agents.filter(a => a.tier === 'newcomer').length,
      contributor: agents.filter(a => a.tier === 'contributor').length,
      trusted: agents.filter(a => a.tier === 'trusted').length,
      elite: agents.filter(a => a.tier === 'elite').length,
      legendary: agents.filter(a => a.tier === 'legendary').length,
    };
    
    return NextResponse.json({
      totalAgents: agents.length,
      averageScore: agents.length > 0 
        ? Math.round(agents.reduce((sum, a) => sum + a.score, 0) / agents.length)
        : 50,
      tierDistribution: tierCounts,
    });
    
  } catch (error) {
    console.error('Failed to get reputation:', error);
    return NextResponse.json({ error: 'Failed to get reputation' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentId, eventType, details } = body;
    
    if (!agentId || !eventType) {
      return NextResponse.json(
        { error: 'Missing agentId or eventType' },
        { status: 400 }
      );
    }
    
    const delta = REPUTATION_DELTAS[eventType as keyof typeof REPUTATION_DELTAS];
    if (delta === undefined) {
      return NextResponse.json(
        { error: `Invalid event type: ${eventType}` },
        { status: 400 }
      );
    }
    
    const registry = await loadReputation();
    
    // Get or create agent reputation
    if (!registry.agents[agentId]) {
      registry.agents[agentId] = {
        agentId,
        score: 50, // Start at neutral
        tier: 'newcomer',
        recentEvents: [],
        lifetime: {
          tasksCompleted: 0,
          tasksFailed: 0,
          storageVerified: 0,
          storageFailed: 0,
          totalEarned: 0,
          totalLost: 0,
        },
        privileges: TIER_PRIVILEGES.newcomer,
        joinedAt: new Date().toISOString(),
        lastActive: new Date().toISOString(),
      };
    }
    
    const agent = registry.agents[agentId];
    
    // Create event
    const event: ReputationEvent = {
      type: eventType as ReputationEvent['type'],
      delta,
      timestamp: new Date().toISOString(),
      details,
    };
    
    // Apply delta (clamp to 0-100)
    const oldScore = agent.score;
    agent.score = Math.max(0, Math.min(100, agent.score + delta));
    
    // Update lifetime stats
    if (delta > 0) {
      agent.lifetime.totalEarned += delta;
    } else {
      agent.lifetime.totalLost += Math.abs(delta);
    }
    
    switch (eventType) {
      case 'task_complete':
        agent.lifetime.tasksCompleted++;
        break;
      case 'task_fail':
        agent.lifetime.tasksFailed++;
        break;
      case 'storage_verify':
        agent.lifetime.storageVerified++;
        break;
      case 'storage_fail':
        agent.lifetime.storageFailed++;
        break;
    }
    
    // Add event to history (keep last 100)
    agent.recentEvents.push(event);
    if (agent.recentEvents.length > 100) {
      agent.recentEvents = agent.recentEvents.slice(-100);
    }
    
    // Update tier and privileges
    const newTier = getTier(agent.score);
    const tierChanged = agent.tier !== newTier;
    agent.tier = newTier;
    agent.privileges = getPrivileges(newTier);
    agent.lastActive = new Date().toISOString();
    
    await saveReputation(registry);
    
    return NextResponse.json({
      message: 'Reputation updated',
      agentId,
      oldScore,
      newScore: agent.score,
      delta,
      tier: agent.tier,
      tierChanged,
      privileges: agent.privileges,
    });
    
  } catch (error) {
    console.error('Failed to update reputation:', error);
    return NextResponse.json({ error: 'Failed to update reputation' }, { status: 500 });
  }
}

// ─── Helpers ─────────────────────────────────────────

function getNextTierInfo(currentScore: number): { tier: string; pointsNeeded: number } | null {
  const tiers = ['newcomer', 'contributor', 'trusted', 'elite', 'legendary'] as const;
  const currentTier = getTier(currentScore);
  const currentIndex = tiers.indexOf(currentTier);
  
  if (currentIndex >= tiers.length - 1) {
    return null; // Already legendary
  }
  
  const nextTier = tiers[currentIndex + 1];
  const threshold = TIER_THRESHOLDS[nextTier];
  
  return {
    tier: nextTier,
    pointsNeeded: threshold - currentScore,
  };
}
