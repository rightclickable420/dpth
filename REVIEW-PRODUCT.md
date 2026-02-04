# dpth.io — Product & Market Review

> Brutally honest assessment from a product/market perspective.
> Written 2026-02-04.

---

## TL;DR

dpth is a technically impressive TypeScript library with a severe identity crisis. It's trying to be three different products at once — a lightweight entity resolution library, a temporal data store, and a decentralized AI compute network — and the result is that nobody knows what it is or why they need it. The core modules (entity, temporal, correlation) solve real problems. The agent network / federated learning / economics layer is a distraction that will kill adoption. Ship the useful parts, kill the ambitious parts, and position it as "the missing data layer for multi-API apps."

---

## 1. Positioning: What Is This Thing?

### The Problem

The README says "distributed intelligence layer." The package.json says "decentralized AI inference, data intelligence, and agent coordination." The landing page says "connect your data sources." The protocol spec describes a full P2P agent economy with federated learning, credit economics, and GPU inference routing.

These are four different products. And the target audience for each is completely different.

**Current positioning attempts:**

| Frame | Target | Problem |
|-------|--------|---------|
| "Distributed intelligence layer" | Crypto/web3 people, AI infra nerds | Too abstract, sounds like vaporware |
| "Decentralized AI inference" | GPU providers, Bittensor-adjacent | Requires a live network (you don't have one) |
| "Connect your data sources" | App developers pulling from APIs | This one actually resonates |
| "Agent memory layer" | AI agent builders | Promising but early and niche |

### The Right Frame

**"The data layer for multi-API apps."**

Or more specifically: **"Entity resolution + temporal history for TypeScript. One npm install."**

Here's why: the core value proposition — "same person in Stripe and GitHub gets auto-merged" — is immediately understandable. Developers who've built on top of 3+ APIs have felt this pain. The temporal history feature is a nice complement. The correlation engine is a cool bonus.

Everything else (agent network, federated learning, credit economics, inference routing, model registry) should be deleted from the README, removed from the landing page, and tucked into an "advanced/experimental" section for the 0.1% of users who care.

**You are not Bittensor. You are not a decentralized compute network. You are a utility library.** Lean into that.

---

## 2. Market: Who Actually Needs This?

### Real Users (people who'd npm install this tomorrow)

**1. Full-stack developers building internal tools or SaaS dashboards**
- Job title: Senior Engineer, Staff Engineer, Tech Lead
- Pain: "I pull customer data from Stripe, user data from Auth0, activity from GitHub, and tickets from Zendesk. Matching them requires a rats nest of SQL JOINs and email-matching scripts."
- Use case: Building a unified customer view, internal CRM, or ops dashboard
- Willingness to pay: Low (they'd use the OSS version), but they'd adopt

**2. Data engineers at startups (50-500 employees)**
- Pain: "We have 15 SaaS tools and no single source of truth for 'who is this customer across systems?'"
- Use case: ETL pipeline enrichment, data warehouse identity resolution
- Problem: They're more likely to use Python (Splink, Zingg, dedupe) — TypeScript is unusual for data eng

**3. AI agent builders (emerging)**
- Pain: "My agent needs structured memory that persists across sessions and connects data from multiple tools"
- Use case: Agent memory layer with entity awareness
- Problem: Tiny market today, maybe huge in 12 months

### People Who Won't Use This

- **Enterprise data teams**: They use Informatica MDM, Reltio, Tamr, AWS Entity Resolution — they're not npm installing anything
- **Data scientists**: They live in Python. Entity resolution in TypeScript is a curiosity, not a tool
- **Crypto/DePIN builders**: They want token incentives and Bittensor-like networks. Your credit system is play money without a token
- **Random frontend devs**: They don't have this problem

### Market Size Reality Check

The honest total addressable market for "cross-API entity resolution as a TypeScript library" is small. Maybe 5,000-15,000 developers worldwide who (a) work in TypeScript, (b) integrate 3+ APIs, (c) need entity matching, and (d) would adopt a new library for it.

That's a great open-source user base. It's not a VC-scale market — unless you find a wedge to expand.

---

## 3. Competition

### Direct Competitors (entity resolution)

| Tool | Language | Scale | Notes |
|------|----------|-------|-------|
| **Splink** (MOJ) | Python | Production at UK Gov scale | The gold standard. 10K+ GitHub stars. ML-based, well documented |
| **Zingg** | Java/Spark | Enterprise | Active learning, works on AWS Glue. Serious tool |
| **dedupe** | Python | Small-medium | Active learning with human-in-the-loop. Popular in academia |
| **AWS Entity Resolution** | Managed service | Enterprise | Fully managed, integrates with AWS ecosystem |
| **dpth** | TypeScript | Small | Fuzzy matching + email. No ML-based matching |

**Key insight:** There is essentially ZERO competition in TypeScript for entity resolution. The entire ER space is Python and Java. This is both an opportunity (greenfield) and a warning (maybe TypeScript devs don't want this).

### Adjacent Competitors

| Category | Tools | How dpth overlaps |
|----------|-------|-------------------|
| **CDPs** (Customer Data Platforms) | Segment, RudderStack, mParticle | Identity resolution across sources — but they're SaaS, not libraries |
| **Temporal databases** | DoltDB, TerminusDB, XTDB | Bitemporal storage — but they're full databases, not npm packages |
| **Data enrichment APIs** | Clearbit, People Data Labs, Apollo | Enrich records with external data — different approach but similar outcome |
| **Workflow/orchestration** | Temporal (the company) | Confusing name overlap. Temporal.io is a workflow engine, not temporal data |
| **Agent memory** | Mem0, Zep, LangGraph memory | Agent-specific memory layers — this is where dpth's agent angle competes |

### The Gap

**Nobody offers lightweight, in-process entity resolution for TypeScript.** Every existing tool is either:
- A heavyweight Python/Java system requiring infrastructure
- A managed SaaS service with pricing per record
- A full database requiring deployment

dpth's unique position: `npm install dpth` and you have entity resolution in your Node.js app. That's genuinely novel. **Don't dilute it with 12 other features.**

---

## 4. The Name "dpth"

### Verdict: It hurts more than it helps.

**Problems:**
- **Unpronounceable.** Is it "depth"? "D-P-T-H"? "dip-th"? Every conversation about it starts with "how do you say it?"
- **Unsearchable.** Google "dpth" and you get nothing useful. Try explaining it in a podcast.
- **No semantic meaning.** If it's supposed to evoke "depth," just call it "depth." The vowel-dropping trend (flickr, tumblr) peaked in 2012.
- **dpth.io** — the domain is fine, but "dpth" as a keyword competes with zero search volume for the right reasons

**What works:**
- It's short (4 chars)
- The `.io` domain is available (already owned)
- It's unique (no namespace collisions on npm)

**If you renamed it today** (you probably shouldn't, rebranding is expensive), something like `crossref`, `entify`, `stitch`, `unify`, or `weave` would be more memorable and searchable. But at this stage, the name matters less than the positioning. Ship first, worry about names if it gets traction.

---

## 5. Landing Page (dpth.io)

### What Works
- Clean, dark design. Looks professional.
- `npm install dpth` prominently displayed with click-to-copy. Good.
- Code examples are real and runnable. Excellent.
- Zero-dependency badge builds trust.
- Stats section (171 tests, 79KB, 0 deps) is compelling for developers.

### What Doesn't Work

**1. The hero is confused.**
"Your data is scattered. dpth connects it." — Good hook.
Then: "resolves entities across sources, detects cross-source patterns, and gives every data point a history" — you're listing three features, not one value prop. Pick one.

Better: "Your customers exist in Stripe, GitHub, HubSpot, and Zendesk. dpth makes them one."

**2. Too many features on page one.**
Six feature cards, architecture diagram, five "phases," four code examples, agent SDK... A developer hits this page and thinks "cool, but what do I actually use first?" The paradox of choice is real.

**3. The "phases" section is internal thinking, not user-facing.**
"Phase 1: Core Infrastructure ✅" — nobody cares about your roadmap phases. This reads like a pitch deck, not a product page. Delete it.

**4. The architecture diagram shows an agent network nobody can use yet.**
If the P2P agent network doesn't have real nodes running, showing it on the landing page is misleading. Ship the library story, not the network story.

**5. No live demo / playground.**
The #1 thing missing: a "Try it now" that opens a REPL or a StackBlitz project. Developers want to feel the API before they install it.

**6. The OpenClaw skill section is niche.**
Unless OpenClaw has significant adoption, this section confuses 95% of visitors. Move it to the README or a separate page.

**7. No "Who uses this" / social proof section.**
Even one testimonial, one "Built with dpth" project, or a real-world example would 10x credibility.

### Conversion Assessment

A developer who finds this page will:
1. ✅ Understand the general concept (data connection)
2. ❌ Be confused about whether it's a library, a database, or a network
3. ✅ See the install command
4. ❌ Not know which feature to try first
5. ❌ Leave without installing because there's no urgency/hook

**Estimated conversion (visit → npm install): 1-3%.** Could be 5-10% with a clearer story and a live demo.

---

## 6. Monetization

### The Hard Truth

A zero-dependency TypeScript library with 79KB and an MIT license is extremely hard to monetize directly. The open-source utility library business model has exactly one proven path: **open core**.

### Realistic Monetization Options

**Tier 1: Open Source Foundation (now)**
- Free forever: entity resolution, temporal history, correlation, in-memory storage
- This is your adoption wedge. Don't gate it.

**Tier 2: Cloud Service (6-12 months)**
- Hosted dpth with persistence, managed identity resolution across SaaS tools
- Pre-built connectors: Stripe, GitHub, HubSpot, Salesforce, Zendesk
- Dashboard: "See all your entities across 12 sources"
- Price: $99-499/mo based on entity volume
- This is where real money lives

**Tier 3: Enterprise Features (12-24 months)**
- SSO/RBAC, audit logs, compliance (SOC 2)
- Batch entity resolution across data warehouses
- Custom matching rules, ML-based matching
- Price: $2K-10K/mo

**The agent network / credit economy is NOT a monetization path** until there's a real network with real participants. Don't build the economics before the economy exists.

### Business Model I'd Actually Bet On

**dpth Cloud: "Segment for identity resolution."**

- You install the library locally (OSS, free)
- Optionally, you connect to dpth Cloud which syncs entities across your team
- Pre-built source connectors pull from your Stripe, HubSpot, etc. automatically
- Dashboard shows unified customer/entity view
- Pricing: usage-based (per entity resolved per month)

This is a $5-20M ARR business if executed well. Not a unicorn, but a real company.

---

## 7. Distribution Strategy

### Current Plan Assessment

| Channel | Potential | Risk |
|---------|-----------|------|
| **HN (Show HN)** | High — this is exactly the audience | One shot. If the post doesn't land, you can't re-post |
| **Twitter/X** | Medium — thread is solid | Needs a following to get traction. Cold threads die |
| **Reddit (r/typescript, r/node)** | Medium — good for early adopters | Self-promotion rules are strict. Easy to get flagged |
| **Moltbook** | Low — tiny platform | Worth trying but won't move the needle |

### What's Missing

**1. The Real Growth Lever: A Killer Blog Post**
"How I resolved 50,000 customer entities across 8 APIs with one npm package" — this content does the selling for you. Write the tutorial, post it on dev.to, HN, and your own blog. Show real numbers, real APIs, real code.

**2. Integration-First Distribution**
Build the Stripe connector. Build the GitHub connector. Build the HubSpot connector. Now you can post in each of those communities: "Automatically match your Stripe customers to your GitHub contributors." Each connector is a distribution channel.

**3. StackBlitz / CodeSandbox Template**
One-click playground that lets developers try entity resolution in 30 seconds without installing anything. Link to this from everywhere.

**4. OpenAI / Anthropic / Agent Framework Integrations**
If agent memory is part of the story, integrate with LangChain, CrewAI, AutoGen, and OpenClaw. Each integration puts dpth in front of that framework's user base.

**5. Package Ecosystem Play**
Build `dpth-stripe`, `dpth-github`, `dpth-hubspot` as separate packages that auto-resolve entities from those specific APIs. Each package is a new keyword on npm and a new discovery surface.

### The Growth Strategy I'd Actually Run

Week 1-2: Ship the StackBlitz playground. Write the killer blog post.
Week 3: Show HN with the blog post (not just the repo).
Week 4: Post in r/typescript, r/node, dev.to with real-world examples.
Week 5-8: Ship 3 source connectors (Stripe, GitHub, HubSpot). Post in each community.
Week 9-12: Measure. Double down on whatever drove installs.

---

## 8. The Biggest Risk

**It's not competition. It's scope creep.**

dpth is trying to be:
1. An entity resolution library ✅ (real, useful, shippable)
2. A temporal data store ✅ (nice complement)
3. A correlation engine ✅ (interesting bonus)
4. A content-addressed storage system (why?)
5. A distributed agent network (doesn't exist yet)
6. A federated learning framework (no users to federate)
7. A credit/economic system (play money without a token)
8. A model inference router (against OpenRouter, Together, etc.?)
9. A reputation/governance system (for a network of zero nodes)

Items 4-9 represent ~70% of the codebase and protocol spec, but serve ~0% of actual users today. They make the project look:
- **Unfocused** — "is this a library or a protocol?"
- **Overengineered** — "why does an npm package have federated learning?"
- **Crypto-adjacent** — "migration snapshots for future tokenization" triggers skepticism
- **Untestable** — you can't demo a P2P network with one node

**The risk:** dpth ships as a 15-module kitchen sink, gets 50 GitHub stars from people who like the README, and never achieves real adoption because nobody knows which module to start with.

**The mitigation:** Ruthlessly cut scope. Ship entity + temporal + correlation as v1.0. Put everything else in a separate `dpth-network` package or a `future/` branch. Let the core library win on its own merits.

---

## 9. If I Had 1 Week to Make dpth 10x More Adoptable

### Day 1-2: Ruthless Simplification
- **Fork the README.** New version mentions only 3 things: entity resolution, temporal history, correlation engine. That's it.
- **Remove** all references to agent network, federation, economics, inference from the main README and landing page. Move to PROTOCOL.md or a separate "vision" doc.
- **Rewrite the hero:** "Match customers across APIs. Track every change. Find hidden patterns. One `npm install`, zero dependencies."
- **Kill the phases section** on the landing page. Replace with a single real-world example.

### Day 3-4: Ship the Demo
- **StackBlitz template** that lets you: (1) add a "customer" from Stripe, (2) add a "user" from GitHub, (3) watch them auto-merge, (4) see the temporal history. Interactive, visual, instant.
- **One killer blog post:** "I connected Stripe + GitHub + HubSpot in 50 lines of TypeScript" — complete with screenshots, code, and the actual results.

### Day 5: Build One Real Connector
- `dpth-stripe`: Given a Stripe API key, automatically resolves all customers as entities with email, name, and metadata. This is the "aha moment" in a box.
- Show before/after: "Here are your 3,000 Stripe customers. Here are the 847 that also exist in your GitHub org."

### Day 6: Distribution Prep
- **Write the Show HN post.** Lead with the problem, not the technology. "I was building a dashboard that pulled from 5 APIs and realized I was spending more time matching users across systems than building features."
- **Record a 2-minute demo video.** Show entity resolution happening in real time. Post on Twitter, Reddit, HN.
- **Create the npm keyword game:** entity-resolution, cross-api, data-matching, typescript-entity-resolution. Own these searches.

### Day 7: Ship
- Push updated README, landing page, StackBlitz demo, and blog post.
- Post on HN, Twitter, r/typescript simultaneously.
- Set up analytics to track: npm installs, GitHub stars, StackBlitz sessions, blog reads.

---

## Final Verdict

**dpth has a real product buried inside an overambitious protocol.**

The entity resolution + temporal history combo for TypeScript is genuinely novel. No one else offers this as a lightweight npm package. That's a real gap in the market.

But the project is drowning in its own vision. The agent network, federated learning, credit economics, and inference routing are interesting ideas — but they're 18 months premature and they're actively hurting adoption by making the simple thing look complex.

**What to do:**
1. **Split the baby.** `dpth` = the lightweight library (entity, temporal, correlation). `dpth-protocol` or `dpth-network` = the ambitious distributed vision. Ship them separately.
2. **Position as a utility, not a platform.** "lodash for entity resolution" resonates. "distributed intelligence layer" does not.
3. **Show, don't tell.** One StackBlitz demo beats 10 pages of protocol spec.
4. **Find your first 100 real users** before building any more infrastructure. If 100 people use entity resolution in production, you have a foundation. If zero do, no amount of federated learning will save you.

The bones are good. The execution needs focus.

---

*This review is intentionally harsh. The goal is market truth, not encouragement. Good products survive honest feedback — great ones use it as fuel.*
