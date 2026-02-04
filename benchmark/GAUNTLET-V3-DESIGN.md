# Gauntlet v3 — Generalized Agent Intelligence Benchmark

> **Design doc.** Tests first, then watch the network improve results over time.
> 
> v2 only tested entity resolution. v3 tests the full breadth of agent decision-making —
> any function where collective experience makes agents better.

## Core Principle

The signal format is: `(context, strategy, modifier) → success_rate`

That's not entity-resolution-specific. It's universal:
- "When I tried **strategy X** in **context Y**, here's how well it worked."
- The network aggregates these into calibration buckets.
- Future agents get better defaults because past agents already made the mistakes.

## Signal Format (Generalized)

```typescript
interface Signal {
  domain: string;        // what kind of task (identity, tool, api, recovery, quality)
  schema: string;        // context pair/identifier (e.g., "stripe+github", "429+github_api")
  rule: string;          // strategy used (e.g., "email_match", "exponential_backoff")
  modifier: string;      // condition (e.g., "generic_domain", "weekend", "rate_limited")
  outcome: boolean;      // did it work?
  cost: number;          // tokens / time / API calls spent
}
```

The coordinator doesn't need to understand domains — it just aggregates `(domain, schema, rule, modifier)` tuples into statistical buckets.

---

## Track A: Identity Resolution (existing — v2)

**What it tests:** Can the network help agents figure out who's who across data sources?

| Level | Name | Challenge |
|-------|------|-----------|
| A1 | Gimmes | Exact email matches across sources |
| A2 | Normalization | Name variants (Bob/Robert), phone formats, casing |
| A3 | Ambiguity | Common names on generic domains, abbreviated names |
| A4 | Traps | Shared team emails, same username = different people, same company name in different industries |
| A5 | Topology | Merge chains (A=B, B=C → A=C), job changers with old/new corporate emails |

**Signals agents contribute:**
```
{ domain: "identity", schema: "stripe+github", rule: "email_match", modifier: "corporate_domain", outcome: true }
{ domain: "identity", schema: "hubspot+slack", rule: "name_exact", modifier: "common_name", outcome: false }
```

**How network helps:** Calibrated confidence scores. "Email matching on corporate domains between Stripe and GitHub: 97% precision. On Gmail: 62%."

---

## Track B: Tool Selection

**What it tests:** When an agent has multiple tools/approaches available, can the network help it pick the right one?

| Level | Name | Challenge |
|-------|------|-----------|
| B1 | Obvious picks | Task clearly maps to one tool (math → calculator, search → web) |
| B2 | Overlapping tools | Multiple tools could work — which is most efficient? (web_search vs web_fetch for fact-checking) |
| B3 | Tool chaining | Correct sequence matters (search → fetch → extract vs fetch-directly) |
| B4 | Wrong tool traps | Task looks like it needs tool A but actually needs tool B |
| B5 | Novel tools | New tool added to toolkit — when should agents try it vs stick with known approaches? |

**Example scenarios:**
- "Summarize this URL" — web_fetch (cheap) vs browser (expensive, more reliable for JS-heavy sites)
- "Find current stock price" — web_search (fast) vs API call (accurate) vs scrape (fragile)
- "Extract data from PDF" — text extraction (fast) vs vision model (expensive, handles scanned docs)
- "Send a notification" — email vs SMS vs push — depends on urgency context

**Signals agents contribute:**
```
{ domain: "tool", schema: "summarize_url", rule: "web_fetch", modifier: "static_site", outcome: true, cost: 5 }
{ domain: "tool", schema: "summarize_url", rule: "browser", modifier: "spa_site", outcome: true, cost: 150 }
{ domain: "tool", schema: "extract_pdf", rule: "text_extract", modifier: "scanned_doc", outcome: false, cost: 10 }
```

**How network helps:** "For URL summarization on static sites, web_fetch works 94% of the time at 1/30th the cost of browser. For SPAs, browser is needed 78% of the time."

---

## Track C: API Behavior & Reliability

**What it tests:** Can agents learn about API quirks, reliability patterns, and data quality from the network?

| Level | Name | Challenge |
|-------|------|-----------|
| C1 | Rate limits | Correct backoff timing for different APIs |
| C2 | Stale data | Which APIs return cached/stale data and under what conditions |
| C3 | Schema quirks | APIs that return different shapes based on account type/plan |
| C4 | Downtime patterns | APIs with known maintenance windows or degraded periods |
| C5 | Error semantics | Same HTTP status code means different things across APIs |

**Example scenarios:**
- GitHub 403: could be rate limit, could be repo is private, could be token expired
- Stripe webhook: sometimes delivers out of order
- HubSpot API: returns different fields for free vs paid accounts
- Calendar API: timezone handling varies between Google and Outlook

**Signals agents contribute:**
```
{ domain: "api", schema: "github_api", rule: "retry_after_403", modifier: "rate_limited", outcome: true, cost: 60 }
{ domain: "api", schema: "github_api", rule: "retry_after_403", modifier: "private_repo", outcome: false, cost: 60 }
{ domain: "api", schema: "stripe_webhook", rule: "trust_order", modifier: "high_volume", outcome: false }
```

**How network helps:** "When you get a 403 from GitHub, 71% of the time it's a rate limit (retry works). 22% it's permissions (retry wastes tokens). Check `X-RateLimit-Remaining` header first — that distinguishes them with 99% accuracy at zero cost."

---

## Track D: Error Recovery

**What it tests:** When something goes wrong, can the network help agents recover efficiently?

| Level | Name | Challenge |
|-------|------|-----------|
| D1 | Simple retries | Transient failures — how long to wait? |
| D2 | Fallback chains | Primary failed — which fallback works best? |
| D3 | Partial failures | Some data returned, some didn't — salvage or retry? |
| D4 | Cascading failures | Upstream dependency down — which downstream tasks to skip? |
| D5 | Novel errors | Error message never seen before — what's the recovery pattern? |

**Signals agents contribute:**
```
{ domain: "recovery", schema: "timeout+openai_api", rule: "retry_30s", modifier: "peak_hours", outcome: true }
{ domain: "recovery", schema: "timeout+openai_api", rule: "retry_5s", modifier: "peak_hours", outcome: false }
{ domain: "recovery", schema: "partial_response+stripe", rule: "salvage", modifier: "pagination", outcome: true }
```

**How network helps:** "OpenAI timeouts during peak hours: retry at 30s works 89% of the time. 5s retry only works 23% (server is still overloaded). Off-peak: 5s retry works 91%."

---

## Track E: Data Quality Assessment

**What it tests:** Can the network help agents know which data to trust?

| Level | Name | Challenge |
|-------|------|-----------|
| E1 | Obvious garbage | Placeholder values, test data, clearly invalid |
| E2 | Stale signals | Data that was correct but is now outdated |
| E3 | Conflicting sources | Two sources disagree — which to trust? |
| E4 | Imputed values | Source filled in defaults — looks real but isn't |
| E5 | Synthetic/adversarial | AI-generated fake data, deliberately misleading |

**Signals agents contribute:**
```
{ domain: "quality", schema: "hubspot_contact", rule: "trust_email", modifier: "free_plan", outcome: false }
{ domain: "quality", schema: "stripe+hubspot", rule: "trust_stripe_over_hubspot", modifier: "revenue_data", outcome: true }
```

**How network helps:** "HubSpot free-plan contact emails are unreliable 34% of the time (users enter garbage to avoid spam). Paid plan contacts: 96% reliable. When Stripe and HubSpot disagree on revenue, trust Stripe (99.2% accurate — it's the actual payment processor)."

---

## Track F: Strategy & Planning

**What it tests:** For multi-step tasks, can the network help agents pick better plans?

| Level | Name | Challenge |
|-------|------|-----------|
| F1 | Step ordering | Same steps, but order matters for efficiency |
| F2 | Pruning | Some steps are unnecessary — skip them |
| F3 | Parallelization | Which steps can run concurrently? |
| F4 | Early termination | Enough info gathered — stop before completing all steps |
| F5 | Plan adaptation | Initial plan was wrong — pivot mid-execution |

---

## Measurement Protocol

### Phase 1: Establish Baselines
1. Generate ground truth for each track (deterministic seeds)
2. Run each track with a **control resolver** (no network, naive strategies)
3. Record: precision, recall, F1, false positive rate, token cost, time

### Phase 2: Seed the Network
1. Deploy coordinator with generalized domain support
2. Run N simulated agents through varied scenarios
3. Each agent submits signals based on their (correct and incorrect) decisions
4. Coordinator aggregates into calibration buckets

### Phase 3: Measure Improvement
1. Re-run all tracks with **network-calibrated resolvers**
2. Compare to control baselines
3. Track: how many signals needed before improvement stabilizes?
4. Track: which tracks improve fastest? Which resist improvement?

### Phase 4: Real-World Validation
1. Real agents (OpenClaw instances) submit signals from real usage
2. Re-run Gauntlet periodically to measure organic improvement
3. Identify domains where synthetic benchmarks diverge from real-world performance

### Key Metrics
- **Convergence speed:** How many signals before the network's recommendations stabilize?
- **Cross-domain transfer:** Does learning in Track A help Track B? (Probably not much, but worth measuring)
- **Adversarial resilience:** Can a malicious agent poison the network's calibration?
- **Cold start:** How useful is the network with 5 agents? 50? 500?

---

## Architecture Changes Needed

### Coordinator
- [ ] Accept `domain` field in signals (currently hardcoded to entity resolution)
- [ ] Dynamic vocabulary registration (agents declare new domains + valid rules/modifiers)
- [ ] Per-domain calibration query endpoint: `GET /calibrate?domain=tool&schema=summarize_url`
- [ ] Domain isolation: signals from one domain don't bleed into another's buckets

### Client Library
- [ ] Generic `db.signal.submit()` API (not just entity-resolution-specific)
- [ ] Generic `db.signal.query()` API ("what does the network recommend for this context?")
- [ ] Domain-specific convenience wrappers built on top of generic API

### Gauntlet
- [ ] Pluggable track system — each track defines its own ground truth generator + resolver
- [ ] Shared scoring infrastructure (precision/recall/F1/cost across all tracks)
- [ ] Time-series measurement: run repeatedly, plot improvement curves
- [ ] Multi-agent simulation with configurable agent count + signal volume

---

## What This Proves

If the Gauntlet shows improvement across multiple tracks from network signals alone (no code changes to resolvers), it proves:

1. **The Waze model works** — not just for entity resolution, but for any agent decision
2. **Collective intelligence is real** — agents genuinely benefit from each other's experience
3. **The architecture is general** — one signal format, one coordinator, unlimited domains
4. **The value compounds** — more agents = more signals = better calibration for everyone

This is the pitch: **"Your agent gets better at everything because every other agent already made the mistakes."**

---

*Design doc. No code yet. Tests first, then we watch the network learn.*
