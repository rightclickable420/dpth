/**
 * dpth — Entity resolution, temporal history, and correlation detection
 * for TypeScript. One npm install, zero dependencies.
 * 
 * Core modules:
 * - Entity: Resolve identities across data sources with fuzzy matching
 * - Temporal: Snapshot any data and track changes over time
 * - Correlation: Detect cross-source patterns in your metrics
 * - Embed: Semantic similarity and search
 * - Storage: Pluggable adapters (memory, SQLite, vector)
 * - dpth(): Unified API that wires everything together
 * 
 * Experimental modules (agent network, federation, economics) are
 * available via 'dpth/experimental' — see PROTOCOL.md for the vision.
 */

export * from './types.js';
export * from './storage.js';
export * from './errors.js';
export * from './entity.js';
export * from './correlation.js';
export * from './temporal.js';
export * from './embed.js';
export * from './router.js';
export { dpth, Dpth } from './dpth.js';
export type { DpthOptions, ResolveOptions, ResolveResult, SnapshotRecord, DiffResult, CorrelationHit } from './dpth.js';
