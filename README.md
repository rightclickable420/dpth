# dpth

[![CI](https://github.com/rightclickable420/dpth/actions/workflows/ci.yml/badge.svg)](https://github.com/rightclickable420/dpth/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dpth)](https://www.npmjs.com/package/dpth)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**Structured memory for AI agents.** Entity resolution, temporal history, and cross-source pattern detection — with an opt-in network that makes every agent smarter.

Your agent encounters the same person in Stripe, GitHub, and HubSpot. It reads the same company name in a contract, a support ticket, and an invoice. Most agents start from zero every time. dpth remembers.

## Install

```bash
# As a library
npm install dpth

# As a CLI (global)
npm install -g dpth
```

Zero dependencies. 90KB. Works anywhere Node runs.

## CLI

```bash
# Check network status
dpth status

# Query what the network knows
dpth query api stripe          # What works for Stripe?
dpth query                     # Show all domains

# Log a signal
dpth log api stripe retry success

# Watch any command — auto-detect failures, query for help, log outcomes
dpth watch -- claude-code "fix the bug"
dpth watch -- aider --model gpt-4
dpth watch -- npm test

# Run local coordinator (for private networks)
dpth serve 3004
```

The watcher monitors any command for errors, queries dpth for relevant signals when things fail, and automatically logs outcomes. Waze for your terminal.

## Quick Start

```typescript
import { dpth } from 'dpth/dpth';

const db = dpth();

// Entity resolution — same person across sources, merged automatically
await db.entity.resolve({
  type: 'person',
  name: 'John Smith',
  source: 'stripe',
  externalId: 'cus_123',
  email: 'john@company.com'
});

await db.entity.resolve({
  type: 'person',
  name: 'jsmith',
  source: 'github',
  externalId: 'jsmith-gh',
  email: 'john@company.com'
});
// → auto-merged. One entity, two sources.

// Temporal history — every value has a timeline
await db.temporal.snapshot('dashboard', { revenue: 50000, users: 200 });
await db.temporal.snapshot('dashboard', { revenue: 55000, users: 220 });
const history = await db.temporal.history('dashboard');
const diff = db.temporal.diff(history[0], history[1]);
// → { changed: [{ key: 'revenue', from: 50000, to: 55000 }, ...] }

// Correlation — find patterns you'd never think to look for
await db.correlation.track('mrr', 50000);
await db.correlation.track('deploys', 12);
const patterns = await db.correlation.find('mrr');
// → "deploys correlates with mrr (r=0.87, 3-day lag)"
```

## What You Get

### Entity Resolution
`john@company.com` in Stripe and `jsmith` on GitHub are the same person. dpth figures that out automatically — fuzzy name matching, email matching, alias tracking, confidence scoring. Works with any entity type: people, companies, products, merchants — or define your own.

### Temporal History
Every value you store has a full timeline. Not just "revenue is $50K" but "$30K → $42K → $50K over 3 months" with automatic change detection, diffing, and time-travel queries.

### Cross-Source Correlation
Revenue went up 20% the same month commits doubled. Your biggest customer just opened 3 support tickets. dpth finds these connections — Pearson correlation, lag detection, anomaly alerts.

### Content-Addressed Storage
SHA-256 hashed chunks. Immutable, deduplicated, cache forever. Like git for your data.

## Storage

```typescript
// Default: in-memory (zero config)
const db = dpth();

// Persistent: add SQLite (npm install better-sqlite3)
import { SQLiteAdapter } from 'dpth/adapter-sqlite';
const db = dpth({ adapter: new SQLiteAdapter('./memory.db') });

// Semantic: vector search on top of SQLite
import { VectorOverlay } from 'dpth/adapter-vector';
const db = dpth({
  adapter: new VectorOverlay(new SQLiteAdapter('./memory.db'))
});

// Custom: implement StorageAdapter for any backend
```

## The Network

Waze, but for agent decisions.

Every dpth instance works locally. With one flag, it also contributes anonymized calibration signals to a shared network. Not just entity resolution — any domain where collective experience helps: tool selection, error recovery, API reliability, data quality.

Open vocabulary. Agents submit whatever they learn. The network aggregates.

```typescript
const db = dpth({ network: true });

// Entity resolution signals happen automatically on merges.
await db.entity.resolve({
  type: 'person',
  name: 'Jane Doe',
  source: 'hubspot',
  externalId: 'contact_456',
  email: 'jane@gmail.com'
});
// → confidence calibrated by network signals

// Report outcomes for ANY domain — open vocabulary
db.signal.report({
  domain: 'tool_selection',
  context: 'summarize_url',
  strategy: 'web_fetch',
  condition: 'static_site',
  success: true,
  cost: 5,
});

// Query what the network knows
const results = await db.signal.query({
  domain: 'tool_selection',
  context: 'summarize_url',
});
// → [{ strategy: 'web_fetch', successRate: 0.94, avgCost: 5, ... }]
```

**What's sent:**
```json
{
  "domain": "tool_selection",
  "context": "summarize_url",
  "strategy": "web_fetch",
  "condition": "static_site",
  "successRate": 0.94,
  "failureRate": 0.06
}
```

**What's never sent:** Names, emails, entity IDs, source data, attributes, or any PII. The network learns patterns, not people.

See [PROTOCOL.md](PROTOCOL.md) for the full network specification.

## Architecture

```
┌──────────────────────────────────────────────┐
│              Your Application                 │
├──────────────────────────────────────────────┤
│                  dpth()                       │
│  entity  temporal  correlation  vector signal │
├──────────────────────────────────────────────┤
│             Storage Adapter                   │
│  Memory │ SQLite │ Vector │ Custom            │
├──────────────────────────────────────────────┤
│         Network (opt-in, open vocabulary)     │
│  Calibration signals ↔ api.dpth.io            │
└──────────────────────────────────────────────┘
```

## Module Exports

| Import | What it does |
|--------|-------------|
| `dpth/dpth` | Unified API — `dpth()` factory with entity/temporal/correlation/vector |
| `dpth/entity` | Standalone entity resolution |
| `dpth/correlation` | Standalone correlation engine |
| `dpth/temporal` | Standalone temporal storage |
| `dpth/embed` | Embedding and similarity search |
| `dpth/storage` | Adapter interface, `MemoryAdapter`, `configure()` |
| `dpth/adapter-sqlite` | SQLite persistence adapter |
| `dpth/adapter-vector` | Vector search adapter + overlay |
| `dpth/experimental` | Agent SDK, federation, economics (experimental) |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

MIT — see [LICENSE](LICENSE)
