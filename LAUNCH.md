# dpth Launch Posts

Updated 2026-02-04 for v0.4.0 — "Agents forget. dpth remembers." framing + Waze network layer.

---

## Hacker News (Show HN)

**Title:** Show HN: dpth – Structured memory for AI agents (entity resolution, temporal history, opt-in calibration network)

**Body:**

Hey HN,

I built dpth — a TypeScript library that gives AI agents structured, persistent memory across data sources.

**The problem:** Agents encounter the same entities everywhere — people in Stripe charges, GitHub commits, support tickets, contracts, invoices. Each time, they start from zero. "Is this the same John Smith I saw in Stripe?" gets answered differently every session because there's no memory.

**dpth solves three things:**

1. **Entity resolution** — `john@company.com` in Stripe and `jsmith` on GitHub automatically merge into one entity. Fuzzy name matching, email matching, confidence scoring. Open type system — people, companies, merchants, or anything you define.

2. **Temporal history** — Every value has a timeline with automatic diffing. Not "revenue is $50K" but "$30K → $42K → $50K" with change detection. Immutable, content-addressed snapshots.

3. **Cross-source correlation** — Revenue went up 20% the same month deploys doubled? dpth finds those patterns using Pearson correlation with lag detection.

**The interesting part — the network:**

dpth works great locally. But with `dpth({ network: true })`, your instance also contributes anonymized calibration signals — not data, just statistics about which matching strategies work. "Email matching between Stripe and GitHub on generic domains (gmail) has a 15% false-merge rate."

Think Waze for identity resolution. No PII leaves your machine. The network learns patterns, not people. Every agent that opts in makes every other agent better at resolving entities.

```typescript
import { dpth } from 'dpth/dpth';

const db = dpth({ network: true });

await db.entity.resolve({
  type: 'person',
  name: 'John Smith',
  source: 'stripe',
  externalId: 'cus_123',
  email: 'john@company.com'
});
// → confidence calibrated by network signals
```

**Storage:** In-memory by default (zero config), SQLite adapter for persistence, vector overlay for semantic search. Or implement `StorageAdapter` for any backend.

**Stats:** 69 tests, 90KB, zero dependencies, ESM, MIT.

- GitHub: https://github.com/rightclickable420/dpth
- npm: https://www.npmjs.com/package/dpth
- Docs: https://dpth.io

Would love feedback on the network signal design — is the Waze analogy the right mental model?

---

## Twitter/X Thread

**Tweet 1 (hook):**
I open-sourced dpth — structured memory for AI agents.

Your agent meets the same person in 10 different APIs. Most agents start from zero every time. dpth remembers.

npm install dpth

🧵

**Tweet 2 (problem):**
The problem: agents encounter entities everywhere — Stripe charges, GitHub commits, support tickets, contracts, invoices.

Each time, they rebuild context from scratch. "Is this the same John Smith?" gets answered differently every session.

dpth gives your agent a memory that persists.

**Tweet 3 (entity resolution):**
Entity resolution:

```
const db = dpth();

await db.entity.resolve({
  type: 'person',
  name: 'John Smith',
  source: 'stripe',
  externalId: 'cus_123',
  email: 'john@company.com'
});
// + GitHub, HubSpot, etc → auto-merged
```

Fuzzy names, email matching, confidence scores. Any entity type.

**Tweet 4 (temporal + correlation):**
Every value gets a timeline:
```
db.temporal.snapshot('dashboard', { revenue: 50000 });
// → full history, automatic diffing, time travel
```

Cross-source patterns:
```
db.correlation.track('mrr', 50000);
db.correlation.track('deploys', 12);
// → "deploys correlates with mrr (r=0.87)"
```

**Tweet 5 (the network — the hook):**
Here's what makes it different:

```
const db = dpth({ network: true });
```

One flag. Your agent now contributes anonymized calibration signals — not data, just stats about which matching strategies work.

Waze for identity resolution. Zero PII. Every agent makes every other agent smarter.

**Tweet 6 (what's sent):**
What's shared:
```json
{ "schema": "stripe+github",
  "rule": "email_match",
  "modifier": "generic_domain",
  "false_merge_rate": 0.15 }
```

What's NEVER shared: names, emails, IDs, attributes.

The network learns patterns, not people.

**Tweet 7 (CTA):**
69 tests. 90KB. Zero deps. MIT.

github.com/rightclickable420/dpth
npmjs.com/package/dpth
dpth.io

Your agent deserves a memory. Give it one.

---

## Reddit (r/typescript, r/node)

**Title:** dpth — Structured memory for AI agents: entity resolution + temporal history + opt-in calibration network (0 deps, 90KB, MIT)

**Body:**

I built dpth because I kept running into the same problem: AI agents encounter the same entities (people, companies, products) across dozens of sources, and every time they start from scratch.

**What it does:**

- **Entity resolution** — same person in Stripe, GitHub, HubSpot? dpth matches them automatically. Fuzzy name matching, email matching, confidence scoring. Open type system — define any entity type you want.

- **Temporal history** — every value has a full timeline. Automatic change detection, diffing, time-travel queries. Content-addressed snapshots (SHA-256).

- **Cross-source correlation** — discovers patterns across metrics you'd never think to connect. Pearson correlation with lag detection.

- **Pluggable storage** — in-memory default, SQLite for persistence, vector overlay for semantic search. Implement `StorageAdapter` for anything.

**The network (opt-in):**

```typescript
const db = dpth({ network: true });
```

When you enable this, your dpth instance contributes anonymized calibration signals — statistical patterns about which matching strategies work (not your data). Think Waze for identity resolution.

What's shared: `{ schema: "stripe+github", rule: "email_match", modifier: "generic_domain", false_merge_rate: 0.15 }`

What's never shared: names, emails, entity IDs, or any PII. The network learns patterns, not people.

```typescript
import { dpth } from 'dpth/dpth';

const db = dpth({ network: true });

await db.entity.resolve({
  type: 'person',
  name: 'John Smith',
  source: 'stripe',
  externalId: 'cus_123',
  email: 'john@company.com'
});
```

**Stats:** 69 tests, 90KB packed, zero production deps, ESM, TypeScript, MIT.

- GitHub: https://github.com/rightclickable420/dpth
- npm: https://www.npmjs.com/package/dpth
- Docs: https://dpth.io

Feedback welcome — especially on the network signal design and the `StorageAdapter` interface.
