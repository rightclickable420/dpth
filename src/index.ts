/**
 * dpth.io — The Distributed Intelligence Layer
 * 
 * Decentralized AI inference, data intelligence, and agent coordination.
 * 
 * Core modules:
 * - Entity: Unified identity across sources with temporal history
 * - Correlation: Cross-source pattern detection and causality discovery
 * - Temporal: Time-native storage where every value has history
 * - Embed: Semantic search and similarity across all data
 * - Ingest: Data ingestion pipeline from connectors
 * - Agent SDK: Client for agents to participate in the network
 * - Fallback: Centralized inference when no agents available
 */

export * from './types.js';
export * from './storage.js';
export * from './entity.js';
export * from './correlation.js';
export * from './temporal.js';
export * from './embed.js';
export * from './agent-sdk.js';
export * from './fallback.js';
export * from './economics.js';
export * from './federation.js';
