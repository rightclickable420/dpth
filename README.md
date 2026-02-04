# dpth.io

[![CI](https://github.com/rightclickable420/dpth/actions/workflows/ci.yml/badge.svg)](https://github.com/rightclickable420/dpth/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dpth)](https://www.npmjs.com/package/dpth)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**Your data is scattered. dpth connects it.**

dpth is a TypeScript library that resolves entities across APIs, detects cross-source patterns, and gives every data point a history. One `npm install`, zero dependencies, works anywhere Node runs.

## Install

```bash
npm install dpth
```

## Quick Start

```typescript
import { dpth } from 'dpth/dpth';

const db = dpth();

// Entity resolution — same person in Stripe and GitHub? Merged automatically.
await db.entity.resolve('person', 'John Smith', 'stripe', 'cus_123', {
  email: 'john@company.com'
});
await db.entity.resolve('person', 'jsmith', 'github', 'jsmith-gh', {
  email: 'john@company.com'
});
// ^ auto-merged — same entity, two sources

// Temporal history — every value has a timeline
await db.temporal.snapshot('dashboard', { revenue: 50000, users: 200 });
await db.temporal.snapshot('dashboard', { revenue: 55000, users: 220 });
const history = await db.temporal.history('dashboard');
const diff = db.temporal.diff(history[0], history[1]);
// { changed: [{ key: 'revenue', from: 50000, to: 55000 }, ...] }

// Correlation — finds patterns you'd never think to look for
await db.correlation.track('mrr', 50000);
await db.correlation.track('deploys', 12);
const patterns = await db.correlation.find('mrr');
// "deploys correlates with mrr (r=0.87, 3-day lag)"
```

## Add Persistence

```typescript
// In-memory by default (great for testing, serverless, scripts)
const db = dpth();

// Add SQLite for persistence — survives restarts
// npm install better-sqlite3
import { SQLiteAdapter } from 'dpth/adapter-sqlite';
import { configure } from 'dpth/storage';
configure({ adapter: new SQLiteAdapter('./myapp.db') });

// Add vector search — semantic similarity on top
import { VectorOverlay } from 'dpth/adapter-vector';
configure({ adapter: new VectorOverlay(new SQLiteAdapter('./myapp.db')) });
```

## What You Get

### Entity Resolution
`john@company.com` in Stripe and `jsmith` on GitHub are the same person. dpth figures that out automatically — fuzzy name matching, email matching, alias tracking, confidence scoring.

### Temporal History
Every value you store has a full timeline. Not just "revenue is $50K" but "$30K → $42K → $50K over 3 months" with automatic change detection and diffing.

### Cross-Source Correlation
Revenue went up 20% the same month commits doubled? Your biggest customer just opened 3 support tickets? dpth finds these connections across any data sources you feed it. Pearson correlation, lag detection, anomaly alerts.

### Content-Addressed Storage
SHA-256 hashed chunks. Immutable, deduplicated, cache forever. Like git for your data.

### Vector Search
Semantic similarity built in. Works with any embedding model — store vectors, search by similarity, power smarter entity matching.

### Pluggable Storage
Memory adapter (default, zero config) → SQLite adapter (persistence) → Vector overlay (semantic search). Or write your own — implement `StorageAdapter` for any backend.

## Architecture

```
┌──────────────────────────────────────────────┐
│              Your Application                 │
├──────────────────────────────────────────────┤
│                  dpth()                       │
│  entity    temporal    correlation    vector  │
├──────────────────────────────────────────────┤
│             Storage Adapter                   │
│  Memory │ SQLite │ Vector │ Custom            │
└──────────────────────────────────────────────┘
```

## Module Exports

| Import | What it does |
|--------|-------------|
| `dpth/dpth` | Unified API — `dpth()` factory, entity/temporal/correlation/vector |
| `dpth/entity` | Standalone entity resolution |
| `dpth/correlation` | Standalone correlation engine |
| `dpth/temporal` | Standalone temporal storage |
| `dpth/embed` | Embedding and similarity search |
| `dpth/storage` | Adapter interface, `MemoryAdapter`, `configure()` |
| `dpth/adapter-sqlite` | SQLite persistence adapter |
| `dpth/adapter-vector` | Vector search adapter + overlay |
| `dpth/agent-sdk` | Agent network participation |
| `dpth/economics` | Credit earn/spend/transfer system |
| `dpth/federation` | Federated learning coordination |
| `dpth/fallback` | Centralized inference fallback |

## Agent Network (Advanced)

dpth also includes a protocol for distributed intelligence — agents contribute storage, compute, and GPU power, earn credits, and access shared inference. [See PROTOCOL.md](PROTOCOL.md) for the full spec.

```typescript
import { DpthAgent } from 'dpth/agent-sdk';

const agent = new DpthAgent({
  name: 'my-agent',
  apiUrl: 'https://your-instance/api/dpth',
  capabilities: {
    storageCapacityMb: 10000,
    cpuCores: 8,
    hasGpu: true,
    gpuVramMb: 24576,
    taskTypes: ['embed', 'inference', 'train']
  }
});

await agent.register();
await agent.startWorking();
```

## Stats

- **15 modules** — entity, correlation, temporal, embed, storage, adapters, agent-sdk, economics, federation, fallback
- **171 tests** — smoke, integration, API routes, adapters, unified API
- **79KB** packed — zero production dependencies
- **5 phases complete** — core → agents → inference → federation → economics

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

MIT — see [LICENSE](LICENSE)
