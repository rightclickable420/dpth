/**
 * dpth.io Network Status API
 * 
 * Returns aggregate statistics about the dpth.io network.
 * Used by the dashboard and for monitoring.
 */

import { NextResponse } from 'next/server';
import * as fs from 'fs/promises';
import * as path from 'path';

const DATA_DIR = process.env.DATA_DIR || 'data';

interface NetworkStatus {
  network: {
    name: string;
    version: string;
    uptime: string;
  };
  agents: {
    total: number;
    online: number;
    busy: number;
    totalStorageMb: number;
    totalCpuCores: number;
    gpuAgents: number;
    totalVramGb: number;
  };
  tasks: {
    pending: number;
    claimed: number;
    completedTotal: number;
    failedTotal: number;
    throughputPerHour: number;
  };
  storage: {
    totalChunks: number;
    totalMb: number;
    hotMb: number;
    warmMb: number;
    coldMb: number;
  };
  contributions: {
    storageContributors: number;
    computeContributors: number;
    gpuContributors: number;
    totalStorageContributed: number;
    totalComputeTasks: number;
    totalGpuTasks: number;
    tokensGenerated: number;
    imagesGenerated: number;
  };
  intelligence: {
    entitiesTracked: number;
    metricsTracked: number;
    correlationsFound: number;
    patternsDetected: number;
  };
}

async function loadJson(filePath: string): Promise<unknown> {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    // Load agent registry
    const agentsData = await loadJson(path.join(DATA_DIR, 'dpth', 'agents.json')) as { agents: Array<{ status: string; capabilities: { storageCapacityMb: number; cpuCores: number; hasGpu: boolean; gpuVramMb?: number } }> } | null;
    const agents = agentsData?.agents || [];
    
    // Load task queue
    const tasksData = await loadJson(path.join(DATA_DIR, 'dpth', 'tasks.json')) as { tasks: Array<{ status: string }>; stats: { totalCompleted: number; totalFailed: number } } | null;
    const tasks = tasksData?.tasks || [];
    const taskStats = tasksData?.stats || { totalCompleted: 0, totalFailed: 0 };
    
    // Load storage metadata
    const storageData = await loadJson(path.join(DATA_DIR, 'dpth', 'storage-meta.json')) as { totalChunks: number; totalBytes: number; tierStats: { hot: { bytes: number }; warm: { bytes: number }; cold: { bytes: number } } } | null;
    
    // Load contribution data
    const contributionsData = await loadJson(path.join(DATA_DIR, 'dpth', 'contributions.json')) as {
      storage: Record<string, { totalBytes: number }>;
      compute: Record<string, { tasksCompleted: number }>;
      gpu: Record<string, { inferenceTasks: number; vramMb: number }>;
      totals: {
        storageBytes: number;
        computeTasks: number;
        gpuTasks: number;
        tokensGenerated: number;
        imagesGenerated: number;
      };
    } | null;
    
    // Load entity registry
    const entitiesData = await loadJson(path.join(DATA_DIR, 'entities.json')) as { entities: unknown[] } | null;
    const entities = entitiesData?.entities || [];
    
    // Calculate agent stats
    const online = agents.filter(a => a.status === 'online');
    const busy = agents.filter(a => a.status === 'busy');
    const totalStorage = agents.reduce((sum, a) => sum + (a.capabilities?.storageCapacityMb || 0), 0);
    const totalCpu = agents.reduce((sum, a) => sum + (a.capabilities?.cpuCores || 0), 0);
    const gpuAgents = agents.filter(a => a.capabilities?.hasGpu);
    const totalVramGb = agents.reduce((sum, a) => sum + (a.capabilities?.gpuVramMb || 0), 0) / 1024;
    
    // Calculate task stats
    const pending = tasks.filter(t => t.status === 'pending');
    const claimed = tasks.filter(t => t.status === 'claimed');
    
    // Calculate storage stats
    const storageMb = storageData ? Math.round(storageData.totalBytes / 1024 / 1024 * 100) / 100 : 0;
    const hotMb = storageData?.tierStats?.hot ? Math.round(storageData.tierStats.hot.bytes / 1024 / 1024 * 100) / 100 : 0;
    const warmMb = storageData?.tierStats?.warm ? Math.round(storageData.tierStats.warm.bytes / 1024 / 1024 * 100) / 100 : 0;
    const coldMb = storageData?.tierStats?.cold ? Math.round(storageData.tierStats.cold.bytes / 1024 / 1024 * 100) / 100 : 0;
    
    // Calculate contribution stats
    const storageContributors = Object.keys(contributionsData?.storage || {}).length;
    const computeContributors = Object.keys(contributionsData?.compute || {}).length;
    const gpuContributors = Object.keys(contributionsData?.gpu || {}).length;
    
    const status: NetworkStatus = {
      network: {
        name: 'dpth.io',
        version: '0.1.0',
        uptime: process.uptime ? `${Math.floor(process.uptime() / 3600)}h` : 'unknown',
      },
      agents: {
        total: agents.length,
        online: online.length,
        busy: busy.length,
        totalStorageMb: totalStorage,
        totalCpuCores: totalCpu,
        gpuAgents: gpuAgents.length,
        totalVramGb: Math.round(totalVramGb * 100) / 100,
      },
      tasks: {
        pending: pending.length,
        claimed: claimed.length,
        completedTotal: taskStats.totalCompleted,
        failedTotal: taskStats.totalFailed,
        throughputPerHour: 0, // Would need time-series data
      },
      storage: {
        totalChunks: storageData?.totalChunks || 0,
        totalMb: storageMb,
        hotMb,
        warmMb,
        coldMb,
      },
      contributions: {
        storageContributors,
        computeContributors,
        gpuContributors,
        totalStorageContributed: Math.round((contributionsData?.totals?.storageBytes || 0) / 1024 / 1024 * 100) / 100,
        totalComputeTasks: contributionsData?.totals?.computeTasks || 0,
        totalGpuTasks: contributionsData?.totals?.gpuTasks || 0,
        tokensGenerated: contributionsData?.totals?.tokensGenerated || 0,
        imagesGenerated: contributionsData?.totals?.imagesGenerated || 0,
      },
      intelligence: {
        entitiesTracked: entities.length,
        metricsTracked: 0, // TODO: implement
        correlationsFound: 0, // TODO: implement
        patternsDetected: 0, // TODO: implement
      },
    };
    
    return NextResponse.json(status);
    
  } catch (error) {
    console.error('Failed to get network status:', error);
    return NextResponse.json({ error: 'Failed to get status' }, { status: 500 });
  }
}
