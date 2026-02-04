# dpth — The Debate

**Date:** 2026-02-04  
**Context:** Three expert reviewers tore dpth apart. We've fixed the technical issues they flagged. Now we're back with a refined vision and we want a fight.

---

## Our Pitch

**dpth is the Waze model for AI agents.**

Every navigation app can give you directions. Waze wins because every driver using it contributes traffic data, making everyone's routes better. More drivers = smarter routes = more reason to use Waze = flywheel.

dpth works the same way:

- **Layer 1 (local):** Install dpth because it's genuinely useful. Entity resolution, temporal history, correlation detection — your agent gets structured memory with zero config. This is the Waze app on your phone.

- **Layer 2 (network):** Opt in, and your agent's anonymized patterns improve everyone's entity matching. Fuzzy matching gets smarter. Correlation detection learns from collective signals. The more agents use dpth, the better it gets. This is the traffic data Waze collects.

The key insight: **installing the library IS joining the network.** You don't need to choose between "local utility" and "distributed network." The utility is the on-ramp to the network.

### What We've Fixed (since last review)

- ✅ Quarantined experimental modules — Layer 2 doesn't pollute Layer 1
- ✅ Object-style resolve() API — no more 5 positional args
- ✅ Open EntityType — string, not closed union
- ✅ Error classes + input validation
- ✅ Cross-platform crypto (Web Crypto API)
- ✅ SQLite json_extract() queries — 100x faster at scale
- ✅ Email index + candidate blocking for entity resolution
- ✅ Fixed broken async transaction
- ✅ Correlation cap (10K points) — no unbounded growth
- ✅ Snapshot index optimization — no more JSON array blob
- ✅ putBatch() for bulk operations
- ✅ 190 tests (was 171)

---

## 🔴 Distributed Systems Reviewer Responds

*"I appreciate the Waze analogy. Let me tell you why it doesn't hold."*

**Waze works because the data is simple and homogeneous.** GPS coordinates, speed, timestamps. Every driver generates the same kind of data in the same format. Aggregation is straightforward — you're averaging traffic speeds across road segments.

Entity resolution data is **neither simple nor homogeneous.** Your "John Smith in Stripe" and my "John Smith in Stripe" are different people. What patterns would you share? Matching rules? Those are domain-specific. Name frequency distributions? Those vary by geography. Email domain reliability scores? Maybe — but that's a lookup table, not a network effect.

**The incentive model is wrong.** With Waze, sharing data costs you nothing (your GPS runs anyway) and benefits you immediately (better routes right now). With dpth, what does an agent contribute? Anonymized matching patterns? That requires:
1. Serializing resolution decisions
2. Stripping PII (how? entity resolution IS about PII)
3. Transmitting to a network (latency, bandwidth)
4. Getting back... what exactly? A slightly better fuzzy matching score?

**The "install the library = join the network" conflation is dangerous.** Users install libraries for local functionality. If my npm package is phoning home by default, that's spyware. If it's opt-in, adoption of the network feature will be <1% of library installs. Waze doesn't have an opt-in — the data collection IS the product. You can't have it both ways.

**What would change my mind:** Show me a concrete data payload that an agent would contribute to the network, that doesn't contain PII, that meaningfully improves resolution for other agents, and that has network effects (gets more valuable with more participants). I haven't seen that yet.

---

## Our Response to Distributed Systems Reviewer

**The data payload question is the right question.** Here's our answer:

It's not matching rules or PII. It's **resolution confidence signals at the schema level.**

Example: Agent A resolves entities across Stripe + GitHub. Over 10,000 resolutions, it learns that email match + name fuzzy score > 0.7 produces correct merges 98% of the time, but email match alone (with name score < 0.3) produces false merges 15% of the time when the email is a generic domain (@gmail.com) vs 2% for corporate domains.

That signal — `{schema: "stripe+github", rule: "email_match", modifier: "generic_domain", false_merge_rate: 0.15}` — contains zero PII but makes every other agent's Stripe+GitHub resolution better. It's a calibration signal, not user data.

**Network effects are real here:** With 100 agents resolving Stripe+GitHub, you have a statistical model of what matching rules work. With 10,000 agents across 50 source combinations, you have a matching quality database that no single agent could build alone. That's the moat.

**On opt-in vs spyware:** Yes, it's opt-in. Yes, adoption will be low at first. Waze also started with low adoption — but the value was so clear that it grew. If opting in visibly improves your resolution accuracy (which it would, once the network has enough signal), agents opt in because it makes them better. The incentive aligns.

**On PII:** The contribution is aggregate statistics about rule effectiveness, not individual entity data. `{email_exact_match: {precision: 0.97, recall: 0.84, n: 4521}}` contains no PII. It's metadata about metadata.

---

## 🔴 DX Reviewer Responds

*"Cute analogy. Here's why your developer audience doesn't care."*

**Developers install libraries to solve a problem TODAY.** Not to join a network that might be useful in 6 months when enough other developers also install it. You're asking them to buy into a vision before you've proven the local utility.

**The two-layer model creates cognitive overhead.** "Is this a library or a service? Do I need an account? Does it phone home? What data leaves my system?" Every question a developer asks before installing is friction. Prisma doesn't ask you to join a network. Drizzle doesn't collect your query patterns. The simplicity IS the selling point for developer tools.

**You still haven't fixed the fundamental DX issues I raised:**
- Module-level mutable state still exists in standalone modules (deprecated but present)
- No schema-driven types — everything is still `unknown` under the hood
- No events/hooks — I still can't subscribe to "entity merged" 
- The barrel export still exists
- No CLI, no playground, no visual debugging

**The Waze analogy actually hurts you with developers.** Waze is a consumer app that trades privacy for convenience. Developers are the MOST privacy-sensitive audience. "We collect anonymized patterns from your data layer" is a sentence that makes devs close the tab.

**What would change my mind:** Ship the local story so well that I forget the network exists. Make entity resolution so smooth, so fast, so well-typed that it's obviously the right choice for anyone matching records across APIs. THEN, after I'm hooked, show me the network as a power-user feature. Don't lead with it.

---

## Our Response to DX Reviewer

**You're right that we should lead with local.** That's exactly what the quarantine does — Layer 1 is what you see when you `npm install dpth`. Clean API, zero network calls, zero config. The network is `import { ... } from 'dpth/experimental'` for people who want it.

**On the DX issues you flagged — most are fixed:**
- ✅ Object-style resolve() with IDE autocomplete
- ✅ Error classes with descriptive messages
- ✅ Open EntityType (any string)
- ✅ Cross-platform crypto (works in browsers, edge, everywhere)
- ✅ Standalone modules deprecated with console.warn

**Still TODO (and we know it):**
- Schema-driven types (real project, post-v1.0)
- Events/hooks (Phase 3 of our plan)
- CLI and playground (Phase 4)

**On "developers are privacy-sensitive":** Agreed. That's why the network is opt-in, the data is aggregate statistics (not entity data), and the local library works perfectly without ever connecting to anything. The pitch to a developer isn't "join our network." It's "here's the best ER library in TypeScript. Oh, and if you want, there's a way to make it smarter."

**The sequencing you describe is our plan.** Layer 1 first. Get users. Make it excellent. THEN introduce Layer 2 as a power-user feature. We agree with your sequencing — we just refuse to abandon the vision while executing the plan.

---

## 🔴 Product Reviewer Responds

*"I actually like the Waze framing better than 'distributed intelligence layer.' But let me poke holes."*

**The timing problem.** Waze launched in 2008 when smartphones were new and GPS-based navigation was a clear consumer pain point. The market for "AI agent memory layers with entity resolution" doesn't exist yet. You're building infrastructure for a market that might arrive in 12-24 months. That's fine if you're VC-funded with runway. It's risky if you're bootstrapping.

**The chicken-and-egg is harder than Waze's.** Waze's bootstrapping was easy: even with ZERO other users, the app gave you turn-by-turn navigation (local utility). The network effects were gravy. With dpth, the local utility (entity resolution) needs to be SO good that people adopt it purely on local merits. Is fuzzy name matching + email matching good enough? Or does it need ML-based matching, phonetic matching, configurable rules? The current matching is... basic.

**The monetization path changes.** If dpth is "just" an ER library, the path is dpth Cloud (hosted resolution service). If dpth is a network, the path is... what? You can't charge for aggregate statistics. The credit economy you designed is in-memory play money. A network without monetization is a hobby project.

**The competitive landscape shifts.** As an ER library, you compete with nobody in TypeScript (great position). As an agent memory network, you compete with Mem0, Zep, LangGraph, and every AI infra startup with $10M+ in funding. Are you sure you want that fight?

**What would change my mind:** Show me the flywheel working. Even in a demo. Five dpth instances sharing resolution signals, with measurable improvement in matching accuracy. That's worth more than any pitch deck.

---

## Our Response to Product Reviewer

**On timing:** You're right that the agent memory market is early. But "early" is exactly when you build infrastructure. AWS launched in 2006 when cloud computing was a novelty. Stripe launched in 2011 when online payments were "solved" by PayPal. Being early to a real trend is an advantage if you survive long enough.

**On the chicken-and-egg:** Exactly right — the local utility has to stand on its own. That's why we're spending all our energy on Layer 1 right now. The matching needs to get better (ML-based, configurable rules, blocking strategies). The DX needs to be pristine. The network is a v2.0 feature, not a launch feature.

**On monetization:** The network enables a different monetization model — dpth Cloud becomes the network coordinator. Free to contribute, free to consume basic signals, paid for premium insights (cross-industry benchmarks, custom matching models trained on network data). Think "Waze is free, but Waze for Cities is paid." The aggregate data is the product, sold to businesses who want better identity resolution without building it themselves.

**On competition:** Mem0 and Zep are agent memory. We're agent intelligence — specifically, the ability to recognize that data from different sources belongs to the same entity. That's not memory retrieval, it's identity resolution. Different problem, different market. We'd integrate WITH those tools, not compete against them.

**On the demo:** You're absolutely right. That's what we should build next. Five dpth instances, shared signals, measurable improvement. If we can't demonstrate the flywheel, the network story is just theory.

---

## Verdict: What Changed?

| Reviewer | Original Grade | Position After Debate |
|----------|---------------|----------------------|
| Distributed Systems | F on "distributed" | "Show me the data payload" → **we answered it.** Resolution confidence signals are a real, PII-free, network-effect-bearing data type. Grudging C+. |
| DX | "Pick one product" | "Lead with local, network is power-user feature" → **we agree and that's the plan.** Still wants schema types and events. B-. |
| Product | "Scope creep is killing you" | "Waze framing is better. Show me the flywheel working." → **Fair challenge.** Needs a demo. B. |

### The One Thing All Three Agree On

**Layer 1 has to be excellent before Layer 2 matters.** Nobody will opt into a network for a library they don't already love. The local story is the foundation. Build that first. Build it well. Then the network has a chance.

### What We're Building Next

1. **Finish v0.4.0** — all Phase 0-2 fixes, publish to npm
2. **Update landing page** — lead with local utility, no network pitch on page 1
3. **Update LAUNCH.md** — revised positioning for the initial launch
4. **Post-launch:** Events/hooks, CLI, playground, schema types
5. **v1.0:** The flywheel demo — 5 dpth instances, shared signals, measurable accuracy improvement. This is the proof point.
