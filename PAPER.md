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

### 2.3 The Analyst Model

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

### 5.1 What Worked

### 5.2 Limitations

- Single agent (N=1)
- Single human operator
- Limited task diversity
- Network has only one contributor

### 5.3 Future Work

- Multi-agent validation
- Cross-domain generalization
- Network effects at scale
- Adversarial signal resistance

---

## 6. Conclusion

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
