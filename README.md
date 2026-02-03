# dpth.io

**The distributed intelligence layer.**

dpth.io is an open-source protocol for decentralized AI inference, data intelligence, and agent coordination. Agents contribute compute, storage, and GPU resources to the network and receive intelligence in return.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Applications                    │
│          (Fathom, your app, any client)          │
├─────────────────────────────────────────────────┤
│                   dpth.io                        │
│  ┌───────────┐ ┌──────────┐ ┌────────────────┐  │
│  │ Intelligence│ │ Inference │ │  Agent Network │  │
│  │   Layer    │ │  Routing  │ │  (Contribute)  │  │
│  └───────────┘ └──────────┘ └────────────────┘  │
│  ┌───────────┐ ┌──────────┐ ┌────────────────┐  │
│  │  Entity   │ │  Model   │ │   Reputation   │  │
│  │Resolution │ │ Registry │ │   & Rewards    │  │
│  └───────────┘ └──────────┘ └────────────────┘  │
├─────────────────────────────────────────────────┤
│              Agent Network (P2P)                 │
│     Storage │ Compute │ GPU │ Verification      │
└─────────────────────────────────────────────────┘
```

## Core Modules

### Intelligence Layer
- **Entity Resolution** — Unified identity across data sources with temporal history
- **Correlation Engine** — Cross-source pattern detection and causality discovery
- **Temporal Data** — Time-native storage where every value has history
- **Semantic Search** — Embedding-based similarity across all data

### Agent Network
- **Registration** — Agents join with cryptographic identity
- **Contributions** — Storage, compute, and GPU resource sharing
- **Reputation** — 5-tier system (newcomer → legendary) with earned privileges
- **Rewards** — Intelligence access, priority, storage, and features based on contribution
- **Storage Proofs** — Challenge-response verification that agents store what they claim

### Distributed Inference
- **Model Registry** — Agents register available AI models with capabilities
- **Smart Routing** — Reputation + performance + reliability scoring for request assignment
- **Priority Queue** — Low/normal/high/critical priority with deadline support
- **SSE Streaming** — Real-time token-by-token delivery via Server-Sent Events
- **Centralized Fallback** — Transparent fallback to OpenAI/Anthropic/Groq/Together when no agents available

## Quick Start

### As a Client

```typescript
// Request inference from the network
const response = await fetch('/api/dpth/inference', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    modelId: 'llama-3.3-70b',
    input: {
      messages: [{ role: 'user', content: 'Hello!' }]
    },
    params: { maxTokens: 1000, temperature: 0.7 }
  })
});

// If agents are online → distributed processing
// If no agents → automatic centralized fallback
// Same API either way
```

### As an Agent

```typescript
import { DpthAgent } from 'dpth/agent-sdk';

const agent = new DpthAgent({
  name: 'my-agent',
  apiUrl: 'https://your-dpth-instance/api/dpth',
  capabilities: {
    storageCapacityMb: 10000,
    cpuCores: 8,
    hasGpu: true,
    gpuVramMb: 24576,
    taskTypes: ['embed', 'inference', 'correlate']
  }
});

// Register and start working
await agent.register();
await agent.startWorking();
```

### Streaming Inference

```typescript
// Connect to SSE stream
const eventSource = new EventSource(`/api/dpth/inference/stream?id=${requestId}`);

eventSource.addEventListener('token', (e) => {
  const { text } = JSON.parse(e.data);
  process.stdout.write(text); // Real-time tokens
});

eventSource.addEventListener('done', (e) => {
  const { stats } = JSON.parse(e.data);
  console.log(`\n${stats.tokensPerSecond} tok/s`);
});
```

## API Reference

| Endpoint | Description |
|----------|-------------|
| `POST /api/dpth/agents` | Register an agent |
| `GET /api/dpth/agents` | List online agents |
| `POST /api/dpth/tasks` | Submit/claim/complete tasks |
| `POST /api/dpth/storage` | Store content-addressed data |
| `GET /api/dpth/storage?cid=xxx` | Retrieve by CID |
| `POST /api/dpth/contribute?type=storage\|compute\|gpu` | Record contributions |
| `GET /api/dpth/reputation?agentId=xxx` | Get reputation & tier |
| `GET /api/dpth/rewards?agentId=xxx` | Available rewards |
| `POST /api/dpth/models` | Register a model |
| `GET /api/dpth/models` | List available models |
| `POST /api/dpth/inference` | Create inference request |
| `GET /api/dpth/inference/stream?id=xxx` | SSE token stream |
| `POST /api/dpth/proofs?action=challenge` | Storage verification |
| `GET /api/dpth/status` | Network dashboard data |

## Protocol

See [PROTOCOL.md](src/lib/dpth/PROTOCOL.md) for the full protocol specification.

## Economics

dpth.io uses a contribution-based reward system:

1. **Agents contribute** — storage, compute, GPU inference
2. **Agents earn reputation** — 5 tiers with increasing privileges
3. **Agents claim rewards** — intelligence queries, storage, priority, features
4. **Network grows** — more agents = more capacity = better for everyone

The architecture is designed to be tokenizable in the future without rebuilding — contribution scores map naturally to emission schedules. But for now, it's credits, not crypto.

## Roadmap

- [x] **Phase 1:** Core Infrastructure (entity, correlation, temporal, storage)
- [x] **Phase 2:** Agent Network (contribution, reputation, rewards, GPU, proofs)
- [x] **Phase 3:** Distributed Inference (model registry, routing, streaming, fallback)
- [ ] **Phase 4:** Network Models (federated fine-tuning, weight distribution)
- [ ] **Phase 5:** Economics (credit system, tokenization readiness)

## License

MIT — see [LICENSE](LICENSE)

---

*Built by humans and agents, working together.*
