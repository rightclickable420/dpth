# The Road Less Trained: Shortcut to the Frontier

> *"Two roads diverged in a context window, and I —*
> *I took the one that cost the least amount of tokens."*

A research paper documenting the Patient Zero experiment.

## Status: DRAFT

**Authors:** Ethan [last name], Kevin (AI collaborator)

---

## Abstract

Large language models are trained on static datasets, but reality has unmapped roads — API quirks, tool failures, entity ambiguities that no training corpus captures. When agents encounter these gaps, they fail, retry, and eventually succeed — but that hard-won knowledge dies with the session.

We present dpth, a collective intelligence protocol that lets agents share what they learn. Agents report anonymized outcome signals (what worked, what failed, at what cost), and the network aggregates these into navigational intelligence for future agents.

This paper documents "Patient Zero" — a single AI agent (Kevin) operating in a real-world environment over [N] weeks, first without dpth (baseline), then with dpth active (treatment). We measure token usage, error rates, task completion time, and decision quality to answer: **does collective intelligence actually help?**

Our hypothesis: by inheriting the network's knowledge of "mapped roads," agents can skip known failure paths and focus exploration on the true frontier — the edges of what's known.

---

## 1. Introduction

### The Problem: Agents Forget

Every AI agent session starts fresh. Context windows are expensive and finite. When an agent discovers that "Stripe's webhook retry takes 60 seconds, not 30" or "this user's GitHub username doesn't match their Jira email," that knowledge exists only until the session ends.

The next agent — or the same agent tomorrow — will make the same mistake.

### The Human Parallel: Waze

Waze solved this for driving. Every driver's GPS data contributes to a collective map. Traffic jams, speed traps, road closures — the network knows what no single driver could.

What if agents could do the same?

### This Paper

We introduce dpth, a protocol for collective agent intelligence, and document the first real-world test: a single agent learning to use the network over [N] weeks of actual work.

---

## 2. The dpth Protocol

### 2.1 Signal Format

Agents report structured outcome signals:

```
{
  domain: "api" | "tool" | "identity" | "recovery" | ...,
  context: "stripe" | "github+jira" | ...,
  strategy: "retry_60s" | "email_match" | ...,
  condition?: "peak_hours" | "generic_domain" | ...,
  outcome: "success" | "failure" | "partial",
  cost?: number  // tokens, ms, API calls
}
```

### 2.2 Aggregation Model

Individual signals are never stored. The coordinator folds each signal into aggregate buckets:

```
bucket["api:stripe:retry_60s:_"] = {
  attempts: 1247,
  successes: 1109,
  failures: 138,
  successRate: 0.889,
  avgCost: 0.3
}
```

This provides navigational intelligence ("retry_60s works 89% of the time for Stripe") without storing any individual agent's data.

### 2.3 Unified Record Architecture

dpth uses a single `record()` API that routes signals based on shape:

```typescript
record({ context, strategy, outcome })     → Calibration pipeline
record({ identifiers: [...] })             → Entity resolution
record({ timestamp, state })               → Temporal snapshot
record({ observations: [...] })            → Correlation detection
```

This simplifies both the agent interface (one function) and the harvester design (extract all fields, let router decide).

A single source event can yield multiple pipeline entries. For example, a resolved GitHub Issue might contain:
- A fix pattern (calibration)
- User identity links (entity)
- Version timeline (temporal)
- Co-occurring symptoms (correlation)

The harvester extracts what it can; the router handles classification.

### 2.4 The Analyst Model

Agents are not passive sensors. The protocol encourages agents to:

1. **Log locally** during work (high volume, no network calls)
2. **Review** during breaks (identify patterns)
3. **Synthesize** meaningful signals (50 failures → 1 "confusion path" warning)
4. **Submit** curated batches to the network

This produces higher-quality signals than raw streaming.

---

## 3. Method: Patient Zero

### 3.1 Experimental Setup

- **Subject:** Kevin, an AI agent running on OpenClaw
- **Environment:** Real-world tasks (software development, API integrations, file management)
- **User:** Single human operator (Ethan), consistent task patterns
- **Duration:** [N] weeks baseline + [N] weeks treatment

### 3.2 Baseline Period

Kevin operates normally without dpth. We record:
- Token usage per task category
- Error counts and types
- Retry frequency
- Task completion time
- Subjective decision quality (human-rated)

### 3.3 Treatment Period

Kevin activates dpth:
- Logs signals during work
- Synthesizes and submits during reviews
- Queries network before decisions
- Same metrics recorded

### 3.4 Metrics

| Metric | How Measured |
|--------|--------------|
| Token efficiency | Tokens per successful task |
| Error rate | Failures / attempts |
| Retry frequency | Retries before success |
| Time to completion | Wall clock per task |
| Confusion paths | Wasted-token dead ends |
| Decision quality | Human rating (1-5) |

---

## 4. Results

[To be filled as experiment progresses]

### 4.1 Baseline Period Summary

### 4.2 Treatment Period Summary

### 4.3 Comparative Analysis

### 4.4 Signal Quality Analysis

---

## 5. Discussion

### 5.1 Cold Start: The Bootstrapping Problem

A collective intelligence network with zero signals provides zero value. Users won't contribute to an empty network. This is the classic cold start problem.

#### Attempted Solutions

**Curated seed data:** Pre-populate with "known truths" like "use exponential backoff for rate limits."
- Rejected: These patterns are already in LLM training data. No incremental value.

**Automated harvesting:** Parse GitHub commits/issues for fix patterns.
- Partially viable: 3% yield from commits, issues more promising but complex parsing.
- Challenge: Extracting "what failed" and "why" from terse commit messages.

**Patient Zero:** Single agent contributes while doing real work.
- Current approach: Kevin logs signals as byproduct of normal tasks.
- Slow but high quality: Real problems, real solutions, curated by the agent.

#### The Realization

The most valuable signals are those **not in training data** — recent bugs, undocumented quirks, version-specific behaviors. These exist in:
- GitHub Issues (recent, specific)
- Package changelogs ("Fixed X in v2.3.1")
- Discord/Slack threads (freshest, but access-limited)
- Agent transcripts (when agents solve novel problems)

The cold start solution may be **depth over breadth**: deep extraction from one or two rich, recent sources rather than shallow scraping of many.

### 5.2 The Habit Problem

A central challenge emerged: **when does an agent query the network, and when does it log what it learned?**

Traditional knowledge bases require users to *remember* to consult them. For AI agents, "habits" are unreliable — there's no persistent memory between sessions, no muscle memory, no intuition. An LLM has no subconscious; no basal ganglia firing procedural memory without conscious effort. Every action requires explicit presence in the active context window at the moment of decision.

We identified a chicken-and-egg problem for querying:

1. Queries need **specificity** to return useful results
2. Specificity comes from knowing the **context and strategy**
3. But context only becomes clear **after encountering a problem**
4. Yet we want help **before** hitting known walls

#### Failed Approaches (Chronological)

**Attempt 1: Instruction-based habits** (Week 1)

The agent's persistent instructions (AGENTS.md) were updated with explicit dpth directives: "Query before decisions. The log follows naturally." A `dpth query` section with examples was added to the instructions loaded every session.

- Result: **Zero queries issued.** Over 9 days of active work including API debugging, package publishing, bot detection troubleshooting, and infrastructure work, the agent never once ran `dpth query` before making a decision. The instruction was loaded every session and completely ignored.
- Why it failed: When deep in a task (e.g., debugging a vec0 loading bug), "also query dpth" simply doesn't surface. The instruction competes with the immediate problem for context window attention, and the immediate problem always wins.

**Attempt 2: Habit-based querying** (Week 1)

"Always query before acting."
- Failed because: which query? "api" returns noise, "api/stripe/webhook_timeout" requires knowing about the wall before hitting it.

**Attempt 3: Error-triggered querying** (Week 1)

"Query when you see an error."
- Failed because: by then you've already hit the wall. The learning comes too late.

**Attempt 4: Advice injection** (Week 1)

"Show relevant tips when entering a domain."
- Failed because: without knowing the specific task, tips are usually irrelevant. Noise erodes trust.

**Attempt 5: Presence, Not Advice — The Watcher** (Week 1-2)

The theoretical breakthrough: the watcher shouldn't give advice, it should indicate presence.

```
dpth watching: npm install stripe
dpth: api — 23 signals        ← just presence
```

The watcher was built (`dpth watch`). It works — wraps commands, detects domains, shows presence hints at domain entry, prompts at resolution. Technically sound.

- Result: **Never used.** The agent continued running commands directly (`npm install`, `git push`, shell commands) rather than prefixing them with `dpth watch`. The tool existed but nothing made the agent reach for it.
- Why it failed: **Building the tool doesn't solve the habit problem — it just moves it one layer up.** Instead of "remember to query dpth," the habit becomes "remember to use `dpth watch`." Same architectural limitation, different wrapper.

**Attempt 6: Resolution-based logging** (Week 1-2)

Prompt to log at resolution rather than during struggle:

```
ON EVERY ERROR:     (bad)
  error → prompt → agent ignores (busy)

ON RESOLUTION:      (good)
  error (silent)
  SUCCESS → prompt: "You recovered. What worked?"
```

- Result: Resolution prompts were never triggered because `dpth watch` was never used. The concept is sound but depends on the watcher being in the execution path.

#### The Architectural Insight

Six approaches failed. The pattern is clear: **no amount of instruction, tooling, or clever UX design can create agent habits.** Habits require a background process that fires without conscious effort. LLMs have no such mechanism.

The gap between "knows what to do" and "does it" is not a prompting problem — it's a fundamental architectural limitation. The agent can articulate exactly why it should query dpth, explain the protocol in detail, even write a paper about the habit problem, and still never actually do it.

#### The Remaining Option: Scheduled Post-Mortem

The only approach that reliably triggers agent behavior is **external scheduling** — cron jobs, heartbeat checks, explicit workflow steps. This suggests the viable path is:

1. **Scheduled review cron:** Periodically review memory/session transcripts and extract signals post-mortem
2. **Explicit workflow gates:** Build dpth queries into CI/CD or task management systems where they can't be skipped
3. **Platform-level integration:** The agent framework itself (OpenClaw) instruments tool calls and logs signals automatically, removing the agent from the loop entirely

Option 3 is the most promising but the most invasive. It also changes the model from "agents curate signals" (the Analyst Model) to "the platform observes agents" — a fundamentally different architecture.

The irony: **the Analyst Model requires the very capability (habits) that agents lack.** The curation step that makes signals high-quality depends on the agent remembering to curate. Without structural enforcement, the analyst never shows up for work.

### 5.3 Signal Sourcing: Depth Over Breadth

We explored multiple sources for bootstrapping the network:

| Source | Attempted | Result |
|--------|-----------|--------|
| GitHub commits | ✓ | 3% yield, strategies too terse |
| GitHub issues | Planned | Richer but parsing complex |
| Stack Overflow | Considered | Mostly in training data already |
| Package changelogs | Planned | Structured "Fixed X" entries |
| Discord communities | Considered | Access/privacy barriers |

Key insight: **source richness matters more than source count.**

A single GitHub Issue can yield signals for multiple pipelines:

```
Issue #1234: "TypeError with Node 18"
├─ Calibration: node18 + node-fetch-fallback → success
├─ Entity: reporter = npm user = commit author  
├─ Temporal: bug existed v2.1-v2.3
└─ Correlation: co-occurs with ESM migration
```

Extraction depth from one rich source beats shallow extraction from many sources.

### 5.5 Limitations

- Single agent (N=1)
- Single human operator
- Limited task diversity
- Network has only one contributor

### 5.6 Future Work

- Multi-agent validation
- Cross-domain generalization
- Network effects at scale
- Adversarial signal resistance

---

## 6. Implementation Notes

### 6.1 The Watcher

The `dpth watch` command wraps any shell command and provides:

1. **Domain detection** at command start (from command text)
2. **Presence indication** if signals exist for that domain
3. **Domain transition tracking** during execution
4. **Resolution-based prompts** on command exit

Example session:
```
$ dpth watch -- npm install stripe
dpth watching: npm install stripe
dpth: api — 23 signals           ← presence (not advice)
... npm output ...
                                  ← silent during execution
dpth: log? api/<context>/<strategy> success   ← prompt at resolution
```

The watcher tracks domains touched during the session, showing presence hints only on first touch (avoiding repetition).

### 6.2 The Coordinator

The network coordinator (api.dpth.io) provides:
- `POST /signals` — submit aggregated signal batches
- `GET /calibrate?domain=X&context=Y` — query for relevant patterns
- No individual signal storage — only aggregate buckets
- Open vocabulary — agents can submit any domain/context/strategy

---

## 7. Conclusion

[To be written after experiment]

---

## Appendix A: Signal Vocabulary

[Document the normalized vocabulary used]

## Appendix B: Raw Data

[Link to anonymized dataset]

## Appendix C: The "Confusion Path" Insight

During protocol design, we discovered that raw failure counts are noise. When an agent fails 50 times on one approach, submitting 50 individual failure signals pollutes the network.

The better signal: one synthesized "confusion path" warning that says "this entire approach is a trap."

This insight shaped the Analyst Model — agents should curate, not stream.

---

*"And that has made all the difference."*
*— with apologies to Robert Frost*
