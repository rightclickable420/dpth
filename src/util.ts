/**
 * dpth — Internal utilities
 * 
 * Cross-platform helpers that work in Node.js, Deno, Bun, 
 * Cloudflare Workers, and browsers.
 */

/**
 * Generate a random hex string using Web Crypto API.
 * Works everywhere: Node 19+, Deno, Bun, browsers, edge runtimes.
 */
export function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a unique entity ID.
 */
export function generateEntityId(): string {
  return `ent_${randomHex(12)}`;
}

/**
 * Generate a unique snapshot ID.
 */
export function generateSnapshotId(): string {
  return `snap_${Date.now()}_${randomHex(4)}`;
}
