# dpth — DX Review (Brutally Honest)

**Reviewer perspective:** TypeScript library author, 10K+ star packages, cares about API design, DX, bundle size, ecosystem fit.

**Date:** 2026-02-04

**Verdict:** Interesting idea, premature abstraction, identity crisis. This library doesn't know if it wants to be a data infrastructure primitive or a distributed AI protocol. That indecision poisons everything downstream.

---

## 1. API Design — Is `dpth()` the Right Abstraction?

### The Good

The factory function pattern is familiar. `const db = dpth()` reads well. The sub-API namespacing (`db.entity`, `db.temporal`, `db.correlation`) is reasonable. The Quick Start in the README gets to the point.

### The Bad

**`dpth()` is doing too much.** It's an entity resolver, a temporal database, a correlation engine, and a vector search layer — bolted together behind a single factory. These are four genuinely different problem domains. Prisma doesn't ship a time-series engine. Drizzle doesn't bundle entity resolution. There's a reason for that.

The abstraction leaks immediately:

```typescript
const db = dpth();
await db.entity.resolve('person', 'John Smith', 'stripe', 'cus_123', {
  email: 'john@company.com'
});
```

That `resolve()` signature has **five positional arguments plus an options bag**. Compare to Prisma:

```typescript
await prisma.user.upsert({ where: { email: 'john@company.com' }, ... })
```

Which one would you rather type 50 times a day? The dpth call requires you to remember: type first, then name, then source ID, then external ID, then options. There's no discoverable structure. No IDE breadcrumb trail. You're memorizing a protocol, not using an API.

**The `resolve()` method is the only thing most people would use.** Entity resolution is the headline feature. But it's buried behind `db.entity.resolve()` with a confusing signature. If I'm using dpth for entity resolution, why do I also get correlation and temporal APIs I didn't ask for?

### What I'd Change

1. **Make entity resolution the primary API, not a sub-namespace.** `dpth.resolve()` not `dpth().entity.resolve()`.
2. **Object arguments everywhere.** `db.resolve({ type: 'person', name: 'John Smith', source: 'stripe', externalId: 'cus_123', email: 'john@company.com' })`. One argument. IDE autocompletes every field.
3. **Separate the concerns.** Ship `@dpth/entity`, `@dpth/temporal`, `@dpth/correlate` as separate packages with a shared storage layer. The unified `dpth()` can be a convenience wrapper, not the primary entry point.

---

## 2. Type Safety — Are the Generics Right?

### Critical Problems

**Everything is `unknown` under the hood.** The `StorageAdapter` interface returns `Promise<unknown>` from `get()` and `query()`. Every consumer casts:

```typescript
const entity = await this.adapter.get('entities', id) as Entity | undefined;
```

This is a type-safety massacre. You're not getting TypeScript's help — you're fighting it. Every `as` cast is a runtime error waiting to happen.

**`EntityType` is a closed union with `'custom'` as an escape hatch.**

```typescript
export type EntityType = 'person' | 'company' | 'product' | ... | 'custom';
```

So every real-world user who has `'deal'`, `'ticket'`, `'invoice'` entities will use `'custom'` for everything? Or they'll cast to `string as EntityType`? This should be `string` with well-known values as constants, or it should be generic.

**`TemporalValue<unknown>` in `Entity.attributes`.** The entity attributes are `Record<string, TemporalValue<unknown>>`. There's no way to type-safely access `entity.attributes.email` — you always get `unknown` back. Compare to Zod where the output type flows from the schema. Here, schema doesn't exist.

**Snapshot generics are hollow.** `snapshot<T>()` accepts a generic `T` but the storage layer immediately erases it to `unknown`. When you read it back with `history<T>()`, you're just casting. The generic gives false confidence.

```typescript
// This looks type-safe but isn't — there's no runtime or compile-time
// guarantee that what comes out matches T
const history = await db.temporal.history<DashboardData>('dashboard');
```

### What I'd Change

1. **Typed collections.** The storage adapter should be generic: `adapter.get<Entity>('entities', id): Promise<Entity | undefined>`. Use a schema registry or generic parameter at construction time.
2. **Open `EntityType`.** Make it `string` and provide constants: `export const ENTITY_TYPES = { person: 'person', company: 'company' } as const`.
3. **Type-safe entity schemas.** Let users define their entity shapes: `dpth<{ person: { email: string, role: string }, company: { domain: string } }>()`. This is table stakes in 2026 TypeScript.

---

## 3. The Dual API Problem

This is the most confusing part of the library.

### The Situation

- `import { dpth } from 'dpth/dpth'` — unified API with `db.entity.resolve()`
- `import { resolveOrCreate } from 'dpth/entity'` — standalone functions with module-level `Map` state
- `import { configure } from 'dpth/storage'` — global adapter configuration for standalone modules
- `import * from 'dpth'` (barrel) — re-exports everything including standalone functions

### Why This Is Terrible

1. **Two different state models.** The unified API (`dpth()`) creates instances with their own adapter. The standalone modules (`entity.ts`, `temporal.ts`, `correlation.ts`) use **module-level global `Map` objects**. These are completely disconnected. If I use `dpth()` to resolve an entity, then import `findEntityBySource` from `dpth/entity`, it sees nothing — different storage.

2. **The global `configure()` is for... what?** There's a `configure({ adapter })` in `storage.ts` that sets a global adapter. But the standalone modules in `entity.ts` and `temporal.ts` don't even use it — they have their own `const entities = new Map<EntityId, Entity>()` at module scope. So `configure()` exists but doesn't configure the things you'd expect.

3. **Which import should I use?** The README shows `import { dpth } from 'dpth/dpth'`. The barrel export `dpth` gives you everything. The subpath `dpth/entity` gives standalone functions. There's no guidance on when to use what. A new user will try all three and get confused when they don't share state.

4. **The entity module duplicates the class.** `entity.ts` exports `resolveOrCreate()`, `mergeEntities()`, `findMatches()` — all stateful functions using module-level Maps. The `Dpth` class in `dpth.ts` has `EntityAPI` which reimplements all the same logic against the adapter. Why do both exist?

### What I'd Change

**Kill the standalone modules or kill the class. Pick one.**

If the unified `dpth()` API is the future, delete the standalone stateful functions. They're a trap. If the standalone functions are the future (composable, functional), delete the class and make the functions accept a storage parameter.

The only defensible architecture: standalone pure functions that take explicit dependencies, with `dpth()` as sugar that binds them to a shared adapter.

---

## 4. Bundle / Tree-Shaking

### What Works

- `"sideEffects": false` in package.json ✓
- Subpath exports in `exports` map ✓
- ESM-only (`"type": "module"`) ✓
- These are the right signals for bundlers.

### What Doesn't

**The barrel export (`dpth` / index.ts) kills tree-shaking.**

```typescript
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
```

`import { resolveOrCreate } from 'dpth'` pulls in the agent SDK, federation protocol, economics system, and fallback inference. Even with tree-shaking, the module-level side effects (those global `Map` instances) mean bundlers may not be able to eliminate them. This is the classic "barrel file anti-pattern" that Next.js explicitly warns against.

**Module-level state is a side effect.** Every standalone module (`entity.ts`, `temporal.ts`, `correlation.ts`) creates `Map` instances at import time:

```typescript
const entities = new Map<EntityId, Entity>();
const sourceIndex = new Map<string, EntityId>();
```

This isn't `sideEffects: false` in practice — it's module-level mutable state that persists across imports. Bundlers can't safely tree-shake these.

**`crypto` import at the top of `dpth.ts`.** `import crypto from 'crypto'` — this is a Node.js built-in. If anyone tries to use dpth in a browser or edge runtime, this is the first thing that blows up. And it's used only for `crypto.randomBytes()` which could be `crypto.getRandomValues()` (Web Crypto API) for cross-platform compatibility.

### What I'd Change

1. **Delete the barrel export** or make it import only types. Direct users to subpath imports.
2. **No module-level mutable state.** All state lives in instances. This is non-negotiable for a library.
3. **Use Web Crypto API** (`globalThis.crypto.randomUUID()` or `crypto.getRandomValues()`) for cross-platform compat.

---

## 5. Naming

### "dpth" — Is It a Good Package Name?

**No.** Here's why:

1. **Unpronounceable.** Is it "depth"? "D-P-T-H"? In a conversation: "Hey, we should use dpth for—" "Use what?" Every mention requires explanation. Compare: Prisma, Drizzle, Zod, tRPC — all speakable. This matters more than people think. Word of mouth is how libraries spread.

2. **Unsearchable.** Google "dpth javascript" — you'll get "depth" results, spelling corrections, and noise. SEO is a real adoption factor. "Did you mean: depth?"

3. **Unclear what it means.** Even if it's "depth", depth of what? It doesn't evoke data, entities, resolution, time series, or intelligence. Compare: "Drizzle" doesn't mean ORM either, but it's memorable and unique. "dpth" is neither.

4. **The `.io` dependency.** The brand is "dpth.io" but the npm package is "dpth". So the domain carries the pronunciation aid, but npm and imports don't. `import { dpth } from 'dpth/dpth'` — say that out loud. "Import d-p-t-h from d-p-t-h slash d-p-t-h."

### Terminology

- **"Entity resolution"** — correct industry term. Good.
- **"Temporal"** — overloaded. Temporal.io is a major workflow platform. Using "temporal" for your time-series module creates confusion: "Are you using Temporal?" "No, the temporal module from dpth." Every time.
- **"Correlation"** — fine, but "track" and "find" are too generic. `db.correlation.track('mrr', 50000)` — "track" what? A metric? A datapoint? An observation?
- **"Resolve"** — good verb for entity resolution.
- **"Snapshot"** — good metaphor for temporal data capture.

---

## 6. Onboarding — 5 Minutes to Useful Code?

### The Path

1. `npm install dpth` — fine, zero deps ✓
2. Read README → Quick Start shows 3 features in one block ✓
3. Copy-paste the example... and it works (in-memory) ✓

### The Problem

**The example works but doesn't do anything useful.** After running the Quick Start, what do I have? Entities in memory that vanish when the process exits. Correlations that need 10+ data points. Snapshots with no way to query them meaningfully.

**There's no "aha" moment.** Compare to:
- **Zod:** `z.string().email().parse(input)` — immediately useful, immediate type safety
- **tRPC:** define a procedure, call it type-safe from the client — immediate wow
- **Prisma:** `prisma.user.findMany()` — immediate data access with full types

With dpth, the "aha" is supposed to be "it merged John Smith and jsmith automatically!" But that requires setting up two data sources, feeding them in, and checking the result. It's a 10-minute setup for a 1-second payoff. And the payoff is... a merged entity object? What do I do with it?

**The persistence story is weak.** "In-memory by default (great for testing, serverless, scripts)" — but most users need persistence immediately. Making them install `better-sqlite3` and configure an adapter before they have a usable system adds friction. And the README shows this as a separate section, not part of the Quick Start.

### What I'd Change

1. **Start with a real use case.** "You have users in Stripe, GitHub, and Slack. Here's how dpth merges them into one identity in 3 lines."
2. **Persist by default.** Use `node:fs` to write JSON if SQLite isn't available. Zero-config persistence > zero-config amnesia.
3. **Show the query.** After merging entities, show `db.entity.findBySource('stripe', 'cus_123')` returning the merged result. Show the before/after. Show what changes when you add temporal snapshots.

---

## 7. What's Missing

### Error Handling — Grade: F

There is essentially none.

```typescript
// What happens if I pass an empty string as entityType?
await db.entity.resolve('', '', '', '');  // Silently creates garbage

// What if storage adapter throws?
// Nothing catches it. Raw promise rejection.

// What if correlation.find() is called with a metric that has 3 data points?
// Returns empty array. No warning. User wonders why.
```

No custom error classes. No error codes. No validation. No helpful messages. When something goes wrong, the user gets a raw `TypeError` or silent empty results. Compare to Prisma's `PrismaClientKnownRequestError` with error codes and suggestions.

**Minimum needed:**
- `DpthError` base class with `code` field
- Input validation on every public method
- Descriptive error messages: "correlation.find() requires at least 10 data points for metric 'mrr', got 3"

### Logging — Grade: F

One `console.warn` in the entire codebase:

```typescript
console.warn('dpth: better-sqlite3 not installed, using in-memory storage');
```

No debug logging. No way to see what's happening. When entity resolution makes a bad merge, there's no log trail to debug it. Compare to Prisma's `log: ['query', 'info', 'warn', 'error']` option.

### Events / Hooks — Grade: F

No event emitter. No lifecycle hooks. No middleware. I can't:
- Get notified when entities merge
- Hook into correlation discovery
- Add custom matching logic to entity resolution
- Audit who changed what

For a library that "discovers patterns automatically," the inability to subscribe to those discoveries is a critical missing feature.

### Middleware / Plugins — Grade: F

No plugin system. The `StorageAdapter` interface is the only extension point. I can't:
- Add custom entity matchers (phonetic matching, domain-specific rules)
- Transform data on ingest
- Add validation rules
- Integrate with external services on events

### Testing Utilities — Grade: D

The library ships test files but no testing helpers for users. No mock adapters designed for test use. No `dpth.testing.createMemoryInstance()` with seeded data. No snapshot testing helpers.

---

## 8. Comparison to Best-in-Class DX

### vs. Prisma

Prisma's killer DX feature: **the schema is the source of truth.** You write `model User { email String @unique }` and get generated TypeScript types, migrations, a query builder, and Studio. Everything flows from one declaration.

dpth has no schema. Entity types are a hardcoded string union. Attributes are `Record<string, unknown>`. You get zero type safety on the data that matters most — the actual entity attributes your business cares about.

**Lesson:** Schema-driven development > schemaless APIs for TypeScript users. Even if the storage is schemaless, the API should be typed.

### vs. Drizzle

Drizzle's DX win: **SQL-like API with TypeScript types.** `db.select().from(users).where(eq(users.email, 'x'))` — you know SQL, you know Drizzle. Zero new concepts.

dpth invents new concepts (entity resolution, temporal values, correlation tracking) but doesn't invest in making them feel natural. `db.entity.resolve('person', 'John Smith', 'stripe', 'cus_123')` is not a pattern from any existing tool. Every call requires reading docs.

**Lesson:** Map to existing mental models. Entity resolution could feel like an upsert. Temporal history could feel like git log. Correlation could feel like a SQL query.

### vs. Zod

Zod's DX win: **chainable, composable, inference-powered.** `z.object({ name: z.string() }).parse(data)` gives you a validated, typed object. The type flows from the schema. No casts, no `as`, no `unknown`.

dpth's type story is the opposite: `unknown` in, `as` cast out. Every storage interaction discards types. Building dpth on a Zod-like schema system would immediately fix the type safety problem AND give users validation for free.

**Lesson:** Schema → Type inference → Runtime validation. This is the modern TypeScript playbook. dpth skips all three.

### vs. tRPC

tRPC's DX win: **end-to-end type safety from definition to consumption.** Define a procedure once, consume it type-safe everywhere. Zero code generation, zero `as` casts.

dpth could learn from this: define entity types once, get type-safe resolution, type-safe attribute access, type-safe temporal queries everywhere.

**Lesson:** Type inference should flow end-to-end. If I tell dpth that a "person" entity has "email" and "role" attributes, I should never have to cast `entity.attributes['email']?.current as string`.

---

## Summary — Top 10 Changes (Priority Order)

1. **Kill the dual API.** One state model. Instance-based, not module-level globals.
2. **Object arguments for `resolve()`.** One object, not 5 positional args.
3. **Schema-driven entities.** Let users define entity shapes, get type inference.
4. **Custom error classes and input validation.** Stop silently swallowing garbage.
5. **Pick a pronounceable name.** Seriously. This matters.
6. **Don't re-export the universe from index.ts.** Subpath imports only.
7. **Events / hooks on entity merge, correlation discovery, anomaly detection.**
8. **Cross-platform crypto.** Use Web Crypto API, not Node.js `crypto`.
9. **Delete module-level mutable state.** Breaks SSR, breaks testing, breaks everything.
10. **Separate the agent network from the data library.** These are different products for different audiences. Ship them separately.

---

## The Core Question

dpth is trying to be three things:
1. An entity resolution library (valuable, underserved market)
2. A temporal data store (interesting but niche)
3. A distributed AI agent protocol (completely different product)

Trying to be all three means being none of them well. **Pick one. Make it excellent. Then expand.**

If I were forking this tomorrow, I'd take the entity resolution code, give it a real name, add schema-driven types, object-style API, events, and proper error handling. Ship it as a 5KB package that does one thing perfectly. That's a library I'd actually npm install.

Right now, dpth is a prototype wearing a library's clothes. The ideas are there. The execution needs a rewrite.
