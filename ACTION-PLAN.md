# dpth — Action Plan (Post-Review)

> Three expert reviews. One plan. Prioritized by impact on real-world adoption.
> Created 2026-02-04.

---

## The Diagnosis (TL;DR)

All three reviewers independently said the same thing:

1. **Identity crisis** — dpth is trying to be an entity resolution library, a temporal database, a correlation engine, AND a distributed AI compute network. The first three are genuinely useful. The fourth is speculative fiction committed to code, and it's actively hurting adoption.

2. **Broken fundamentals** — Dual storage (module Maps vs adapter), O(n²) entity resolution, SQLite full-table scans in JS, 5-positional-arg API, `unknown` everywhere, no error handling.

3. **Wrong positioning** — "Distributed intelligence layer" means nothing. "Match customers across APIs with one npm install" means everything.

---

## Phase 0: Triage (Day 1) ⏱️ ~2 hours

**Goal:** Quarantine the distraction. Make the library honest.

### 0.1 — Move distributed modules to `experimental/`

Move these files out of the main `src/`:
- `agent-sdk.ts` (483 lines)
- `federation.ts` (622 lines) 
- `economics.ts` (739 lines)
- `fallback.ts` (499 lines)

Into `src/experimental/` with a single barrel export. Update `index.ts` to NOT re-export them. Keep them in the package for anyone who wants them, but they're no longer front-and-center.

**Why:** These 2,343 lines (~41% of codebase) serve 0% of real users today. Every mention confuses potential adopters. The reviewers flagged "distributed" as the #1 credibility killer.

### 0.2 — Strip index.ts barrel

Current `index.ts` re-exports everything including experimental modules. Change to:
```typescript
export * from './types.js';
export * from './storage.js';
export * from './entity.js';      // standalone functions (to be refactored in Phase 1)
export * from './temporal.js';
export * from './correlation.js';
export * from './embed.js';       // keep if useful standalone
export { dpth, Dpth } from './dpth.js';
```

### 0.3 — Update package.json exports map

Remove subpath exports for experimental modules from the public API. Add `dpth/experimental` if people need them.

### 0.4 — Update README

Strip to 3 features: **entity resolution, temporal history, correlation detection**. Move agent network / federation / economics to a "Future Vision" section at the bottom, or a separate VISION.md link.

**Estimated scope reduction:** ~41% less code in the "main" library. Much cleaner story.

---

## Phase 1: Fix the Foundation (Days 2-4) ⏱️ ~8-12 hours

**Goal:** One storage model. Object args. Error handling. The basics that make it a real library.

### 1.1 — Kill the dual storage problem 🔴 CRITICAL

**Problem:** Three disconnected storage mechanisms:
1. `dpth()` class → adapter passed to constructor ✅
2. `storage.ts` → global singleton adapter (disconnected)
3. `entity.ts` / `temporal.ts` / `correlation.ts` → hardcoded `Map` objects at module scope ❌

**Fix:** Delete the standalone module-level `Map` state from `entity.ts`, `temporal.ts`, `correlation.ts`. Two options:

**Option A (Recommended): Make standalone functions take explicit adapter parameter**
```typescript
// entity.ts
export function resolveOrCreate(adapter: StorageAdapter, opts: ResolveOptions): Promise<ResolveResult>
```
This keeps them functional and composable. The `dpth()` class becomes sugar that binds them.

**Option B: Kill standalone functions entirely**
Only expose entity/temporal/correlation through the `dpth()` class. Simpler, but less composable.

Leaning Option A because it keeps tree-shaking possible and gives advanced users escape hatches.

### 1.2 — Object arguments for `resolve()` 🔴 CRITICAL

**Current (awful):**
```typescript
db.entity.resolve('person', 'John Smith', 'stripe', 'cus_123', {
  email: 'john@company.com'
});
```

**Target:**
```typescript
db.entity.resolve({
  type: 'person',
  name: 'John Smith',
  source: 'stripe',
  externalId: 'cus_123',
  email: 'john@company.com',
  attributes: { role: 'admin' },
});
```

One argument. IDE autocompletes every field. Backwards-compat: keep positional overload during 0.x, deprecation warning.

### 1.3 — Open EntityType 🟡 IMPORTANT

**Current:** Closed union `'person' | 'company' | ... | 'custom'`  
**Target:** `string` with well-known constants:
```typescript
export type EntityType = string;
export const ENTITY_TYPES = {
  person: 'person',
  company: 'company',
  product: 'product',
  // ...
} as const;
```

Every real-world user has domain-specific types (deal, ticket, invoice). Forcing `'custom'` is hostile.

### 1.4 — Error handling 🔴 CRITICAL

**Current:** Zero custom errors. Silent failures. No input validation.

**Target:**
```typescript
export class DpthError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'DpthError';
  }
}

// Usage
throw new DpthError('EMPTY_TYPE', 'entity.resolve() requires a non-empty type');
throw new DpthError('INSUFFICIENT_DATA', 'correlation.find() needs at least 10 data points, got 3');
throw new DpthError('ENTITY_NOT_FOUND', `Entity ${id} not found`);
```

Add input validation on every public method. Descriptive messages that tell you what to fix.

### 1.5 — Cross-platform crypto 🟡 IMPORTANT

**Current:** `import crypto from 'crypto'` — Node.js only. Breaks in browser/edge.

**Target:** Use Web Crypto API:
```typescript
function generateId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return 'ent_' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
```

This works in Node 19+, Deno, Bun, Cloudflare Workers, browsers. Universal.

### 1.6 — Remove global `configure()` / `getAdapter()`

If standalone functions take explicit adapter (Option A), the global singleton in `storage.ts` is dead weight. Remove `configure()`, `getAdapter()`, `resetAdapter()`. The `MemoryAdapter` class and `StorageAdapter` interface stay.

---

## Phase 2: Fix Performance (Days 5-7) ⏱️ ~8-12 hours

**Goal:** Make dpth actually work at 100K entities.

### 2.1 — SQLite: Push filtering to SQL 🔴 CRITICAL

**Current:** Load ALL rows → parse JSON → filter in JS. O(n) full-table scan for every query.

**Target:** Use `json_extract()`:
```sql
SELECT value FROM dpth_store 
WHERE collection = ? 
  AND json_extract(value, '$.type') = ?
ORDER BY json_extract(value, '$.updatedAt') DESC
LIMIT ? OFFSET ?
```

Create computed indexes:
```sql
CREATE INDEX IF NOT EXISTS idx_entity_type 
  ON dpth_store(collection, json_extract(value, '$.type'));
CREATE INDEX IF NOT EXISTS idx_entity_email 
  ON dpth_store(collection, json_extract(value, '$.attributes.email.current'));
```

This alone would be ~100x faster at 50K+ entities.

### 2.2 — Entity resolution: Add blocking indexes 🔴 CRITICAL

**Current:** O(n) scan of ALL entities per resolve. At 100K: ~30-60 seconds per resolve.

**Target:** Build inverted indexes for fast candidate narrowing:

```typescript
// Email index: exact match, O(1)
const emailIndex = new Map<string, EntityId[]>();  // email → entity IDs

// Name trigram index: fuzzy match, O(k) where k << n
const trigramIndex = new Map<string, Set<EntityId>>();  // trigram → entity IDs

// Source index already exists, just needs to be used for blocking
```

**Flow:**
1. Check email index first (exact match → instant)
2. If no email match, check name trigrams (narrow to ~50 candidates)
3. Run Levenshtein only on candidates (not all entities)

Reduces 100K scans to ~50 comparisons. Milliseconds instead of minutes.

### 2.3 — Fix SQLite transaction() 🔴 CRITICAL

**Current:** Wraps async function in synchronous SQLite transaction. Provides zero transactional guarantees.

**Target:** Either:
- Make transaction callback synchronous (match better-sqlite3's model)
- Or use WAL + IMMEDIATE transactions with retry logic for SQLITE_BUSY

### 2.4 — Correlation: Add windowing 🟡 IMPORTANT

**Current:** Unbounded growth. `metric.points.push(point)` forever. 500K points per metric after a year.

**Target:**
```typescript
// Keep last N points per metric (configurable, default 10,000)
const MAX_POINTS = options.maxPoints ?? 10_000;
if (metric.points.length > MAX_POINTS) {
  // Downsample old points to daily aggregates
  metric.points = downsampleToDaily(metric.points, MAX_POINTS);
}
```

### 2.5 — Temporal: Fix snapshot index 🟡 IMPORTANT

**Current:** Snapshot index is a JSON array that grows forever. Every new snapshot reads/writes the entire blob.

**Target:** Store snapshot index as individual rows with compound key:
```
collection: 'snapshot_by_key'
key: '{snapshotKey}:{timestamp}'
value: snapshotId
```

Use `query()` with `where` + `orderBy` for range lookups instead of loading the entire array.

### 2.6 — Add batch operations 🟡 IMPORTANT

Add to StorageAdapter interface:
```typescript
putBatch(operations: Array<{ collection: string; key: string; value: unknown }>): Promise<void>;
```

SQLite adapter wraps in a single transaction. Critical for bulk entity import.

---

## Phase 3: DX & Positioning (Days 8-10) ⏱️ ~6-8 hours

**Goal:** Make it feel like a real, polished library. Fix positioning.

### 3.1 — Rewrite landing page 🔴 CRITICAL

**Strip to essentials:**
- Hero: "Match customers across APIs. Track every change. Find hidden patterns."
- Three feature sections (entity, temporal, correlation) with code examples
- Install command + Quick Start
- Stats bar (tests, size, zero deps)
- **DELETE:** Phases section, architecture diagram, agent SDK, OpenClaw skill

**Add:**
- StackBlitz "Try it now" button (interactive playground)
- Real-world example: "Your Stripe customer is also your GitHub contributor"

### 3.2 — Rewrite README 🟡 IMPORTANT

**Lead with the problem:**
> You pull customer data from Stripe, users from Auth0, activity from GitHub. 
> Matching them requires a rats nest of SQL JOINs and email-matching scripts.
> dpth does it in one line.

**Kill all mentions of:** agent network, federated learning, credit economics, inference routing, model registry from the main README. Link to PROTOCOL.md for the vision.

### 3.3 — StackBlitz playground 🟡 IMPORTANT

Create a one-click demo that lets developers:
1. Add a "customer" from Stripe
2. Add a "user" from GitHub  
3. Watch them auto-merge
4. See the temporal history

This is the #1 missing conversion tool. Visual, interactive, zero friction.

### 3.4 — Event/hook system 🟡 IMPORTANT

```typescript
db.on('entity:merged', (event) => { ... });
db.on('entity:created', (event) => { ... });
db.on('correlation:found', (event) => { ... });
```

For a library about "discovering patterns automatically," not being able to subscribe to discoveries is a critical gap.

### 3.5 — Logging 🟢 NICE-TO-HAVE

```typescript
const db = dpth({ 
  path: './data.db',
  log: ['query', 'resolve', 'merge']  // Prisma-style
});
```

Debug logging for entity resolution decisions. "Matched 'J. Smith' to 'John Smith' (score: 0.87, matched on: email + fuzzy_name)"

---

## Phase 4: Distribution (Days 11-14) ⏱️ ~6-8 hours

**Goal:** Get dpth in front of real developers.

### 4.1 — Killer blog post

"How I resolved 50,000 customer entities across 8 APIs with one npm package"
- Real APIs (Stripe, GitHub, HubSpot)
- Real numbers, real code
- Before/after comparison
- Performance benchmarks

### 4.2 — Show HN (revised)

Lead with the problem, not the technology. Current post leads with "distributed intelligence layer" — wrong frame. New angle: "Show HN: I built a TypeScript library that auto-merges your customers across Stripe, GitHub, and HubSpot"

### 4.3 — First real connector: dpth-stripe

`npm install dpth-stripe`
```typescript
import { syncStripeCustomers } from 'dpth-stripe';
await syncStripeCustomers(db, { apiKey: process.env.STRIPE_KEY });
// → all Stripe customers are now entities with temporal history
```

Each connector is a distribution channel. Post in Stripe community, GitHub community, etc.

### 4.4 — Twitter thread (revised)

Drop "BitTorrent economics" angle entirely. New hook: "Your customers exist in 12 different SaaS tools. Here's how to merge them into one identity with 3 lines of TypeScript."

---

## What We're NOT Doing (Explicitly)

| Idea | Verdict | Why |
|------|---------|-----|
| Rename the package | ❌ Skip | Rebranding is expensive. Ship first, worry about names if it gets traction |
| Build a CLI | ❌ Later | Cool but not adoption-critical now |
| Schema-driven entities (Zod-style) | ❌ Later | Big refactor, do after v1.0 |
| Separate @dpth/* packages | ❌ Later | Premature. One package is simpler for now |
| CRDT-based entity merge | ❌ Later | Real distributed sync is 6-12 months of work |
| HNSW vector indexing | ❌ Later | Brute force is fine until 100K+ vectors |
| Web UI for exploration | ❌ Later | Build after the library has real users |

---

## Version Plan

| Version | Contains | Timeline |
|---------|----------|----------|
| **v0.4.0** | Phase 0 + Phase 1 (quarantine + foundation fixes) | Days 1-4 |
| **v0.5.0** | Phase 2 (performance) | Days 5-7 |
| **v0.6.0** | Phase 3 (DX + events) | Days 8-10 |
| **v1.0.0** | Phase 4 + stabilization (first "real" release) | Days 11-14 |

---

## Scorecard (from reviews)

| Area | Current | After Plan |
|------|---------|------------|
| API Design | B+ | A (object args, events, errors) |
| Architecture | C+ | B+ (single storage model, clean exports) |
| Storage | C- | B+ (json_extract, indexes, batch) |
| Performance | D | B (blocking indexes, windowing) |
| Security | F | C (input validation, size limits — real auth is future) |
| "Distributed" | F | N/A (quarantined, not claimed) |
| Documentation | B | A- (real-world examples, honest positioning) |
| Positioning | D | B+ ("data layer for multi-API apps") |
| Overall | C | **B+** → path to A with real-world usage data |

---

## The One-Line Summary

**Stop being a distributed AI network. Start being the best damn entity resolution library in TypeScript.**

Everything else follows from that focus.
