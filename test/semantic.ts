/**
 * dpth.io Semantic Search Tests
 * 
 * Tests the new auto-embed and searchSimilar features.
 */

import { dpth } from '../src/dpth.js';
import { MemoryVectorAdapter } from '../src/adapter-vector.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn())
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err) => {
      console.log(`  ✗ ${name}`);
      console.log(`    ${err.message}`);
      failed++;
    });
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

// Simple mock embedding function for testing
// Uses a basic bag-of-words approach that produces similar vectors for similar text
function mockEmbedFn(text: string): Promise<number[]> {
  // Create a deterministic vector based on words
  // Words that appear in both texts will produce similar components
  const vector = new Array(384).fill(0);
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1);
  
  for (const word of words) {
    // Use multiple hash positions per word for overlap
    for (let salt = 0; salt < 5; salt++) {
      let hash = salt * 12345;
      for (let i = 0; i < word.length; i++) {
        hash = ((hash << 5) - hash) + word.charCodeAt(i);
        hash = hash & hash;
      }
      const idx = Math.abs(hash) % 384;
      vector[idx] += 1.0 / (salt + 1);  // Decreasing weight
    }
  }
  
  // Normalize to unit vector
  const mag = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
  if (mag > 0) {
    for (let i = 0; i < vector.length; i++) {
      vector[i] /= mag;
    }
  }
  
  return Promise.resolve(vector);
}

async function main() {
  console.log('\n━━━ dpth.io Semantic Search Tests ━━━\n');
  
  console.log('🔍 Semantic Search Setup');
  
  await test('embedFn enables semantic search', async () => {
    const db = dpth({ 
      adapter: new MemoryVectorAdapter(),
      embedFn: mockEmbedFn 
    });
    await db.ready();
    assert(db.entity.semanticSearchAvailable, 'semanticSearchAvailable should be true');
    await db.close();
  });
  
  await test('no embedFn means no semantic search', async () => {
    const db = dpth();
    await db.ready();
    assert(!db.entity.semanticSearchAvailable, 'semanticSearchAvailable should be false');
    await db.close();
  });
  
  console.log('\n🧬 Auto-Embedding on Resolve');
  
  await test('entities are auto-embedded on resolve', async () => {
    const db = dpth({ 
      adapter: new MemoryVectorAdapter(),
      embedFn: mockEmbedFn 
    });
    await db.ready();
    
    // Create some entities
    await db.entity.resolve({
      type: 'company',
      name: 'Acme Software Corp',
      source: 'stripe',
      externalId: 'cus_acme',
      attributes: { industry: 'SaaS', arr: 500000 }
    });
    
    await db.entity.resolve({
      type: 'company',
      name: 'TechStartup Inc',
      source: 'stripe',
      externalId: 'cus_tech',
      attributes: { industry: 'SaaS', arr: 100000 }
    });
    
    await db.entity.resolve({
      type: 'company',
      name: 'Hardware Solutions LLC',
      source: 'stripe',
      externalId: 'cus_hardware',
      attributes: { industry: 'Manufacturing', arr: 200000 }
    });
    
    // Give a moment for async embedding
    await new Promise(r => setTimeout(r, 100));
    
    // Search for software companies (use lower minScore for mock embeddings)
    const results = await db.entity.searchSimilar('software technology SaaS', { limit: 3, minScore: 0.2 });
    
    assert(results.length > 0, 'should find at least one result');
    // The SaaS companies should rank higher than the hardware company
    const names = results.map(r => r.entity.name);
    assert(
      names.includes('Acme Software Corp') || names.includes('TechStartup Inc'),
      'should find software/SaaS companies'
    );
    
    await db.close();
  });
  
  await test('searchSimilar returns scores', async () => {
    const db = dpth({ 
      adapter: new MemoryVectorAdapter(),
      embedFn: mockEmbedFn 
    });
    await db.ready();
    
    await db.entity.resolve({
      type: 'person',
      name: 'John Smith',
      source: 'github',
      externalId: 'jsmith',
      attributes: { role: 'engineer' }
    });
    
    await new Promise(r => setTimeout(r, 50));
    
    const results = await db.entity.searchSimilar('engineer developer', { limit: 1, minScore: 0.1 });
    assert(results.length === 1, 'should find one result');
    assert(typeof results[0].score === 'number', 'result should have a score');
    assert(results[0].score >= 0 && results[0].score <= 1, 'score should be between 0 and 1');
    
    await db.close();
  });
  
  await test('searchSimilar filters by type', async () => {
    const db = dpth({ 
      adapter: new MemoryVectorAdapter(),
      embedFn: mockEmbedFn 
    });
    await db.ready();
    
    await db.entity.resolve({
      type: 'company',
      name: 'SaaS Corp',
      source: 'stripe',
      externalId: 'saas1',
    });
    
    await db.entity.resolve({
      type: 'person',
      name: 'SaaS Expert',
      source: 'linkedin',
      externalId: 'expert1',
    });
    
    await new Promise(r => setTimeout(r, 50));
    
    const companies = await db.entity.searchSimilar('SaaS', { type: 'company' });
    assert(companies.every(r => r.entity.type === 'company'), 'should only return companies');
    
    const people = await db.entity.searchSimilar('SaaS', { type: 'person' });
    assert(people.every(r => r.entity.type === 'person'), 'should only return people');
    
    await db.close();
  });
  
  await test('searchSimilar respects minScore', async () => {
    const db = dpth({ 
      adapter: new MemoryVectorAdapter(),
      embedFn: mockEmbedFn 
    });
    await db.ready();
    
    await db.entity.resolve({
      type: 'company',
      name: 'Test Company',
      source: 'test',
      externalId: 'test1',
    });
    
    await new Promise(r => setTimeout(r, 50));
    
    // Very high threshold should return no results
    const highThreshold = await db.entity.searchSimilar('completely unrelated query xyz', { minScore: 0.99 });
    // Low threshold should potentially return results
    const lowThreshold = await db.entity.searchSimilar('company test', { minScore: 0.1 });
    
    assert(lowThreshold.length >= highThreshold.length, 'lower threshold should return more or equal results');
    
    await db.close();
  });
  
  console.log('\n🚫 Error Handling');
  
  await test('searchSimilar throws without embedFn', async () => {
    const db = dpth();
    await db.ready();
    
    let threw = false;
    try {
      await db.entity.searchSimilar('test query');
    } catch (err: any) {
      threw = true;
      assert(err.code === 'ADAPTER_CAPABILITY', 'should throw AdapterCapabilityError');
    }
    
    assert(threw, 'should have thrown an error');
    await db.close();
  });
  
  console.log(`\n━━━ Results: ${passed} passed, ${failed} failed ━━━\n`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
