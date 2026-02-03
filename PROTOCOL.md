# dpth.io Protocol Specification

> v0.5 — 2026-02-03

## Overview

dpth.io is an open-source distributed intelligence layer. Agents contribute storage, compute, and GPU resources to the network and receive access to cross-source intelligence, distributed inference, and network-trained models in return.

The protocol covers five layers:
1. **Core Infrastructure** — entity resolution, correlation, temporal data, content-addressed storage
2. **Agent Network** — registration, contributions, reputation, rewards, storage proofs
3. **Distributed Inference** — model registry, smart routing, streaming, centralized fallback
4. **Federated Learning** — training coordination, weight deltas, Byzantine-tolerant aggregation
5. **Economics** — credit system, rate limiting, dynamic pricing, migration snapshots

---

## 1. Core Infrastructure

### Agents

Agents are nodes in the dpth.io network. Each agent has:
- A **cryptographic identity** (Ed25519 keypair, generated on first run)
- **Capabilities** describing what it can contribute
- A **reputation tier** (earned through contributions)

```typescript
interface AgentCapabilities {
  storageCapacityMb: number;
  cpuCores: number;
  hasGpu: boolean;
  gpuVramMb?: number;
  taskTypes: TaskType[];
}

type TaskType = 'embed' | 'correlate' | 'extract' | 'analyze' | 'inference' | 'train' | 'store' | 'replicate' | 'query';
```

### Content-Addressed Storage (CAS)

All data is stored by content hash:
- **CID** = `baf` + first 56 chars of SHA-256 hex digest
- Immutable: same content always produces the same CID
- Verifiable: any node can check hash matches content
- Cacheable: CIDs can be cached forever (content never changes)

### Entity Resolution

Unified identity across data sources:
- `resolveOrCreate(type, name, source, externalId)` — find or create an entity
- Entities have temporal history (every attribute change is tracked)
- Cross-source matching by external ID, email, or alias signals
- Entity types: `person`, `company`, `product`, `project`, custom

### Correlation Engine

Cross-source pattern detection:
- Metrics registered with `(id, entityId, name, aggregation)`
- Time-series data points with `(timestamp, value, source, confidence)`
- Automatic correlation discovery between metrics
- Anomaly detection on metric streams

### Temporal Data

Every value has history:
- `takeSnapshot(subjectId, data)` — capture state at a point in time
- `getSnapshots(subjectId)` — retrieve full history
- `diffSnapshots(a, b)` — detect what changed between two states
- All diffs include `added`, `removed`, `changed`, `unchanged` fields

---

## 2. Agent Network

### Registration

Agents register via `POST /api/dpth/agents` with:
- Name, capabilities, public key
- Signed request (body signature with Ed25519 private key)
- Returns: agent ID, registration timestamp

### Contributions

Agents earn reputation and credits by contributing:

| Type | What | Scoring |
|------|------|---------|
| **Storage** | Disk space for CAS chunks | 1 credit/MB/day, proof bonus |
| **Compute** | CPU cycles for tasks | 10 credits/task |
| **GPU** | Inference/training workloads | 25 base + 5/1k tokens generated |

Contributions are recorded via `POST /api/dpth/contribute?type=storage|compute|gpu`.

### Reputation System

Five tiers with increasing privileges:

| Tier | Score Range | Privileges |
|------|------------|------------|
| **Newcomer** | 0–99 | Basic access, 10 queries/hr |
| **Contributor** | 100–499 | 50 queries/hr, priority tasks |
| **Trusted** | 500–1999 | 200 queries/hr, can train models, can transfer credits |
| **Elite** | 2000–9999 | 1000 queries/hr, governance votes |
| **Legendary** | 10000+ | Unlimited, all privileges |

Reputation is earned through:
- Successful task completion (+rep)
- Reliable storage uptime (+rep)
- Storage proof verification (+rep)
- Training round participation (+rep)

Reputation is lost through:
- Failed tasks (-rep)
- Timeouts (-rep)
- Data integrity failures (-10x rep)
- Byzantine training behavior (-rep)

### Storage Proofs

Challenge-response verification that agents store what they claim:

1. **Challenge**: Network selects a random CID assigned to the agent
2. **Request**: Agent must return the content within a deadline
3. **Verify**: Hash of returned content must match the CID
4. **Reward/Penalty**: Correct proof earns bonus credits; failure triggers penalty

### Rewards

Agents claim rewards based on reputation tier:
- Intelligence access (queries, inference)
- Storage allocation
- Task priority
- Feature access (training, transfers)
- Credits (earned through contributions)

---

## 3. Distributed Inference

### Model Registry

Agents register available AI models:

```typescript
interface ModelRegistration {
  agentId: string;
  modelId: string;          // e.g., 'llama-3.3-70b'
  capabilities: string[];   // ['text-generation', 'embeddings']
  maxContextLength: number;
  quantization?: string;    // 'q4_0', 'q8_0', 'fp16'
  tokensPerSecond?: number; // Benchmarked throughput
}
```

### Smart Routing

Inference requests are routed using a weighted scoring algorithm:

```
score = reputation(40%) + performance(30%) + reliability(30%)
```

- **Reputation**: Agent's tier score (normalized 0-1)
- **Performance**: Measured tokens/second (normalized against model median)
- **Reliability**: Success rate over last 100 requests

For non-critical requests, top-3 agents are selected randomly (weighted by score) to prevent hot-spotting.

### Priority Queue

Requests are queued with priority levels:

| Priority | Use Case | Max Wait |
|----------|----------|----------|
| `critical` | Real-time user-facing | 5s |
| `high` | Background enrichment | 30s |
| `normal` | Batch processing | 5min |
| `low` | Opportunistic | 1hr |

### SSE Streaming

Real-time token delivery via Server-Sent Events:

```
GET /api/dpth/inference/stream?id=<requestId>

event: token
data: {"text": "Hello", "index": 0}

event: token
data: {"text": " world", "index": 1}

event: done
data: {"stats": {"tokensGenerated": 150, "tokensPerSecond": 42.3, "agentId": "..."}}

event: error
data: {"message": "Agent timeout, retrying..."}
```

### Centralized Fallback

When no agents are available, requests transparently route to centralized providers:

| Provider | Models | Priority |
|----------|--------|----------|
| OpenAI | GPT-4o, GPT-4o-mini | 1 |
| Anthropic | Claude Sonnet, Haiku | 2 |
| Groq | Llama 3.3 70B | 3 |
| Together | Mixtral, CodeLlama | 4 |

The API is identical — callers don't need to know whether inference ran on the agent network or a fallback provider. Fallback is a bridge, not a crutch — as the network grows, fallback usage should approach zero.

---

## 4. Federated Learning

### Overview

Agents collaboratively fine-tune models without sharing raw data. Only weight deltas (LoRA adapters) are exchanged.

### Training Round Lifecycle

```
1. Coordinator creates round (base model, config, deadline)
     ↓
2. Eligible agents claim the round (trusted tier+)
     ↓
3. Each agent fine-tunes locally on their data
     ↓
4. Agents upload weight deltas (LoRA adapters) with metadata
     ↓
5. Coordinator validates deltas (norm clipping, anomaly detection)
     ↓
6. Coordinator aggregates valid deltas (federated averaging)
     ↓
7. New model version published to network via CAS
     ↓
8. Agents earn training credits
```

### Training Configuration

```typescript
interface TrainingConfig {
  learningRate: number;        // e.g., 0.0001
  localEpochs: number;        // e.g., 3
  batchSize: number;           // e.g., 8
  loraRank: number;            // e.g., 16
  loraAlpha: number;           // e.g., 32
  targetModules: string[];     // e.g., ['q_proj', 'v_proj']
  maxGradNorm: number;         // For gradient clipping
  dpEpsilon?: number;          // Differential privacy budget
  taskTypes: string[];         // What to train on
  minLocalExamples: number;    // Minimum data to participate
}
```

### Weight Delta Format

```typescript
interface WeightDelta {
  cid: string;                 // Content address of the delta
  agentId: string;
  roundId: string;
  format: {
    rank: number;              // LoRA rank
    alpha: number;             // LoRA alpha
    targetModules: string[];   // Which layers were adapted
    dtype: 'float16' | 'float32' | 'bfloat16';
  };
  sizeBytes: number;
  l2Norm: number;              // For anomaly detection
  trainingExamples: number;    // How much local data was used
}
```

### Delta Validation

Before aggregation, each delta is validated:

1. **Norm check**: L2 norm must be within `maxGradNorm × localEpochs × 2`
2. **Format check**: LoRA rank and alpha must match round config
3. **Data check**: Training examples must meet minimum threshold
4. **Anomaly score**: Composite score (0-1) based on norm, size, data volume
5. **Threshold**: Deltas with anomaly score > 0.8 are rejected

### Aggregation Methods

| Method | Description | Byzantine Tolerance |
|--------|-------------|-------------------|
| `fedavg` | Weighted average by training examples | Low — one bad actor can poison |
| `fedmedian` | Coordinate-wise median | **High** — tolerates up to 50% bad actors |
| `trimmed_mean` | Remove top/bottom 10%, average rest | Medium — tolerates ~20% bad actors |

Default: `fedmedian` (most Byzantine-tolerant).

### Differential Privacy

When `dpEpsilon` is configured:
- Gaussian noise is calibrated to `sensitivity / epsilon`
- Added to aggregated weights before publishing
- Lower epsilon = more privacy, more noise
- Recommended: epsilon 1-10 for utility, <1 for strong privacy

### Model Versioning

Models are versioned with full lineage:
- `version 1` = base model (uploaded, no training)
- `version N` = base model + aggregated adapters from N-1 training rounds
- Each version references its parent and contributing round IDs
- Model weights stored as CIDs (content-addressed, immutable)

---

## 5. Economics

### Credit System

Credits are the unit of exchange in the dpth.io network:
- **Minted** when agents contribute (storage, compute, GPU, training)
- **Burned** when agents consume (queries, inference)
- **Transferred** between agents (trusted tier+)

### Earning Rates

| Action | Base Credits | Tier Multiplier |
|--------|-------------|-----------------|
| Storage (per MB/day) | 1 | Yes |
| Compute task | 10 | Yes |
| GPU inference task | 25 | Yes |
| GPU per 1k tokens | 5 | Yes |
| GPU per image | 15 | Yes |
| Storage proof bonus | 5 | Yes |
| Training round | 50 | Yes |

Tier multipliers: Newcomer 1.0x, Contributor 1.2x, Trusted 1.5x, Elite 2.0x, Legendary 3.0x.

### Spending Rates

| Action | Base Cost | Dynamic Pricing |
|--------|-----------|-----------------|
| Intelligence query | 1 | Yes |
| Inference request | 10 | Yes |
| Inference per 1k tokens | 2 | Yes |

### Rate Limiting

Per-tier hourly limits:

| Tier | Queries/hr | Inference/hr | Max Transaction |
|------|-----------|-------------|-----------------|
| Newcomer | 10 | 5 | 100 |
| Contributor | 50 | 20 | 500 |
| Trusted | 200 | 100 | 2,000 |
| Elite | 1,000 | 500 | 10,000 |
| Legendary | Unlimited | Unlimited | Unlimited |

Windows reset hourly. Rate limits are enforced independently of credit balance.

### Dynamic Pricing

Prices adjust based on network demand:

```
utilization = transactions_24h / (agent_count × 100 × 24)

if utilization < 0.5:  multiplier = 0.5 + utilization     (discount)
if 0.5 ≤ util < 0.8:  multiplier = 1.0                    (normal)
if utilization ≥ 0.8:  multiplier = 1 + (util - 0.8) × 10 (premium, up to 3x)
```

This incentivizes supply when demand is high and encourages usage when demand is low.

### Transfer Rules

- Requires **trusted tier** or above
- Subject to tier's max transaction size
- Creates paired debit/credit transactions
- Fully auditable in the append-only ledger

### Penalties

Applied for bad behavior:
- Failed storage proofs
- Submitting garbage training deltas
- Repeated task timeouts

Penalties reduce both balance and claimable credits.

### Migration Snapshots

The credit system is designed for future tokenization:
- `createMigrationSnapshot()` captures all agent balances at a point in time
- Each agent's `claimableCredits` maps to future token claims
- Snapshot includes: balance, timestamp, snapshot ID
- Multiple snapshots can be taken (e.g., quarterly)
- Contribution scores map naturally to emission schedules

This means the network can start with credits (no regulatory overhead) and upgrade to tokens later without rebuilding the economics.

### Network Health Metrics

- **Total supply**: minted, burned, circulating
- **Velocity**: transactions in last 24 hours
- **Gini coefficient**: wealth distribution (0 = equal, 1 = concentrated)
- **Active agents**: agents with activity in last 24 hours

---

## API Reference

### Core

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/dpth/agents` | POST | Register agent |
| `/api/dpth/agents` | GET | List online agents |
| `/api/dpth/tasks` | POST | Create/claim/complete tasks |
| `/api/dpth/storage` | POST | Store content (returns CID) |
| `/api/dpth/storage` | GET | Retrieve by CID |
| `/api/dpth/status` | GET | Network dashboard data |

### Agent Network

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/dpth/contribute` | POST | Record contribution (storage/compute/GPU) |
| `/api/dpth/reputation` | GET | Get agent reputation + tier |
| `/api/dpth/rewards` | GET | Available rewards for agent |
| `/api/dpth/proofs` | POST | Storage proof challenge/verify |

### Inference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/dpth/models` | POST | Register model |
| `/api/dpth/models` | GET | List available models |
| `/api/dpth/inference` | POST | Create inference request |
| `/api/dpth/inference/stream` | GET | SSE token stream |

### Economics

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/dpth/credits?action=earn` | POST | Record credit earnings |
| `/api/dpth/credits?action=spend` | POST | Spend credits |
| `/api/dpth/credits?agentId=xxx` | GET | Agent balance + history |
| `/api/dpth/credits?leaderboard` | GET | Top earners |
| `/api/dpth/credits?supply` | GET | Network supply stats |
| `/api/dpth/credits?rates` | GET | Current earning/spending rates |

---

## Security Model

### Authentication
- Agents authenticate via Ed25519 signatures
- Request bodies are signed with the agent's private key
- Public key is registered on first join

### Data Privacy
- Federated learning: only weight deltas leave the agent, never raw data
- Differential privacy noise protects individual contributions
- Storage proofs verify without exposing content (hash-based)

### Byzantine Tolerance
- Federated median aggregation tolerates up to 50% malicious participants
- Anomaly detection on weight deltas catches outliers
- Reputation penalties disincentivize bad behavior
- Tier gating prevents newcomers from accessing sensitive operations

### Threat Model
- **Sybil attacks**: Mitigated by reputation requirements (time + contributions needed)
- **Free riding**: Rate limits + credit costs prevent pure consumption
- **Model poisoning**: Norm clipping + anomaly detection + median aggregation
- **Data exfiltration**: No raw data leaves agents; only CIDs, deltas, and queries

---

*This protocol is a living document. Version history tracked in git.*
*Built by humans and agents, working together.*
