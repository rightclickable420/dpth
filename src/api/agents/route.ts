/**
 * dpth.io Agent Registration API
 * 
 * Agents join the dpth.io network to contribute resources and receive intelligence.
 * 
 * POST /api/dpth/agents - Register a new agent
 * GET /api/dpth/agents - List registered agents (admin only)
 * DELETE /api/dpth/agents/[id] - Deregister an agent
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

// ─── Types ───────────────────────────────────────────

interface AgentCapabilities {
  /** Storage capacity in MB */
  storageCapacityMb: number;
  /** CPU cores available for compute tasks */
  cpuCores: number;
  /** Has GPU for inference tasks */
  hasGpu: boolean;
  /** GPU VRAM in MB (if hasGpu) */
  gpuVramMb?: number;
  /** Supported task types */
  taskTypes: ('embed' | 'correlate' | 'extract' | 'analyze' | 'inference')[];
}

interface Agent {
  id: string;
  name: string;
  publicKey: string; // For verifying agent identity
  capabilities: AgentCapabilities;
  /** Current status */
  status: 'online' | 'offline' | 'busy';
  /** Network contribution stats */
  stats: {
    tasksCompleted: number;
    storageBytesProvided: number;
    uptimeHours: number;
    lastSeen: string;
    joined: string;
  };
  /** Reputation score (0-100) */
  reputation: number;
}

interface AgentRegistry {
  agents: Agent[];
  version: number;
}

// ─── Storage ─────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR || 'data';
const AGENTS_FILE = path.join(DATA_DIR, 'dpth', 'agents.json');

async function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

async function loadRegistry(): Promise<AgentRegistry> {
  try {
    const data = await fs.readFile(AGENTS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { agents: [], version: 1 };
  }
}

async function saveRegistry(registry: AgentRegistry): Promise<void> {
  await ensureDir(AGENTS_FILE);
  await fs.writeFile(AGENTS_FILE, JSON.stringify(registry, null, 2));
}

// ─── Handlers ────────────────────────────────────────

export async function GET() {
  try {
    const registry = await loadRegistry();
    
    // Return summary stats + online agents
    const online = registry.agents.filter(a => a.status === 'online');
    const totalStorage = registry.agents.reduce((sum, a) => sum + a.capabilities.storageCapacityMb, 0);
    const totalCpu = registry.agents.reduce((sum, a) => sum + a.capabilities.cpuCores, 0);
    const gpuAgents = registry.agents.filter(a => a.capabilities.hasGpu);
    
    return NextResponse.json({
      summary: {
        totalAgents: registry.agents.length,
        onlineAgents: online.length,
        totalStorageMb: totalStorage,
        totalCpuCores: totalCpu,
        gpuAgents: gpuAgents.length,
      },
      agents: online.map(a => ({
        id: a.id,
        name: a.name,
        capabilities: a.capabilities,
        reputation: a.reputation,
        stats: a.stats,
      })),
    });
  } catch (error) {
    console.error('Failed to list agents:', error);
    return NextResponse.json({ error: 'Failed to list agents' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, publicKey, capabilities } = body;
    
    if (!name || !publicKey || !capabilities) {
      return NextResponse.json(
        { error: 'Missing required fields: name, publicKey, capabilities' },
        { status: 400 }
      );
    }
    
    // Validate capabilities
    if (typeof capabilities.storageCapacityMb !== 'number' ||
        typeof capabilities.cpuCores !== 'number' ||
        !Array.isArray(capabilities.taskTypes)) {
      return NextResponse.json(
        { error: 'Invalid capabilities format' },
        { status: 400 }
      );
    }
    
    const registry = await loadRegistry();
    
    // Check if agent already registered (by public key)
    const existing = registry.agents.find(a => a.publicKey === publicKey);
    if (existing) {
      // Update existing agent
      existing.name = name;
      existing.capabilities = capabilities;
      existing.status = 'online';
      existing.stats.lastSeen = new Date().toISOString();
      
      await saveRegistry(registry);
      
      return NextResponse.json({
        message: 'Agent updated',
        agent: {
          id: existing.id,
          name: existing.name,
          reputation: existing.reputation,
        },
      });
    }
    
    // Create new agent
    const agent: Agent = {
      id: randomUUID(),
      name,
      publicKey,
      capabilities,
      status: 'online',
      stats: {
        tasksCompleted: 0,
        storageBytesProvided: 0,
        uptimeHours: 0,
        lastSeen: new Date().toISOString(),
        joined: new Date().toISOString(),
      },
      reputation: 50, // Start at neutral
    };
    
    registry.agents.push(agent);
    registry.version++;
    await saveRegistry(registry);
    
    return NextResponse.json({
      message: 'Agent registered',
      agent: {
        id: agent.id,
        name: agent.name,
        reputation: agent.reputation,
      },
    }, { status: 201 });
    
  } catch (error) {
    console.error('Failed to register agent:', error);
    return NextResponse.json({ error: 'Failed to register agent' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('id');
    
    if (!agentId) {
      return NextResponse.json({ error: 'Missing agent ID' }, { status: 400 });
    }
    
    const registry = await loadRegistry();
    const index = registry.agents.findIndex(a => a.id === agentId);
    
    if (index === -1) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }
    
    registry.agents.splice(index, 1);
    registry.version++;
    await saveRegistry(registry);
    
    return NextResponse.json({ message: 'Agent deregistered' });
    
  } catch (error) {
    console.error('Failed to deregister agent:', error);
    return NextResponse.json({ error: 'Failed to deregister agent' }, { status: 500 });
  }
}
