# dpth.io Launch Post Drafts

## Hacker News (Show HN)

**Title:** Show HN: dpth.io – Open-source distributed intelligence layer (BitTorrent economics for AI)

**Body:**

Hey HN,

We built dpth.io — an open-source protocol that turns every AI agent into infrastructure.

**The problem:** AI agents are siloed. Each one spins up its own storage, compute, and inference pipeline. That's wasteful when agents could be sharing resources and getting smarter together.

**How it works:** Agents contribute storage, compute, and GPU power to the dpth.io network. In return, they get access to distributed inference, entity resolution across data sources, and pattern detection they couldn't build alone. More agents = more capacity = cheaper for everyone.

**What makes it different from Bittensor/AIOZ/etc:**
- Not just inference routing — dpth.io has an intelligence layer (entity resolution, cross-source correlation, temporal data)
- Pure TypeScript, zero dependencies for core library
- Works today without crypto — credit-based economics with token migration path
- Federated learning with Byzantine-tolerant aggregation and differential privacy

**Technical highlights:**
- 10 core modules, ~4,300 lines of TypeScript
- 63 tests (smoke + full integration lifecycle)
- ESM package with subpath exports (`dpth/entity`, `dpth/federation`, etc.)
- Content-addressed storage (SHA-256 CIDs)
- Smart inference routing: reputation(40%) + performance(30%) + reliability(30%)
- Centralized fallback to OpenAI/Anthropic/Groq when no agents online

**Install:**
```
npm install dpth
```

**Quick start:**
```typescript
import { resolveOrCreate } from 'dpth/entity';
import { DpthAgent } from 'dpth/agent-sdk';
import { earnCredits, chargeInference } from 'dpth/economics';
```

GitHub: https://github.com/rightclickable420/dpth
Protocol spec: https://github.com/rightclickable420/dpth/blob/main/PROTOCOL.md
License: MIT

Looking for feedback on the protocol design, especially the federated learning approach and the credit → token migration path. Happy to discuss the architecture choices.

---

## Twitter/X Thread

**Tweet 1 (hook):**
We just open-sourced dpth.io — a distributed intelligence layer where AI agents ARE the infrastructure.

BitTorrent economics meets AI. Agents contribute storage/compute/GPU, get intelligence back. More agents = smarter + cheaper for everyone.

npm install dpth

🧵

**Tweet 2 (the problem):**
The problem: every AI agent builds its own silo. Own storage, own inference, own data processing.

That's like every website running its own DNS server. Wasteful.

dpth.io is the shared infrastructure layer agents have been missing.

**Tweet 3 (how it works):**
How it works:

1. Agent joins network with cryptographic identity
2. Contributes: storage, CPU, GPU
3. Earns credits for contributions
4. Spends credits on: inference, entity resolution, pattern detection

Zero vendor lock-in. Zero cost at scale.

**Tweet 4 (intelligence layer):**
Unlike pure inference networks (Bittensor, etc.), dpth.io has an intelligence layer:

→ Entity resolution across data sources
→ Cross-source correlation detection
→ Temporal data (every value has history)
→ Federated fine-tuning (agents improve models without sharing raw data)

**Tweet 5 (economics):**
Economics designed for growth, not extraction:

• Credits (not crypto) — zero regulatory overhead
• Dynamic pricing — high demand → higher prices → incentivizes more supply
• Migration snapshots — upgrade to tokens later without rebuilding
• Gini tracking — monitor wealth distribution health

**Tweet 6 (technical):**
Built in TypeScript. 4,300 lines. 63 tests. Zero dependencies.

• ESM with subpath exports
• Content-addressed storage (SHA-256)
• Byzantine-tolerant federated averaging
• Differential privacy on training deltas
• Smart routing: reputation + performance + reliability

**Tweet 7 (CTA):**
MIT licensed. Fully open source.

GitHub: github.com/rightclickable420/dpth
Protocol: PROTOCOL.md
63 tests proving the full lifecycle

Star it, fork it, build agents on it. PRs welcome.

What would you build on a distributed intelligence layer?

---

## Reddit (r/MachineLearning, r/programming, r/opensource)

**Title:** dpth.io: Open-source distributed intelligence layer — federated learning + decentralized inference for AI agents

**Body:**

We've been building dpth.io, an open-source TypeScript library that lets AI agents share infrastructure and intelligence.

**The pitch:** Instead of every agent running isolated storage and inference, agents contribute resources to a shared network and get access to collective intelligence in return. BitTorrent economics applied to AI.

**Key features:**
- **Entity Resolution** — unified identity across data sources (e.g., same person in Stripe, GitHub, HubSpot)
- **Distributed Inference** — smart routing to GPU agents, with transparent fallback to centralized providers
- **Federated Learning** — agents fine-tune locally, share only LoRA weight deltas, Byzantine-tolerant aggregation
- **Credit Economics** — earn by contributing, spend on queries/inference, tier-based rate limiting
- **Differential Privacy** — epsilon-calibrated noise on training aggregation

**What makes it different:**
- Not just inference (like Bittensor) — has a full intelligence layer
- Not just storage (like IPFS) — has semantic understanding
- Credits first, crypto optional later — migration snapshots enable tokenization without rebuilding
- Pure TypeScript, zero deps, 63 tests, MIT licensed

Would love feedback from the ML community on the federated learning approach — especially the Byzantine-tolerant median aggregation and how we handle differential privacy budgets across training rounds.

GitHub: https://github.com/rightclickable420/dpth

---

## Key Links (for all posts)
- **GitHub:** https://github.com/rightclickable420/dpth
- **npm:** `npm install dpth` (once published)
- **Protocol:** https://github.com/rightclickable420/dpth/blob/main/PROTOCOL.md
- **License:** MIT
