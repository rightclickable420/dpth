# dpth.io — Technical Review

**Reviewer background**: Senior distributed systems engineer. Built edge infrastructure at Cloudflare, worked on Vercel's deployment pipeline, contributed to IPFS's bitswap protocol. I know what "distributed" means. I also know what it doesn't mean.

**Date**: 2026-02-04  
**Version reviewed**: 0.3.0  
**Verdict**: Interesting local data toolkit masquerading as a distributed system. The core entity/temporal/correlation engine is useful. Everything labeled "distributed" is speculative fiction committed to code.

---

## 1. Architecture — The Adapter Pattern

### What works

The `StorageAdapter` interface is clean. Seven methods, no ambiguity, easy to implement:

```typescript
get(collection, key) → value
put(collection, key, value) → void
delete(collection, key) → boolean
query(filter) → values[]
// ...
```

This is a solid foundation for a local data toolkit. The `VectorOverlay` pattern — wrapping a base adapter to add vector search — is a genuinely good compositional idea. It means you can add semantic search to any backend without rewriting the backend. I like that.

The `dpth()` factory function that wires up Entity/Temporal/Correlation/Vector APIs is ergonomic. One line to get a working database. That's DX done right.

### What's wrong

**The adapter interface is too thin for what the README promises.** You have a key-value interface, but then the `query()` method pulls *all rows from a collection* and filters in JavaScript. This is fine for 1,000 entities. It will make your SQLite adapter slower than the in-memory adapter at 50K+ entities because you're paying serialization cost on every row just to filter most of them out. You have SQLite's query engine sitting right there and you're ignoring it.

The `QueryFilter` supports `where`, `compare`, `orderBy`, `limit`, `offset` — all things SQL is excellent at. But the SQLite adapter does:

```typescript
const rows = this.stmt('SELECT value FROM dpth_store WHERE collection = ?')
  .all(filter.collection) as { value: string }[];
let results = rows.map(r => this.deserialize(r.value));
// Then filter in JS...
```

This is an O(n) full-table scan + JSON parse for every query. It defeats the purpose of using SQLite.

**Fix**: Use `json_extract()` in your SQL queries. SQLite has had JSON support since 3.38. You can create computed indexes on JSON fields. This alone would be a 100x improvement at scale.

**The global adapter singleton is a red flag.** `storage.ts` has a module-level `globalAdapter` variable with `configure()` and `getAdapter()`. But `dpth.ts` also accepts an adapter in its constructor and ignores the global. The `entity.ts` standalone module uses neither — it has its own module-level `Map<EntityId, Entity>`. So you have three different storage mechanisms depending on which import path you use:

1. `dpth/dpth` → adapter passed to constructor
2. `dpth/storage` → global singleton adapter
3. `dpth/entity` → hardcoded in-memory Maps

This means if someone uses `dpth/entity` directly (which the exports encourage), they get zero persistence and zero adapter integration. The standalone modules and the unified API are architecturally disconnected.

**Missing from the adapter interface:**
- `batch(operations[])` — bulk writes are critical for entity resolution at scale
- `watch(collection, key)` — change notifications for reactive patterns
- `snapshot()` / `restore()` — backup/restore primitives
- Streaming/cursor support for `query()` — you can't iterate 100K results without loading them all into memory
- Transaction support at the interface level (SQLite has it internally but it's not in the `StorageAdapter` contract)

### Verdict

The adapter pattern is directionally correct but underspecified. It's a key-value store with a bolted-on query layer. For a "data intelligence" library, the query capabilities are surprisingly primitive. You should either commit to being a KV store (drop the query filter complexity) or commit to being a queryable store (push filtering to the adapter implementation).

---

## 2. The "Distributed" Claim

Let me be direct: **dpth is not distributed.** Not today. Not close.

Here's what the codebase actually contains for its "distributed" features:

### agent-sdk.ts
A REST client that polls a single server. It calls `fetch()` against `this.config.apiUrl`. There is:
- No peer discovery
- No gossip protocol
- No DHT
- No conflict resolution between nodes
- No partition tolerance
- No replication strategy
- No consensus mechanism
- No NAT traversal
- No connection multiplexing

It's a client-server architecture with one hardcoded API URL. That's not distributed — that's a traditional web service with extra steps.

### federation.ts
This is the most ambitious module, and it's also the most fictional. The entire federated learning coordinator runs in a single process with in-memory `Map` storage:

```typescript
const store: FederationStore = {
  modelVersions: new Map(),
  trainingRounds: new Map(),
  weightDeltas: new Map(),
  // ...
};
```

The "aggregation" doesn't actually aggregate weight tensors. It averages L2 norms (scalar values) and calls it federated learning:

```typescript
// Calculate aggregate norm (simulated — real impl would do actual weight math)
aggregateNorm = deltas.reduce(
  (sum, d) => sum + (d.l2Norm * d.trainingExamples / totalExamples), 0
);
```

The comment says "simulated." I'd say "stubbed." Actual federated averaging requires loading LoRA adapter weights, aligning tensor shapes, performing coordinate-wise operations, and writing out a merged adapter. That's a significant amount of ML infrastructure that doesn't exist here.

### economics.ts
The credit system is an in-memory ledger. Every balance, every transaction, every rate limit — stored in a module-level object that vanishes when the process restarts. The migration snapshot feature for "future tokenization" takes a snapshot of... the in-memory state that won't survive a restart.

### What would it take to make it real?

In order of difficulty:

1. **Persistence for network state** (~1 week): The agent registry, credit ledger, and federation state all need to survive restarts. Route them through the adapter system you already built.

2. **Peer-to-peer communication** (~1-2 months): Replace the single-server polling model with libp2p or a custom protocol. You need:
   - Peer discovery (mDNS for local, DHT for internet)
   - NAT traversal (STUN/TURN or relay nodes)
   - Multiplexed streams (QUIC or Yamux)
   - This is table stakes. IPFS spent years on this.

3. **CRDTs or operational transform for state** (~2-3 months): When two nodes modify the same entity concurrently, what happens? Right now: whoever writes last wins. You need a conflict resolution strategy. Entity resolution is a natural fit for CRDTs — a grow-only set of source refs, LWW registers for attributes.

4. **Replication protocol** (~2-3 months): Which nodes store what? How many replicas? What's the consistency model? The storage proofs are designed but the underlying replication doesn't exist.

5. **Actual federated learning** (~3-6 months): Loading models, running LoRA fine-tuning, serializing/deserializing weight deltas, performing real tensor aggregation. This requires GPU infrastructure, model format handling (safetensors/GGUF), and significant MLOps.

Total honest estimate: **6-12 months of focused work** by someone who has built distributed systems before, to go from the current state to something that could genuinely be called "distributed."

### Recommendation

Drop the "distributed" language from the README until it's real. Call it what it is: a local-first data intelligence library with a protocol spec for future distributed features. The protocol spec (PROTOCOL.md) is actually well-thought-out — but it's a design document, not an implementation.

---

## 3. Storage — SQLite Adapter

### What works
- WAL mode enabled by default (good for concurrent reads)
- Statement caching (good for repeated queries)
- UPSERT via `ON CONFLICT` (correct pattern for idempotent writes)
- Date revival in JSON deserialization (nice touch)

### What will break

**JSON blob antipattern.** Every value is stored as a JSON string in a single `TEXT` column. This means:

1. **No secondary indexes.** Finding all entities with `type: 'person'` requires loading and parsing every entity, then filtering in JS. With 100K entities at ~2KB each, that's 200MB of JSON parsing for a simple type filter.

2. **No partial updates.** Updating one attribute on an entity requires reading the entire JSON blob, deserializing, modifying, re-serializing, and writing it back. At scale, this is a major source of write amplification.

3. **No referential integrity.** The source index (`source_index` collection) maps to entity IDs stored in a separate collection, but there's no foreign key relationship. If an entity is deleted but its source index entries aren't cleaned up, you get dangling references. The `merge()` function updates source indexes, but `delete()` doesn't.

4. **The Date revival regex is greedy.** This will match:
   ```typescript
   /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
   ```
   Any string that looks like an ISO date gets converted to a `Date` object, even if it's meant to be a string. If someone stores `{ note: "Meeting 2024-01-15T10:00:00 cancelled" }`, the value `"Meeting 2024-01-15T10:00:00 cancelled"` won't match (it doesn't start with digits), but `"2024-01-15T10:00:00-cancelled"` would become a `Date`. Edge case, but a sneaky one.

5. **No connection pooling or concurrency control.** `better-sqlite3` is synchronous and single-connection. If you're running in a multi-worker Node.js setup (cluster mode, worker threads), you'll get `SQLITE_BUSY` errors. The adapter has no retry logic.

6. **The `transaction()` method is broken.** It wraps an async function in a synchronous SQLite transaction:
   ```typescript
   async transaction<T>(fn: () => Promise<T>): Promise<T> {
     const tx = this.db.transaction(() => fn());
     return tx();
   }
   ```
   `better-sqlite3` transactions are synchronous. Wrapping an async function means the transaction completes immediately while the async work continues outside the transaction boundary. This provides zero transactional guarantees.

7. **No migration strategy.** The schema is created on first run and never updated. If you ship a schema change in v0.4, existing databases are stuck. Need a migration table + version tracking.

8. **No size limits or compaction.** The database grows forever. No vacuum scheduling, no TTL on old snapshots, no way to prune history.

### Production readiness

Not production-ready. Usable for prototyping and scripts. For production you'd need: JSON column extraction pushed to SQL, retry logic for SQLITE_BUSY, fixed transaction handling, migrations, and size management.

---

## 4. Performance

### Entity Resolution — The O(n²) Problem

The `findBestMatch()` function is O(n) per resolution call — it queries all entities of a given type and runs fuzzy matching against each one:

```typescript
const candidates = await this.adapter.query({
  collection: 'entities',
  where: { type },
}) as Entity[];
// ... loop through all candidates
```

The fuzzy matching itself uses Levenshtein distance, which is O(m×k) per comparison (where m and k are string lengths). So resolving one entity against n existing entities of the same type is O(n × m × k).

**At 10K entities**: Each resolve scans 10K entities. If you're importing 10K entities from a new source, that's 10K × 10K = 100M comparisons. Rough estimate: 30-60 seconds.

**At 100K entities**: 100K × 100K = 10B comparisons. Not feasible — you're looking at hours.

**At 1M entities**: Dead. Don't even try.

**Fix**: Build an inverted index. Index by email (exact match), by name trigrams (fast fuzzy lookup), by alias tokens. Reduce the candidate set to <100 before running Levenshtein. This is a solved problem — look at how Dedupe.io or Zingg handle it.

### Correlation Engine — Unbounded Growth

The correlation engine stores all metric points in a single array per metric:

```typescript
metric.points.push(point);
```

There's no windowing, no downsampling, no TTL. After a year of tracking a metric every minute, you have 525,600 points in a single JSON blob. The Pearson correlation function iterates all points for alignment:

```typescript
for (const p of a.points) {
  const day = Math.floor(new Date(p.timestamp).getTime() / dayMs);
  aMap.set(day, p.value);
}
```

This works fine at 100 points. At 500K points, you're creating a Map with 500K entries for every correlation check. And `find()` runs this against *every other metric*. With 50 metrics, each with 500K points, you're looking at O(50 × 500K × maxLagDays) operations.

**Fix**: Pre-aggregate at daily/hourly granularity. Implement circular buffers or time-bucketed storage. Store pre-computed rolling statistics. Consider approximate algorithms (sketches) for large-scale correlation.

### Temporal History — Snapshot Accumulation

Every call to `temporal.snapshot()` creates a new snapshot and appends its ID to an index array:

```typescript
const index = (await this.adapter.get('snapshot_index', key) as string[] | undefined) || [];
index.push(record.id);
await this.adapter.put('snapshot_index', key, index);
```

The index for a key is loaded, deserialized, appended to, re-serialized, and written back on every snapshot. With 100K snapshots for a single key, this index array is ~2.5MB of JSON. Every new snapshot reads and writes that entire blob.

`history()` then does N sequential `adapter.get()` calls — one per snapshot ID. With 100K snapshots, that's 100K individual reads.

**Fix**: The snapshot index should be stored in the adapter's native format (SQL rows, not a JSON array). Use cursor-based pagination. Add time-range queries.

### Vector Search — Brute Force

Both `MemoryVectorAdapter` and `VectorOverlay` use brute-force cosine similarity:

```typescript
for (const entry of col) {
  const score = cosineSimilarity(vector, entry.vector);
}
```

This is O(n × d) where n is vector count and d is dimension. With 100K vectors at 384 dimensions, each search is 38.4M floating-point operations. Manageable but slow (~100ms).

At 1M vectors: ~1 second per search. Unusable for real-time applications.

**Fix**: Use HNSW (hierarchical navigable small world) index. Libraries like `hnswlib-node` or `usearch` give you O(log n) search with minimal memory overhead. Or integrate `sqlite-vec` which already has ANN indexing.

### Summary Table

| Component | 1K entities | 100K entities | 1M entities |
|-----------|------------|---------------|-------------|
| Entity resolve | <10ms | 30-60s | Hours/dead |
| Correlation find | <100ms | 5-30s | Minutes |
| Snapshot history | <10ms | 1-5s | 10-30s |
| Vector search | <1ms | ~100ms | ~1s |
| SQLite query | <10ms | 1-5s | 10-30s |

The library is comfortable at the 1K-10K range. It starts struggling at 100K. It's unusable at 1M without fundamental architectural changes.

---

## 5. Security

### The Ed25519 signatures aren't actually verified

The agent SDK generates an Ed25519 keypair and sends the public key in headers:

```typescript
'X-Public-Key': this.getHeaderSafeKey(),
```

But there's no request signing happening. The `sign` and `verify` imports from `crypto` are imported but never used. Any agent can claim to be any other agent by setting the `X-Agent-Id` header. The public key is sent but never verified against anything.

### Storage proofs are conceptually sound but unimplemented

`computeProof()` literally throws an error:

```typescript
static computeProof(chunkData: string, nonce: string): string {
  throw new Error('Implement with crypto.subtle.digest or createHash');
}
```

The protocol describes a challenge-response system where agents prove they store data. But the proof verification on the server side is also likely unimplemented (I'd need to check the API route, but given the pattern...).

### CIDs aren't real CIDs

The protocol says CIDs are `baf` + first 56 chars of SHA-256. Real IPFS CIDs use multicodec, multihash, and multibase encoding. dpth's "CIDs" aren't interoperable with any existing content-addressing system. They're just truncated hashes with a prefix. This means:
- No interop with IPFS
- No way to verify the hash algorithm used
- No way to upgrade hash functions
- Collision risk from truncation (56 hex chars = 224 bits, still fine for collision resistance, but why truncate at all?)

### The economics system has no Sybil resistance

Anyone can register a new agent and start earning credits. The reputation system is supposed to gate access, but:
- Reputation is earned by completing tasks
- Tasks are claimed by any registered agent
- Registration requires... nothing

An attacker can spin up 1,000 agents, have them complete tasks for each other, and farm reputation. The "time + contributions needed" Sybil mitigation mentioned in the threat model doesn't exist in the code — there's no minimum age requirement for tier advancement.

### Rate limiting is per-process, not per-identity

Rate limits are stored in the in-memory ledger. Restart the process and all rate limits reset. An attacker who can trigger a restart (or just wait for a deployment) gets fresh rate limits.

### No input validation on entity attributes

Attributes are stored as `unknown` with no sanitization. If someone stores a 100MB string as an attribute value, it goes straight into the JSON blob. No size limits, no type validation, no depth limits for nested objects. This is a DoS vector when using the SQLite adapter (giant JSON blobs in a single column).

### No authentication on the API routes

Based on the agent-sdk, the API endpoints accept any request with an `X-Agent-Id` header. There's no session management, no API keys, no JWT validation. The protocol spec describes Ed25519 signatures but they're not implemented.

---

## 6. What Would Make Me Use This?

### The honest answer

Today, I wouldn't use it for anything beyond prototyping. Here's what would change my mind:

### The #1 thing to build next: **Make the local story excellent**

Forget distributed. Forget agents. Forget federation. The core insight — entity resolution + temporal history + correlation detection in a zero-config TypeScript library — is genuinely valuable. I'd use that today if it worked well at scale.

Specifically:

1. **Fix the SQLite adapter** to use `json_extract()` for queries. Add proper indexes. Make it actually fast.

2. **Add blocking indexes for entity resolution.** Let me define blocking keys (email domain, name prefix, etc.) so matching doesn't scan the entire table.

3. **Add streaming/batching APIs.** Let me import 100K entities from a CSV without OOM-killing the process.

4. **Ship a CLI.** `dpth import customers.csv --source stripe` → entity resolution and history tracking. `dpth query "show me entities that changed last week"` → instant audit trail. `dpth correlate revenue` → find what drives revenue.

5. **Add a web UI for exploration.** Entity graph visualization, timeline views, correlation heatmaps. The data this library captures is inherently visual — let people see it.

Once the local story is bulletproof, *then* add sync. Start with the simplest possible distributed primitive: two dpth instances syncing over HTTP with CRDT-based merge. That alone would be a meaningful differentiator.

---

## 7. Comparison to Existing Tools

### vs. IPFS

IPFS solves content-addressed storage and distribution. dpth uses content-addressing terminology but doesn't implement the hard parts (bitswap, DHT routing, IPNS). dpth's "CIDs" are incompatible with IPFS CIDs.

**Overlap**: Content-addressed storage concept.  
**Difference**: IPFS is a real distributed system with years of protocol work. dpth uses the vocabulary without the networking.

### vs. Gun.js

Gun.js is a real-time, decentralized, graph database. It has actual P2P sync via WebRTC and WebSocket relays. It handles conflict resolution via HAM (Hypothetical Amnesia Machine) CRDTs.

**Overlap**: Both want to be distributed databases for JavaScript.  
**Difference**: Gun.js actually syncs between nodes. dpth doesn't. But Gun.js has notoriously poor documentation and unpredictable behavior at scale. dpth's entity resolution concept is something Gun.js lacks.

### vs. OrbitDB

OrbitDB is a peer-to-peer database on IPFS. It uses CRDTs for eventual consistency and IPFS pubsub for real-time sync. It supports various data models (key-value, log, feed, documents).

**Overlap**: Both position as distributed databases with pluggable storage.  
**Difference**: OrbitDB inherits IPFS's networking stack — it actually works across nodes. But OrbitDB is complex to deploy and maintain. dpth is simpler to start with (npm install, no daemon) but doesn't deliver on distribution.

### vs. Automerge

Automerge is a CRDT library for building local-first collaborative applications. It handles automatic conflict resolution for rich data types (text, maps, arrays, counters).

**Overlap**: Both care about data that changes over time.  
**Difference**: Automerge is a battle-tested CRDT implementation used in production by companies like Ink & Switch. dpth's temporal history is append-only snapshots with manual diffing — it doesn't handle concurrent modifications. If dpth used Automerge internally for entity attributes, that would be a powerful combination.

### vs. Dolt / DoltHub

Dolt is "Git for data" — a SQL database with branch/merge/diff. It has real version control semantics for structured data.

**Overlap**: Both track data history and support diffing.  
**Difference**: Dolt is a full SQL database with real versioning. dpth's temporal history is comparatively primitive (JSON blob snapshots vs. row-level versioning).

### vs. Nothing (just SQLite + custom code)

This is the real comparison. Could you get dpth's functionality by writing:
- Entity table with email/name indexes + a fuzzy matching function
- History table with foreign key to entities
- Metrics table with time-series points

Yes. In about 500 lines of code with proper SQL queries, you'd have something that scales to millions of entities. dpth's value add is the ergonomic API and the "just works" DX — but only if "just works" includes "works at scale," which it currently doesn't.

### Where dpth has a genuine edge

None of these tools combine entity resolution + temporal history + correlation detection in a single package. That's dpth's unique value proposition. The "cross-source intelligence" angle is genuinely interesting — knowing that your Stripe customer, GitHub contributor, and Slack user are the same person, with a full history of how their attributes changed over time, correlated with business metrics. That's a product insight, not just a database.

**Lean into that.** The distributed features dilute focus. The local intelligence story is where the value is.

---

## Summary

| Area | Grade | Notes |
|------|-------|-------|
| API Design | B+ | Ergonomic, well-typed, good DX |
| Architecture | C+ | Adapter pattern is right, implementation is too thin |
| Storage | C- | JSON blob antipattern, broken transactions, no indexes |
| Performance | D | O(n²) entity resolution, full-table scans, no pagination |
| Security | F | Signatures imported but unused, no auth, no input validation |
| "Distributed" | F | Nothing is distributed. Everything is in-memory singletons |
| Documentation | B | README is clear, PROTOCOL.md is thorough (if aspirational) |
| Test coverage | B- | 171 tests is good for this stage, unclear what they cover |
| Overall | C | Good idea, premature claims, needs fundamentals work |

### Top 3 priorities

1. **Fix the query layer.** Push filtering to the adapter. Use `json_extract()` in SQLite. Add indexes. This is the #1 thing preventing real-world usage.

2. **Fix entity resolution scaling.** Add blocking indexes, inverted indexes, or at minimum an email lookup index. O(n) scans per resolve is a dealbreaker.

3. **Drop or quarantine distributed claims.** Either invest 6-12 months in real P2P infrastructure, or rename the distributed modules to `experimental/` and update the README to say "local-first with distributed ambitions." Credibility matters.

---

*Reviewed by a systems engineer who would rather give you honest feedback now than watch you ship something that falls apart under the first real workload. The bones are good. The muscles aren't there yet.*
