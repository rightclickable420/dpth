/**
 * dpth.io Temporal Storage
 * 
 * Time-native storage where every value has history.
 * Query any point in time, track changes, detect patterns.
 * 
 * This is the foundation for "what was X at time T?" queries
 * and automatic change detection.
 */

import { TemporalValue, SourceId } from './types';

// ─── Temporal Value Helpers ──────────────────────────

/**
 * Create a new temporal value
 */
export function createTemporalValue<T>(
  value: T,
  source: SourceId
): TemporalValue<T> {
  const now = new Date();
  return {
    current: value,
    history: [{
      value,
      validFrom: now,
      validTo: null,
      source,
    }],
  };
}

/**
 * Update a temporal value (closes current entry, adds new)
 */
export function updateTemporalValue<T>(
  temporal: TemporalValue<T>,
  newValue: T,
  source: SourceId
): TemporalValue<T> {
  const now = new Date();
  
  // Close current entry
  const currentEntry = temporal.history.find(h => h.validTo === null);
  if (currentEntry) {
    currentEntry.validTo = now;
  }
  
  // Add new entry
  temporal.history.push({
    value: newValue,
    validFrom: now,
    validTo: null,
    source,
  });
  
  temporal.current = newValue;
  return temporal;
}

/**
 * Get value at a specific point in time
 */
export function getValueAt<T>(
  temporal: TemporalValue<T>,
  at: Date
): T | undefined {
  const timestamp = at.getTime();
  
  for (const entry of temporal.history) {
    const from = new Date(entry.validFrom).getTime();
    const to = entry.validTo ? new Date(entry.validTo).getTime() : Date.now();
    
    if (timestamp >= from && timestamp <= to) {
      return entry.value;
    }
  }
  
  return undefined;
}

/**
 * Get all changes in a time range
 */
export function getChangesInRange<T>(
  temporal: TemporalValue<T>,
  start: Date,
  end: Date
): Array<{ value: T; changedAt: Date; source: SourceId }> {
  const startMs = start.getTime();
  const endMs = end.getTime();
  
  return temporal.history
    .filter(entry => {
      const fromMs = new Date(entry.validFrom).getTime();
      return fromMs >= startMs && fromMs <= endMs;
    })
    .map(entry => ({
      value: entry.value,
      changedAt: new Date(entry.validFrom),
      source: entry.source,
    }));
}

/**
 * Calculate how many times a value has changed
 */
export function getChangeCount<T>(temporal: TemporalValue<T>): number {
  return temporal.history.length - 1; // First entry is creation, not a change
}

/**
 * Get the most recent change
 */
export function getLastChange<T>(
  temporal: TemporalValue<T>
): { from: T; to: T; changedAt: Date; source: SourceId } | undefined {
  if (temporal.history.length < 2) return undefined;
  
  const current = temporal.history[temporal.history.length - 1];
  const previous = temporal.history[temporal.history.length - 2];
  
  return {
    from: previous.value,
    to: current.value,
    changedAt: new Date(current.validFrom),
    source: current.source,
  };
}

// ─── Time Range Types ────────────────────────────────

export type TimeGranularity = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface TimeRange {
  start: Date;
  end: Date;
  granularity?: TimeGranularity;
}

/**
 * Create a time range for "last N periods"
 */
export function lastN(n: number, granularity: TimeGranularity): TimeRange {
  const end = new Date();
  const start = new Date();
  
  switch (granularity) {
    case 'hour':
      start.setHours(start.getHours() - n);
      break;
    case 'day':
      start.setDate(start.getDate() - n);
      break;
    case 'week':
      start.setDate(start.getDate() - n * 7);
      break;
    case 'month':
      start.setMonth(start.getMonth() - n);
      break;
    case 'quarter':
      start.setMonth(start.getMonth() - n * 3);
      break;
    case 'year':
      start.setFullYear(start.getFullYear() - n);
      break;
  }
  
  return { start, end, granularity };
}

/**
 * Get period boundaries for a time range
 */
export function getPeriodBoundaries(range: TimeRange): Date[] {
  const { start, end, granularity = 'day' } = range;
  const boundaries: Date[] = [];
  
  const current = new Date(start);
  
  while (current <= end) {
    boundaries.push(new Date(current));
    
    switch (granularity) {
      case 'hour':
        current.setHours(current.getHours() + 1);
        break;
      case 'day':
        current.setDate(current.getDate() + 1);
        break;
      case 'week':
        current.setDate(current.getDate() + 7);
        break;
      case 'month':
        current.setMonth(current.getMonth() + 1);
        break;
      case 'quarter':
        current.setMonth(current.getMonth() + 3);
        break;
      case 'year':
        current.setFullYear(current.getFullYear() + 1);
        break;
    }
  }
  
  return boundaries;
}

// ─── Snapshot System ─────────────────────────────────

interface Snapshot<T> {
  id: string;
  timestamp: Date;
  data: T;
  source: SourceId;
  metadata?: Record<string, unknown>;
}

const snapshots = new Map<string, Snapshot<unknown>[]>();

/**
 * Take a snapshot of data
 */
export function takeSnapshot<T>(
  key: string,
  data: T,
  source: SourceId,
  metadata?: Record<string, unknown>
): Snapshot<T> {
  const snapshot: Snapshot<T> = {
    id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date(),
    data,
    source,
    metadata,
  };
  
  const existing = snapshots.get(key) || [];
  existing.push(snapshot as Snapshot<unknown>);
  snapshots.set(key, existing);
  
  return snapshot;
}

/**
 * Get snapshots for a key
 */
export function getSnapshots<T>(key: string): Snapshot<T>[] {
  return (snapshots.get(key) || []) as Snapshot<T>[];
}

/**
 * Get snapshot closest to a specific time
 */
export function getSnapshotAt<T>(key: string, at: Date): Snapshot<T> | undefined {
  const snaps = getSnapshots<T>(key);
  if (snaps.length === 0) return undefined;
  
  const targetMs = at.getTime();
  let closest: Snapshot<T> | undefined;
  let minDiff = Infinity;
  
  for (const snap of snaps) {
    const diff = Math.abs(snap.timestamp.getTime() - targetMs);
    if (diff < minDiff) {
      minDiff = diff;
      closest = snap;
    }
  }
  
  return closest;
}

/**
 * Compare two snapshots and return differences
 */
export function diffSnapshots<T extends Record<string, unknown>>(
  older: Snapshot<T>,
  newer: Snapshot<T>
): { added: string[]; removed: string[]; changed: string[] } {
  const olderKeys = new Set(Object.keys(older.data));
  const newerKeys = new Set(Object.keys(newer.data));
  
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  
  for (const key of newerKeys) {
    if (!olderKeys.has(key)) {
      added.push(key);
    } else if (JSON.stringify(older.data[key]) !== JSON.stringify(newer.data[key])) {
      changed.push(key);
    }
  }
  
  for (const key of olderKeys) {
    if (!newerKeys.has(key)) {
      removed.push(key);
    }
  }
  
  return { added, removed, changed };
}

/**
 * Clean up old snapshots (retention policy)
 */
export function cleanupSnapshots(
  key: string,
  maxAge: number, // in milliseconds
  maxCount?: number
): number {
  const snaps = snapshots.get(key);
  if (!snaps) return 0;
  
  const cutoff = Date.now() - maxAge;
  let removed = 0;
  
  // Remove by age
  const filtered = snaps.filter(s => {
    if (s.timestamp.getTime() < cutoff) {
      removed++;
      return false;
    }
    return true;
  });
  
  // Remove by count (keep most recent)
  if (maxCount && filtered.length > maxCount) {
    const toRemove = filtered.length - maxCount;
    filtered.splice(0, toRemove);
    removed += toRemove;
  }
  
  snapshots.set(key, filtered);
  return removed;
}

/**
 * Clear all snapshots (for testing)
 */
export function clearSnapshots(): void {
  snapshots.clear();
}
