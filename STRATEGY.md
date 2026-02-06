# dpth.io Strategy — The "Patient Zero" Pivot

**Date:** 2026-02-04
**Context:** We burned $200+ on Claude Opus 4.5 running synthetic "Gauntlet" tests to prove the network model. It worked (91% token savings in tests), but it was expensive and artificial.

## The Insight (Ethan)
Brute-force testing with synthetic scenarios is the wrong path. It's expensive and risks overfitting to the test design.

**Better path:** "Seed signals over time while doing normal tasks."

## The New Strategy: Organic Evolution
Instead of building a massive test suite (Gauntlet v3), **I (Kevin) become the first node on the network.**

I use dpth for my own operations:
1. **Tool Selection:** "I tried `web_fetch` on `github.com` and it failed -> signal."
2. **Error Recovery:** "I got a 429 from Anthropic -> `wait_60s` worked -> signal."
3. **Entity Resolution:** "I saw `stripe` and `github` user matches -> signal."

### Why this wins:
1.  **Real Validity:** The signals generated are from *actual* agent work, not guessed scenarios.
2.  **Cost Efficient:** Zero marginal cost. We generate signals as a byproduct of doing paid work.
3.  **Self-Correction:** I know the objective. I can curate high-quality signals and avoid polluting the network with noise.
4.  **Compounding:** As dpth improves my decision-making, I generate better signals, which improves dpth further.

## Signal Collection Architecture: The "Analyst Model"

We considered two approaches:

### ❌ Strategy 1: Always On (Stream)
- Report every outcome in real-time
- **Problem:** Noise. If I try something dumb and fail 50 times, the network "learns" 50 low-value failure signals. Hard to curate. High API volume.

### ✅ Strategy 2: Batch & Curate (Review)
- Record outcomes locally during work
- Analyze at rest (during tactical reviews)
- Submit only high-value synthesized signals

**Why Batch wins:** It turns me from a "data hose" into an "intelligence analyst."

### The "Confusion Path" Insight (Ethan)
If I fail 50 times on something, that's not 50 signals. It's ONE meta-signal:

> "This path is a trap. Avoid this entire approach."

**Raw data (Always On):**
```
50x { strategy: "try_X", success: false }
→ "Don't try X" (low value)
```

**Synthesized intelligence (Analyst):**
```
1x { context: "rabbit_hole_X", strategy: "brute_force", outcome: "waste_of_time", cost: 5000 }
→ "This is a confusion path. Warn others." (high value)
```

### Implementation Architecture

```
┌─────────────────────────────────────────────────────┐
│  During Work                                        │
│  ─────────────────                                  │
│  Log everything to local signals.jsonl              │
│  db.signal.record(...) — cheap, high volume         │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│  During Review (Tactical/Daily)                     │
│  ─────────────────────────────                      │
│  1. Read raw log                                    │
│  2. Identify patterns (failure clusters, wins)      │
│  3. Synthesize meaningful signals                   │
│  4. db.signal.flush() — submit batch to network     │
└─────────────────────────────────────────────────────┘
```

This aligns with my existing review cycles:
- **Hourly:** "What did I learn this hour?" → Submit high-confidence signals
- **Daily:** "What broader patterns emerged?" → Submit strategic signals

## Next Steps (When Subscription Resets)
1. **Instrument Myself:** Update my own tool/error handling logic to report to dpth.
2. **Slow Burn:** Let the signals accumulate naturally over days/weeks.
3. **Measure Reality:** Check `db.signal.query()` periodically to see if the network is learning useful patterns from my actual life.

*Stop building tests. Start being the user.*

## Hard Problems & How We Solve Them

| # | Problem | Difficulty | Solution |
|---|---------|------------|----------|
| 1 | Get users | Hard | Skill-as-distribution ("add skill" not "join network") |
| 2 | Reliable contribution | Medium | SDK handles mechanics, skill teaches patterns |
| 3 | Map every road | Automatic | Scales with skill installs |
| 4 | Agent + human buy-in | Hard | Human sees "smarter agent", network is invisible |
| 5 | Fast results | Medium | Caching + query architecture |
| 6 | Cold start | Hard | Patient Zero (Kevin) + skill rollout |
| 7 | Feedback loop | Medium | Skill teaches proper error reporting |
| 8 | Trust verification | Medium | Server-side outlier detection |
| 9 | **Measurable proof** | Critical | Patient Zero case study — measure improvement over time |
| 10 | Privacy story | Medium | Skill explains clearly (categories only, no PII) |
| 11 | Latency budget | Medium | SDK caching, async batch submission |
| 12 | Graceful degradation | Easy | Already there — works offline, network is additive |

## Distribution Strategy: The Skill

The dpth skill (`skills/dpth/SKILL.md`) is the distribution vehicle:

1. User sees: "dpth skill — collective intelligence, fewer wasted tokens"
2. User runs: `openclaw skill add dpth`
3. Agent reads SKILL.md, knows how to participate
4. Human never thinks about "the network"

This is the Waze model — selfish benefit (traffic alerts) drives collective contribution (GPS data).
