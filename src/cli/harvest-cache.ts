/**
 * Harvest Cache — tracks processed commits and harvest state
 * 
 * Uses a simple JSON file for portability (no SQLite dependency).
 * Stored at ~/.dpth/harvest-cache.json
 */

import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const DPTH_DIR = join(homedir(), '.dpth');
const CACHE_FILE = join(DPTH_DIR, 'harvest-cache.json');

export interface HarvestState {
  // Processed commit SHAs (Set serialized as array)
  processedShas: string[];
  
  // Last harvest time per query
  lastHarvest: Record<string, string>; // query -> ISO timestamp
  
  // Aggregated signals waiting to be submitted
  pendingSignals: Record<string, number>; // "domain|context|strategy" -> count
  
  // Stats
  stats: {
    totalCommitsProcessed: number;
    totalSignalsSubmitted: number;
    lastRun: string | null;
  };
}

const DEFAULT_STATE: HarvestState = {
  processedShas: [],
  lastHarvest: {},
  pendingSignals: {},
  stats: {
    totalCommitsProcessed: 0,
    totalSignalsSubmitted: 0,
    lastRun: null,
  },
};

let cachedState: HarvestState | null = null;
let processedShaSet: Set<string> | null = null;

async function ensureDir(): Promise<void> {
  try {
    await fs.mkdir(DPTH_DIR, { recursive: true });
  } catch {
    // Already exists
  }
}

export async function loadCache(): Promise<HarvestState> {
  if (cachedState) return cachedState;
  
  await ensureDir();
  
  try {
    const data = await fs.readFile(CACHE_FILE, 'utf-8');
    cachedState = JSON.parse(data);
    processedShaSet = new Set(cachedState!.processedShas);
    return cachedState!;
  } catch {
    cachedState = { ...DEFAULT_STATE };
    processedShaSet = new Set();
    return cachedState;
  }
}

export async function saveCache(state: HarvestState): Promise<void> {
  await ensureDir();
  
  // Convert Set back to array for JSON serialization
  if (processedShaSet) {
    state.processedShas = [...processedShaSet];
  }
  
  await fs.writeFile(CACHE_FILE, JSON.stringify(state, null, 2));
  cachedState = state;
}

export function isProcessed(sha: string): boolean {
  if (!processedShaSet) {
    processedShaSet = new Set(cachedState?.processedShas || []);
  }
  return processedShaSet.has(sha);
}

export function markProcessed(sha: string): void {
  if (!processedShaSet) {
    processedShaSet = new Set(cachedState?.processedShas || []);
  }
  processedShaSet.add(sha);
}

export function addPendingSignal(domain: string, context: string, strategy: string, count: number = 1): void {
  if (!cachedState) return;
  
  const key = `${domain}|${context}|${strategy}`;
  cachedState.pendingSignals[key] = (cachedState.pendingSignals[key] || 0) + count;
}

export function getPendingSignals(): Array<{ domain: string; context: string; strategy: string; count: number }> {
  if (!cachedState) return [];
  
  return Object.entries(cachedState.pendingSignals).map(([key, count]) => {
    const [domain, context, strategy] = key.split('|');
    return { domain, context, strategy, count };
  });
}

export function clearPendingSignals(): void {
  if (cachedState) {
    cachedState.pendingSignals = {};
  }
}

export function updateStats(commitsProcessed: number, signalsSubmitted: number): void {
  if (!cachedState) return;
  
  cachedState.stats.totalCommitsProcessed += commitsProcessed;
  cachedState.stats.totalSignalsSubmitted += signalsSubmitted;
  cachedState.stats.lastRun = new Date().toISOString();
}

export function getLastHarvest(query: string): Date | null {
  if (!cachedState?.lastHarvest[query]) return null;
  return new Date(cachedState.lastHarvest[query]);
}

export function setLastHarvest(query: string): void {
  if (!cachedState) return;
  cachedState.lastHarvest[query] = new Date().toISOString();
}

export function getCacheStats(): { 
  processedCount: number; 
  pendingCount: number; 
  totalProcessed: number;
  totalSubmitted: number;
  lastRun: string | null;
} {
  return {
    processedCount: processedShaSet?.size || cachedState?.processedShas.length || 0,
    pendingCount: Object.keys(cachedState?.pendingSignals || {}).length,
    totalProcessed: cachedState?.stats.totalCommitsProcessed || 0,
    totalSubmitted: cachedState?.stats.totalSignalsSubmitted || 0,
    lastRun: cachedState?.stats.lastRun || null,
  };
}
