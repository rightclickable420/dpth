/**
 * dpth.io Storage Proofs API
 * 
 * Verify that agents actually store what they claim to store.
 * Uses challenge-response verification with random sampling.
 * 
 * POST /api/dpth/proofs/challenge - Create a storage challenge for an agent
 * POST /api/dpth/proofs/respond - Agent submits proof response
 * GET /api/dpth/proofs/status?agentId=xxx - Get proof status for an agent
 * GET /api/dpth/proofs/pending - Get pending challenges
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

// ─── Types ───────────────────────────────────────────

interface StorageChallenge {
  id: string;
  agentId: string;
  /** CID to prove storage of */
  cid: string;
  /** Random nonce for this challenge */
  nonce: string;
  /** When challenge was issued */
  issuedAt: string;
  /** When challenge expires */
  expiresAt: string;
  /** Challenge status */
  status: 'pending' | 'passed' | 'failed' | 'expired';
  /** Response data (if submitted) */
  response?: {
    submittedAt: string;
    proof: string;
    valid: boolean;
  };
}

interface ProofStats {
  agentId: string;
  totalChallenges: number;
  passed: number;
  failed: number;
  expired: number;
  successRate: number;
  lastChallenge: string | null;
  consecutivePasses: number;
  consecutiveFails: number;
}

interface ProofRegistry {
  challenges: StorageChallenge[];
  stats: Record<string, ProofStats>;
  /** Network-wide stats */
  networkStats: {
    totalChallenges: number;
    totalPassed: number;
    totalFailed: number;
    totalExpired: number;
  };
}

// ─── Constants ───────────────────────────────────────

/** Challenge validity period in ms (5 minutes) */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** Maximum pending challenges per agent */
const MAX_PENDING_PER_AGENT = 3;

// ─── Storage ─────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR || 'data';
const PROOFS_FILE = path.join(DATA_DIR, 'dpth', 'proofs.json');
const STORAGE_DIR = path.join(DATA_DIR, 'dpth', 'storage');
const CONTRIBUTIONS_FILE = path.join(DATA_DIR, 'dpth', 'contributions.json');

async function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

async function loadProofs(): Promise<ProofRegistry> {
  try {
    const data = await fs.readFile(PROOFS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {
      challenges: [],
      stats: {},
      networkStats: {
        totalChallenges: 0,
        totalPassed: 0,
        totalFailed: 0,
        totalExpired: 0,
      },
    };
  }
}

async function saveProofs(registry: ProofRegistry): Promise<void> {
  await ensureDir(PROOFS_FILE);
  await fs.writeFile(PROOFS_FILE, JSON.stringify(registry, null, 2));
}

async function loadContributions(): Promise<{
  storage: Record<string, { storedCids: string[]; verificationFailures: number }>;
}> {
  try {
    const data = await fs.readFile(CONTRIBUTIONS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { storage: {} };
  }
}

async function updateContributionFailures(agentId: string, failures: number): Promise<void> {
  const contributions = await loadContributions();
  if (contributions.storage[agentId]) {
    contributions.storage[agentId].verificationFailures = failures;
    await fs.writeFile(CONTRIBUTIONS_FILE, JSON.stringify(contributions, null, 2));
  }
}

/**
 * Generate expected proof for a CID + nonce
 * Proof = SHA256(chunk_data + nonce)
 */
async function generateExpectedProof(cid: string, nonce: string): Promise<string | null> {
  try {
    const chunkPath = path.join(STORAGE_DIR, `${cid}.json`);
    const data = await fs.readFile(chunkPath, 'utf-8');
    const hash = createHash('sha256');
    hash.update(data);
    hash.update(nonce);
    return hash.digest('hex');
  } catch {
    return null;
  }
}

// ─── Helpers ─────────────────────────────────────────

function initStats(agentId: string): ProofStats {
  return {
    agentId,
    totalChallenges: 0,
    passed: 0,
    failed: 0,
    expired: 0,
    successRate: 1,
    lastChallenge: null,
    consecutivePasses: 0,
    consecutiveFails: 0,
  };
}

function expireChallenges(registry: ProofRegistry): number {
  const now = new Date();
  let expired = 0;
  
  for (const challenge of registry.challenges) {
    if (challenge.status === 'pending' && new Date(challenge.expiresAt) < now) {
      challenge.status = 'expired';
      expired++;
      
      // Update stats
      if (!registry.stats[challenge.agentId]) {
        registry.stats[challenge.agentId] = initStats(challenge.agentId);
      }
      const stats = registry.stats[challenge.agentId];
      stats.expired++;
      stats.consecutivePasses = 0;
      stats.consecutiveFails++;
      stats.successRate = stats.passed / Math.max(1, stats.totalChallenges);
      
      registry.networkStats.totalExpired++;
    }
  }
  
  return expired;
}

// ─── Handlers ────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');
    const pending = searchParams.get('pending');
    
    const registry = await loadProofs();
    
    // Expire old challenges
    expireChallenges(registry);
    await saveProofs(registry);
    
    // Return pending challenges
    if (pending !== null) {
      const pendingChallenges = registry.challenges
        .filter(c => c.status === 'pending')
        .map(c => ({
          id: c.id,
          agentId: c.agentId,
          cid: c.cid,
          nonce: c.nonce,
          expiresAt: c.expiresAt,
        }));
      
      return NextResponse.json({
        pending: pendingChallenges,
        count: pendingChallenges.length,
      });
    }
    
    // Return agent stats
    if (agentId) {
      const stats = registry.stats[agentId] || initStats(agentId);
      const agentChallenges = registry.challenges
        .filter(c => c.agentId === agentId)
        .slice(-10) // Last 10
        .map(c => ({
          id: c.id,
          cid: c.cid,
          status: c.status,
          issuedAt: c.issuedAt,
          response: c.response ? {
            submittedAt: c.response.submittedAt,
            valid: c.response.valid,
          } : undefined,
        }));
      
      return NextResponse.json({
        agentId,
        stats,
        recentChallenges: agentChallenges,
      });
    }
    
    // Return network overview
    return NextResponse.json({
      network: registry.networkStats,
      agentCount: Object.keys(registry.stats).length,
      pendingChallenges: registry.challenges.filter(c => c.status === 'pending').length,
      topPerformers: Object.values(registry.stats)
        .sort((a, b) => b.successRate - a.successRate)
        .slice(0, 5)
        .map(s => ({
          agentId: s.agentId,
          successRate: Math.round(s.successRate * 100),
          totalChallenges: s.totalChallenges,
        })),
    });
    
  } catch (error) {
    console.error('Failed to get proof status:', error);
    return NextResponse.json({ error: 'Failed to get proof status' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const body = await request.json();
    
    const registry = await loadProofs();
    
    // Expire old challenges first
    expireChallenges(registry);
    
    // ─── Create Challenge ────────────────────────────
    if (action === 'challenge') {
      const { agentId, cid } = body;
      
      if (!agentId) {
        return NextResponse.json({ error: 'Missing agentId' }, { status: 400 });
      }
      
      // Get agent's stored CIDs
      const contributions = await loadContributions();
      const agentStorage = contributions.storage[agentId];
      
      if (!agentStorage || agentStorage.storedCids.length === 0) {
        return NextResponse.json(
          { error: 'Agent has no stored CIDs to verify' },
          { status: 404 }
        );
      }
      
      // Check pending challenge limit
      const pendingCount = registry.challenges.filter(
        c => c.agentId === agentId && c.status === 'pending'
      ).length;
      
      if (pendingCount >= MAX_PENDING_PER_AGENT) {
        return NextResponse.json(
          { error: `Agent has ${pendingCount} pending challenges (max ${MAX_PENDING_PER_AGENT})` },
          { status: 429 }
        );
      }
      
      // Select CID to challenge (random if not specified)
      const targetCid = cid || agentStorage.storedCids[
        Math.floor(Math.random() * agentStorage.storedCids.length)
      ];
      
      if (!agentStorage.storedCids.includes(targetCid)) {
        return NextResponse.json(
          { error: 'Agent does not claim to store this CID' },
          { status: 400 }
        );
      }
      
      // Create challenge
      const now = new Date();
      const challenge: StorageChallenge = {
        id: randomBytes(16).toString('hex'),
        agentId,
        cid: targetCid,
        nonce: randomBytes(32).toString('hex'),
        issuedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString(),
        status: 'pending',
      };
      
      registry.challenges.push(challenge);
      
      // Initialize stats if needed
      if (!registry.stats[agentId]) {
        registry.stats[agentId] = initStats(agentId);
      }
      registry.stats[agentId].totalChallenges++;
      registry.stats[agentId].lastChallenge = now.toISOString();
      
      registry.networkStats.totalChallenges++;
      
      await saveProofs(registry);
      
      return NextResponse.json({
        message: 'Challenge created',
        challenge: {
          id: challenge.id,
          cid: challenge.cid,
          nonce: challenge.nonce,
          expiresAt: challenge.expiresAt,
        },
      }, { status: 201 });
    }
    
    // ─── Submit Response ─────────────────────────────
    if (action === 'respond') {
      const { challengeId, agentId, proof } = body;
      
      if (!challengeId || !agentId || !proof) {
        return NextResponse.json(
          { error: 'Missing challengeId, agentId, or proof' },
          { status: 400 }
        );
      }
      
      // Find challenge
      const challenge = registry.challenges.find(
        c => c.id === challengeId && c.agentId === agentId
      );
      
      if (!challenge) {
        return NextResponse.json({ error: 'Challenge not found' }, { status: 404 });
      }
      
      if (challenge.status !== 'pending') {
        return NextResponse.json(
          { error: `Challenge already ${challenge.status}` },
          { status: 400 }
        );
      }
      
      if (new Date(challenge.expiresAt) < new Date()) {
        challenge.status = 'expired';
        await saveProofs(registry);
        return NextResponse.json({ error: 'Challenge expired' }, { status: 400 });
      }
      
      // Verify proof
      const expectedProof = await generateExpectedProof(challenge.cid, challenge.nonce);
      const valid = expectedProof !== null && proof === expectedProof;
      
      // Record response
      challenge.response = {
        submittedAt: new Date().toISOString(),
        proof,
        valid,
      };
      challenge.status = valid ? 'passed' : 'failed';
      
      // Update stats
      const stats = registry.stats[agentId];
      if (valid) {
        stats.passed++;
        stats.consecutivePasses++;
        stats.consecutiveFails = 0;
        registry.networkStats.totalPassed++;
      } else {
        stats.failed++;
        stats.consecutiveFails++;
        stats.consecutivePasses = 0;
        registry.networkStats.totalFailed++;
        
        // Update contribution verification failures
        await updateContributionFailures(agentId, stats.failed);
      }
      stats.successRate = stats.passed / Math.max(1, stats.totalChallenges - stats.expired);
      
      await saveProofs(registry);
      
      return NextResponse.json({
        message: valid ? 'Proof verified' : 'Proof invalid',
        valid,
        stats: {
          successRate: Math.round(stats.successRate * 100),
          consecutivePasses: stats.consecutivePasses,
          consecutiveFails: stats.consecutiveFails,
        },
      });
    }
    
    // ─── Batch Challenge (for network verification) ──
    if (action === 'batch') {
      const { count = 5 } = body;
      
      // Get all agents with storage
      const contributions = await loadContributions();
      const agentsWithStorage = Object.entries(contributions.storage)
        .filter(([, data]) => data.storedCids && data.storedCids.length > 0);
      
      if (agentsWithStorage.length === 0) {
        return NextResponse.json({
          message: 'No agents with storage to challenge',
          challenged: 0,
        });
      }
      
      // Select random agents (up to count)
      const selectedAgents = agentsWithStorage
        .sort(() => Math.random() - 0.5)
        .slice(0, count);
      
      const challenges: Array<{ agentId: string; challengeId: string; cid: string }> = [];
      const now = new Date();
      
      for (const [agentId, data] of selectedAgents) {
        // Check pending limit
        const pendingCount = registry.challenges.filter(
          c => c.agentId === agentId && c.status === 'pending'
        ).length;
        
        if (pendingCount >= MAX_PENDING_PER_AGENT) continue;
        
        // Select random CID
        const cid = data.storedCids[Math.floor(Math.random() * data.storedCids.length)];
        
        // Create challenge
        const challenge: StorageChallenge = {
          id: randomBytes(16).toString('hex'),
          agentId,
          cid,
          nonce: randomBytes(32).toString('hex'),
          issuedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString(),
          status: 'pending',
        };
        
        registry.challenges.push(challenge);
        
        if (!registry.stats[agentId]) {
          registry.stats[agentId] = initStats(agentId);
        }
        registry.stats[agentId].totalChallenges++;
        registry.stats[agentId].lastChallenge = now.toISOString();
        registry.networkStats.totalChallenges++;
        
        challenges.push({
          agentId,
          challengeId: challenge.id,
          cid,
        });
      }
      
      await saveProofs(registry);
      
      return NextResponse.json({
        message: `Created ${challenges.length} challenges`,
        challenged: challenges.length,
        challenges,
      });
    }
    
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    
  } catch (error) {
    console.error('Failed to process proof action:', error);
    return NextResponse.json({ error: 'Failed to process proof action' }, { status: 500 });
  }
}
