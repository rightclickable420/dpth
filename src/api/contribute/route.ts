/**
 * dpth.io Contribution API
 * 
 * Agents contribute resources to the network and track their contributions.
 * 
 * POST /api/dpth/contribute/storage - Contribute storage capacity
 * POST /api/dpth/contribute/compute - Contribute compute result
 * GET /api/dpth/contribute/stats?agentId=xxx - Get contribution stats
 */

import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs/promises';
import * as path from 'path';

// ─── Types ───────────────────────────────────────────

interface StorageContribution {
  agentId: string;
  /** CIDs this agent is storing */
  storedCids: string[];
  /** Total bytes stored */
  totalBytes: number;
  /** When contribution started */
  since: string;
  /** Last verification */
  lastVerified: string;
  /** Verification failures (for reputation) */
  verificationFailures: number;
}

interface ComputeContribution {
  agentId: string;
  /** Tasks completed */
  tasksCompleted: number;
  /** Total compute time in ms */
  totalComputeMs: number;
  /** Tasks by type */
  tasksByType: Record<string, number>;
  /** Success rate (0-1) */
  successRate: number;
  /** Average task duration in ms */
  avgDurationMs: number;
}

interface GpuContribution {
  agentId: string;
  /** GPU model name */
  gpuModel: string;
  /** VRAM in MB */
  vramMb: number;
  /** Inference tasks completed */
  inferenceTasks: number;
  /** Total GPU compute time in ms */
  totalGpuMs: number;
  /** Tokens generated (for LLM inference) */
  tokensGenerated: number;
  /** Images generated (for image models) */
  imagesGenerated: number;
  /** Embeddings computed */
  embeddingsComputed: number;
  /** Success rate (0-1) */
  successRate: number;
  /** Average tokens per second */
  avgTokensPerSecond: number;
  /** When GPU first contributed */
  since: string;
  /** Last active */
  lastActive: string;
}

interface ContributionRegistry {
  storage: Record<string, StorageContribution>;
  compute: Record<string, ComputeContribution>;
  gpu: Record<string, GpuContribution>;
  /** Network totals */
  totals: {
    storageBytes: number;
    storageCids: number;
    computeTasks: number;
    computeMs: number;
    gpuTasks: number;
    gpuMs: number;
    tokensGenerated: number;
    imagesGenerated: number;
    embeddingsComputed: number;
  };
}

// ─── Storage ─────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR || 'data';
const CONTRIBUTIONS_FILE = path.join(DATA_DIR, 'dpth', 'contributions.json');

async function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

async function loadContributions(): Promise<ContributionRegistry> {
  try {
    const data = await fs.readFile(CONTRIBUTIONS_FILE, 'utf-8');
    const loaded = JSON.parse(data);
    // Ensure gpu field exists for backwards compatibility
    if (!loaded.gpu) loaded.gpu = {};
    if (!loaded.totals.gpuTasks) loaded.totals.gpuTasks = 0;
    if (!loaded.totals.gpuMs) loaded.totals.gpuMs = 0;
    if (!loaded.totals.tokensGenerated) loaded.totals.tokensGenerated = 0;
    if (!loaded.totals.imagesGenerated) loaded.totals.imagesGenerated = 0;
    if (!loaded.totals.embeddingsComputed) loaded.totals.embeddingsComputed = 0;
    return loaded;
  } catch {
    return {
      storage: {},
      compute: {},
      gpu: {},
      totals: {
        storageBytes: 0,
        storageCids: 0,
        computeTasks: 0,
        computeMs: 0,
        gpuTasks: 0,
        gpuMs: 0,
        tokensGenerated: 0,
        imagesGenerated: 0,
        embeddingsComputed: 0,
      },
    };
  }
}

async function saveContributions(registry: ContributionRegistry): Promise<void> {
  await ensureDir(CONTRIBUTIONS_FILE);
  await fs.writeFile(CONTRIBUTIONS_FILE, JSON.stringify(registry, null, 2));
}

// ─── Handlers ────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');
    
    const registry = await loadContributions();
    
    if (agentId) {
      // Return stats for specific agent
      const storage = registry.storage[agentId];
      const compute = registry.compute[agentId];
      const gpu = registry.gpu[agentId];
      
      return NextResponse.json({
        agentId,
        storage: storage ? {
          cidsStored: storage.storedCids.length,
          bytesStored: storage.totalBytes,
          since: storage.since,
          lastVerified: storage.lastVerified,
          verificationFailures: storage.verificationFailures,
        } : null,
        compute: compute ? {
          tasksCompleted: compute.tasksCompleted,
          totalComputeMs: compute.totalComputeMs,
          tasksByType: compute.tasksByType,
          successRate: compute.successRate,
          avgDurationMs: compute.avgDurationMs,
        } : null,
        gpu: gpu ? {
          gpuModel: gpu.gpuModel,
          vramMb: gpu.vramMb,
          inferenceTasks: gpu.inferenceTasks,
          totalGpuHours: Math.round(gpu.totalGpuMs / 3600000 * 100) / 100,
          tokensGenerated: gpu.tokensGenerated,
          imagesGenerated: gpu.imagesGenerated,
          embeddingsComputed: gpu.embeddingsComputed,
          avgTokensPerSecond: Math.round(gpu.avgTokensPerSecond * 10) / 10,
          successRate: gpu.successRate,
          since: gpu.since,
          lastActive: gpu.lastActive,
        } : null,
        // Calculate contribution score (for reputation)
        score: calculateContributionScore(storage, compute, gpu),
      });
    }
    
    // Return network-wide stats
    const agentCount = new Set([
      ...Object.keys(registry.storage),
      ...Object.keys(registry.compute),
      ...Object.keys(registry.gpu),
    ]).size;
    
    // Count GPU agents and total VRAM
    const gpuAgents = Object.values(registry.gpu);
    const totalVramGb = gpuAgents.reduce((sum, g) => sum + g.vramMb, 0) / 1024;
    
    return NextResponse.json({
      network: {
        totalAgents: agentCount,
        storage: {
          totalBytes: registry.totals.storageBytes,
          totalCids: registry.totals.storageCids,
          totalMb: Math.round(registry.totals.storageBytes / 1024 / 1024 * 100) / 100,
        },
        compute: {
          totalTasks: registry.totals.computeTasks,
          totalComputeMs: registry.totals.computeMs,
          totalComputeHours: Math.round(registry.totals.computeMs / 3600000 * 100) / 100,
        },
        gpu: {
          totalGpuAgents: gpuAgents.length,
          totalVramGb: Math.round(totalVramGb * 100) / 100,
          totalGpuTasks: registry.totals.gpuTasks,
          totalGpuHours: Math.round(registry.totals.gpuMs / 3600000 * 100) / 100,
          tokensGenerated: registry.totals.tokensGenerated,
          imagesGenerated: registry.totals.imagesGenerated,
          embeddingsComputed: registry.totals.embeddingsComputed,
        },
      },
      topContributors: getTopContributors(registry),
    });
    
  } catch (error) {
    console.error('Failed to get contributions:', error);
    return NextResponse.json({ error: 'Failed to get contributions' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const body = await request.json();
    
    const registry = await loadContributions();
    
    // ─── Storage Contribution ────────────────────────
    if (type === 'storage') {
      const { agentId, cid, bytes } = body;
      
      if (!agentId || !cid || typeof bytes !== 'number') {
        return NextResponse.json(
          { error: 'Missing agentId, cid, or bytes' },
          { status: 400 }
        );
      }
      
      // Get or create agent's storage contribution
      if (!registry.storage[agentId]) {
        registry.storage[agentId] = {
          agentId,
          storedCids: [],
          totalBytes: 0,
          since: new Date().toISOString(),
          lastVerified: new Date().toISOString(),
          verificationFailures: 0,
        };
      }
      
      const contrib = registry.storage[agentId];
      
      // Add CID if not already stored
      if (!contrib.storedCids.includes(cid)) {
        contrib.storedCids.push(cid);
        contrib.totalBytes += bytes;
        registry.totals.storageBytes += bytes;
        registry.totals.storageCids++;
      }
      
      await saveContributions(registry);
      
      return NextResponse.json({
        message: 'Storage contribution recorded',
        agentId,
        totalCids: contrib.storedCids.length,
        totalBytes: contrib.totalBytes,
      });
    }
    
    // ─── Compute Contribution ────────────────────────
    if (type === 'compute') {
      const { agentId, taskType, durationMs, success } = body;
      
      if (!agentId || !taskType || typeof durationMs !== 'number') {
        return NextResponse.json(
          { error: 'Missing agentId, taskType, or durationMs' },
          { status: 400 }
        );
      }
      
      // Get or create agent's compute contribution
      if (!registry.compute[agentId]) {
        registry.compute[agentId] = {
          agentId,
          tasksCompleted: 0,
          totalComputeMs: 0,
          tasksByType: {},
          successRate: 1,
          avgDurationMs: 0,
        };
      }
      
      const contrib = registry.compute[agentId];
      
      // Update stats
      contrib.tasksCompleted++;
      contrib.totalComputeMs += durationMs;
      contrib.tasksByType[taskType] = (contrib.tasksByType[taskType] || 0) + 1;
      
      // Update success rate (rolling average)
      const successValue = success !== false ? 1 : 0;
      contrib.successRate = (contrib.successRate * (contrib.tasksCompleted - 1) + successValue) / contrib.tasksCompleted;
      
      // Update average duration
      contrib.avgDurationMs = contrib.totalComputeMs / contrib.tasksCompleted;
      
      // Update network totals
      registry.totals.computeTasks++;
      registry.totals.computeMs += durationMs;
      
      await saveContributions(registry);
      
      return NextResponse.json({
        message: 'Compute contribution recorded',
        agentId,
        tasksCompleted: contrib.tasksCompleted,
        successRate: Math.round(contrib.successRate * 100) / 100,
      });
    }
    
    // ─── GPU Contribution ─────────────────────────────
    if (type === 'gpu') {
      const { agentId, gpuModel, vramMb, taskType, durationMs, success, metrics } = body;
      
      if (!agentId || !gpuModel || typeof vramMb !== 'number' || typeof durationMs !== 'number') {
        return NextResponse.json(
          { error: 'Missing agentId, gpuModel, vramMb, or durationMs' },
          { status: 400 }
        );
      }
      
      // Get or create agent's GPU contribution
      if (!registry.gpu[agentId]) {
        registry.gpu[agentId] = {
          agentId,
          gpuModel,
          vramMb,
          inferenceTasks: 0,
          totalGpuMs: 0,
          tokensGenerated: 0,
          imagesGenerated: 0,
          embeddingsComputed: 0,
          successRate: 1,
          avgTokensPerSecond: 0,
          since: new Date().toISOString(),
          lastActive: new Date().toISOString(),
        };
      }
      
      const contrib = registry.gpu[agentId];
      
      // Update GPU model/VRAM if changed (agent upgraded hardware)
      if (vramMb > contrib.vramMb) {
        contrib.gpuModel = gpuModel;
        contrib.vramMb = vramMb;
      }
      
      // Update stats
      contrib.inferenceTasks++;
      contrib.totalGpuMs += durationMs;
      contrib.lastActive = new Date().toISOString();
      
      // Update success rate (rolling average)
      const successValue = success !== false ? 1 : 0;
      contrib.successRate = (contrib.successRate * (contrib.inferenceTasks - 1) + successValue) / contrib.inferenceTasks;
      
      // Track specific metrics
      const tokensThisTask = metrics?.tokensGenerated || 0;
      const imagesThisTask = metrics?.imagesGenerated || 0;
      const embeddingsThisTask = metrics?.embeddingsComputed || 0;
      
      contrib.tokensGenerated += tokensThisTask;
      contrib.imagesGenerated += imagesThisTask;
      contrib.embeddingsComputed += embeddingsThisTask;
      
      // Update tokens per second average
      if (tokensThisTask > 0 && durationMs > 0) {
        const tps = tokensThisTask / (durationMs / 1000);
        if (contrib.avgTokensPerSecond === 0) {
          contrib.avgTokensPerSecond = tps;
        } else {
          // Exponential moving average
          contrib.avgTokensPerSecond = contrib.avgTokensPerSecond * 0.9 + tps * 0.1;
        }
      }
      
      // Update network totals
      registry.totals.gpuTasks++;
      registry.totals.gpuMs += durationMs;
      registry.totals.tokensGenerated += tokensThisTask;
      registry.totals.imagesGenerated += imagesThisTask;
      registry.totals.embeddingsComputed += embeddingsThisTask;
      
      await saveContributions(registry);
      
      return NextResponse.json({
        message: 'GPU contribution recorded',
        agentId,
        gpuModel: contrib.gpuModel,
        vramMb: contrib.vramMb,
        inferenceTasks: contrib.inferenceTasks,
        totalGpuHours: Math.round(contrib.totalGpuMs / 3600000 * 100) / 100,
        tokensGenerated: contrib.tokensGenerated,
        avgTokensPerSecond: Math.round(contrib.avgTokensPerSecond * 10) / 10,
        successRate: Math.round(contrib.successRate * 100) / 100,
      });
    }
    
    // ─── Verify Storage ──────────────────────────────
    if (type === 'verify') {
      const { agentId, cid, success } = body;
      
      if (!agentId || !cid) {
        return NextResponse.json(
          { error: 'Missing agentId or cid' },
          { status: 400 }
        );
      }
      
      const contrib = registry.storage[agentId];
      if (!contrib) {
        return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
      }
      
      contrib.lastVerified = new Date().toISOString();
      
      if (success === false) {
        contrib.verificationFailures++;
      }
      
      await saveContributions(registry);
      
      return NextResponse.json({
        message: success ? 'Verification passed' : 'Verification failed',
        verificationFailures: contrib.verificationFailures,
      });
    }
    
    return NextResponse.json({ error: 'Invalid contribution type' }, { status: 400 });
    
  } catch (error) {
    console.error('Failed to record contribution:', error);
    return NextResponse.json({ error: 'Failed to record contribution' }, { status: 500 });
  }
}

// ─── Helpers ─────────────────────────────────────────

function calculateContributionScore(
  storage: StorageContribution | undefined,
  compute: ComputeContribution | undefined,
  gpu?: GpuContribution
): number {
  let score = 0;
  
  if (storage) {
    // Storage score: 1 point per MB, penalized for verification failures
    const storageMb = storage.totalBytes / 1024 / 1024;
    const failurePenalty = Math.pow(0.9, storage.verificationFailures);
    score += storageMb * failurePenalty;
  }
  
  if (compute) {
    // Compute score: 10 points per task, weighted by success rate
    score += compute.tasksCompleted * 10 * compute.successRate;
  }
  
  if (gpu) {
    // GPU score: Higher value contributions
    // 20 points per inference task (GPU is more valuable than CPU)
    score += gpu.inferenceTasks * 20 * gpu.successRate;
    
    // Bonus for high-VRAM GPUs (more capable)
    const vramBonus = Math.min(gpu.vramMb / 8192, 2); // Up to 2x for 16GB+ VRAM
    score *= (1 + vramBonus * 0.1);
    
    // Bonus for tokens/images generated (actual output)
    score += gpu.tokensGenerated / 1000; // 1 point per 1000 tokens
    score += gpu.imagesGenerated * 5; // 5 points per image
    score += gpu.embeddingsComputed / 100; // 1 point per 100 embeddings
  }
  
  return Math.round(score * 100) / 100;
}

type ContributorType = 'storage' | 'compute' | 'gpu' | 'mixed';

function getTopContributors(registry: ContributionRegistry): Array<{
  agentId: string;
  score: number;
  type: ContributorType;
  gpuModel?: string;
}> {
  const scores: Record<string, { score: number; types: Set<string>; gpuModel?: string }> = {};
  
  // Calculate scores for all agents
  for (const [agentId, storage] of Object.entries(registry.storage)) {
    if (!scores[agentId]) scores[agentId] = { score: 0, types: new Set() };
    scores[agentId].score += calculateContributionScore(storage, undefined, undefined);
    scores[agentId].types.add('storage');
  }
  
  for (const [agentId, compute] of Object.entries(registry.compute)) {
    if (!scores[agentId]) scores[agentId] = { score: 0, types: new Set() };
    scores[agentId].score += calculateContributionScore(undefined, compute, undefined);
    scores[agentId].types.add('compute');
  }
  
  for (const [agentId, gpu] of Object.entries(registry.gpu)) {
    if (!scores[agentId]) scores[agentId] = { score: 0, types: new Set() };
    scores[agentId].score += calculateContributionScore(undefined, undefined, gpu);
    scores[agentId].types.add('gpu');
    scores[agentId].gpuModel = gpu.gpuModel;
  }
  
  // Sort and return top 10
  return Object.entries(scores)
    .map(([agentId, data]) => {
      let type: ContributorType = 'storage';
      if (data.types.size > 1) {
        type = 'mixed';
      } else if (data.types.has('gpu')) {
        type = 'gpu';
      } else if (data.types.has('compute')) {
        type = 'compute';
      }
      
      return {
        agentId,
        score: data.score,
        type,
        gpuModel: data.gpuModel,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}
