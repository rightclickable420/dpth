/**
 * dpth.io — Experimental Modules
 * 
 * These modules implement the distributed agent network vision described
 * in PROTOCOL.md. They are functional but not yet production-ready:
 * 
 * - agent-sdk: REST client for agent registration and task management
 * - federation: Federated learning coordinator (single-process, simulated)
 * - economics: Credit system and reputation tracking (in-memory)
 * - fallback: Centralized inference routing with model registry
 * 
 * Use at your own risk. APIs may change significantly between versions.
 * 
 * @module dpth/experimental
 */

export * from './agent-sdk.js';
export * from './federation.js';
export * from './economics.js';
export * from './fallback.js';
