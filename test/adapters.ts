/**
 * dpth.io Storage Adapter Tests
 * 
 * Tests the adapter interface, memory adapter, vector adapter,
 * and the global configuration system.
 */

import {
  MemoryAdapter,
  configure,
  getAdapter,
  resetAdapter,
} from '../src/storage.js';

import {
  MemoryVectorAdapter,
  VectorOverlay,
} from '../src/adapter-vector.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

async function assertThrows(fn: () => Promise<unknown>, msg: string): Promise<void> {
  try {
    await fn();
    failed++;
    console.error(`  ✗ ${msg} (did not throw)`);
  } catch {
    passed++;
    console.log(`  ✓ ${msg}`);
  }
}

// ─── Memory Adapter Tests ────────────────────────────

async function testMemoryAdapter() {
  console.log('\n🧪 Memory Adapter');
  
  const adapter = new MemoryAdapter();
  
  // Basic CRUD
  await adapter.put('users', 'u1', { name: 'Alice', age: 30 });
  const user = await adapter.get('users', 'u1') as any;
  assert(user?.name === 'Alice', 'put/get works');
  
  assert(await adapter.has('users', 'u1') === true, 'has returns true for existing key');
  assert(await adapter.has('users', 'u999') === false, 'has returns false for missing key');
  
  assert(await adapter.count('users') === 1, 'count is 1');
  
  await adapter.put('users', 'u2', { name: 'Bob', age: 25 });
  assert(await adapter.count('users') === 2, 'count is 2 after second put');
  
  // Keys
  const keys = await adapter.keys('users');
  assert(keys.length === 2 && keys.includes('u1') && keys.includes('u2'), 'keys returns all keys');
  
  // Delete
  const deleted = await adapter.delete('users', 'u1');
  assert(deleted === true, 'delete returns true');
  assert(await adapter.has('users', 'u1') === false, 'deleted key is gone');
  assert(await adapter.count('users') === 1, 'count decremented after delete');
  
  const deleteMissing = await adapter.delete('users', 'u999');
  assert(deleteMissing === false, 'delete returns false for missing key');
  
  // Query with where
  await adapter.put('items', 'i1', { type: 'book', title: 'Dune', price: 15 });
  await adapter.put('items', 'i2', { type: 'movie', title: 'Arrival', price: 20 });
  await adapter.put('items', 'i3', { type: 'book', title: '1984', price: 10 });
  
  const books = await adapter.query({
    collection: 'items',
    where: { type: 'book' },
  }) as any[];
  assert(books.length === 2, 'query with where filters correctly');
  
  // Query with compare
  const cheap = await adapter.query({
    collection: 'items',
    compare: [{ field: 'price', op: 'lte', value: 15 }],
  }) as any[];
  assert(cheap.length === 2, 'query with compare (lte) works');
  
  // Query with orderBy
  const sorted = await adapter.query({
    collection: 'items',
    orderBy: { field: 'price', direction: 'asc' },
  }) as any[];
  assert((sorted[0] as any).price === 10, 'query with orderBy asc works');
  
  // Query with limit/offset
  const paged = await adapter.query({
    collection: 'items',
    orderBy: { field: 'price', direction: 'asc' },
    limit: 1,
    offset: 1,
  }) as any[];
  assert(paged.length === 1 && (paged[0] as any).price === 15, 'query with limit/offset works');
  
  // Clear collection
  await adapter.clear('items');
  assert(await adapter.count('items') === 0, 'clear collection works');
  assert(await adapter.count('users') === 1, 'clear collection does not affect other collections');
  
  // Clear all
  await adapter.clear();
  assert(await adapter.count('users') === 0, 'clear all works');
  
  await adapter.close();
}

// ─── Vector Adapter Tests ────────────────────────────

async function testVectorAdapter() {
  console.log('\n🧪 Memory Vector Adapter');
  
  const adapter = new MemoryVectorAdapter();
  
  // Store vectors
  await adapter.putVector('embeddings', 'v1', [1, 0, 0], { label: 'x-axis' });
  await adapter.putVector('embeddings', 'v2', [0, 1, 0], { label: 'y-axis' });
  await adapter.putVector('embeddings', 'v3', [0, 0, 1], { label: 'z-axis' });
  await adapter.putVector('embeddings', 'v4', [0.9, 0.1, 0], { label: 'near-x' });
  
  // Search — should find v4 closest to v1
  const results = await adapter.searchVector('embeddings', [1, 0, 0], 3);
  assert(results.length === 3, 'searchVector returns topK results');
  assert(results[0].key === 'v1', 'exact match is first');
  assert(results[1].key === 'v4', 'near match is second');
  assert(results[0].score > 0.99, 'exact match score ~1.0');
  assert(results[1].score > 0.9, 'near match score > 0.9');
  
  // Search with minScore
  const filtered = await adapter.searchVector('embeddings', [1, 0, 0], 10, 0.9);
  assert(filtered.length === 2, 'minScore filters low-similarity results');
  
  // Dimensions
  const dims = await adapter.dimensions('embeddings');
  assert(dims === 3, 'dimensions returns correct value');
  
  // Empty collection
  const emptyDims = await adapter.dimensions('nonexistent');
  assert(emptyDims === undefined, 'dimensions returns undefined for empty collection');
  
  // Update existing vector
  await adapter.putVector('embeddings', 'v1', [0, 1, 0], { label: 'now-y' });
  const updated = await adapter.searchVector('embeddings', [0, 1, 0], 1);
  assert(updated[0].key === 'v1' || updated[0].key === 'v2', 'updated vector is searchable');
  
  // Metadata in search results
  assert(results[0].metadata?.label === 'x-axis', 'metadata returned in search results');
  
  // Also works as base KV store
  await adapter.put('config', 'setting1', { value: true });
  const setting = await adapter.get('config', 'setting1') as any;
  assert(setting?.value === true, 'base KV operations work alongside vectors');
  
  // Clear
  await adapter.clear('embeddings');
  const afterClear = await adapter.searchVector('embeddings', [1, 0, 0], 10);
  assert(afterClear.length === 0, 'clear removes vectors');
  
  await adapter.close();
}

// ─── Vector Overlay Tests ────────────────────────────

async function testVectorOverlay() {
  console.log('\n🧪 Vector Overlay (wrapping base adapter)');
  
  const base = new MemoryAdapter();
  const adapter = new VectorOverlay(base);
  
  // Base operations work through overlay
  await adapter.put('data', 'key1', { value: 'hello' });
  const val = await adapter.get('data', 'key1') as any;
  assert(val?.value === 'hello', 'base operations pass through');
  
  // Vector operations work on top
  await adapter.putVector('vecs', 'a', [1, 0, 0]);
  await adapter.putVector('vecs', 'b', [0.8, 0.2, 0]);
  
  const results = await adapter.searchVector('vecs', [1, 0, 0], 2);
  assert(results.length === 2, 'vector search works through overlay');
  assert(results[0].key === 'a', 'correct result from overlay');
  
  // Base and vector are independent collections
  assert(await adapter.count('data') === 1, 'base data intact');
  assert(await adapter.count('vecs') === 2, 'vector metadata stored in base');
  
  await adapter.close();
}

// ─── Global Configuration Tests ──────────────────────

async function testGlobalConfig() {
  console.log('\n🧪 Global Configuration');
  
  // Default is MemoryAdapter
  resetAdapter();
  const defaultAdapter = getAdapter();
  assert(defaultAdapter instanceof MemoryAdapter, 'default adapter is MemoryAdapter');
  
  // Configure with custom adapter
  const custom = new MemoryAdapter();
  configure({ adapter: custom });
  assert(getAdapter() === custom, 'configure sets custom adapter');
  
  // Reset goes back to MemoryAdapter
  resetAdapter();
  assert(getAdapter() instanceof MemoryAdapter, 'reset returns to default');
  assert(getAdapter() !== custom, 'reset creates new instance');
}

// ─── Run All ─────────────────────────────────────────

async function main() {
  console.log('━━━ dpth.io Adapter Tests ━━━');
  
  await testMemoryAdapter();
  await testVectorAdapter();
  await testVectorOverlay();
  await testGlobalConfig();
  
  console.log(`\n━━━ Results: ${passed} passed, ${failed} failed ━━━`);
  
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
