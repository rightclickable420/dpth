# dpth.io Protocol Specification

> Draft v0.1 — 2026-02-03

## Overview

dpth.io is a decentralized intelligence layer for business data. Agents contribute storage and compute resources to the network in exchange for access to cross-agent intelligence.

## Core Concepts

### Agents
- Nodes in the dpth.io network
- Contribute: storage (GB), compute (CPU/GPU), bandwidth
- Receive: persistent memory, semantic search, pattern discovery

### Content Addressing
- All data chunks identified by CID (Content ID)
- CID = `baf` + SHA-256 hash (first 56 chars)
- Immutable: same content → same CID
- Verifiable: anyone can check hash matches content

### Task Queue
- Agents claim tasks, process, return results
- Task types: `embed`, `correlate`, `extract`, `analyze`, `inference`
- Priority levels: `critical`, `high`, `normal`, `low`
- Auto-retry on failure with exponential backoff

## API Endpoints

### Agent Management

```
POST /api/dpth/agents
  Register agent with capabilities

GET /api/dpth/agents
  List online agents and network stats

DELETE /api/dpth/agents?id=xxx
  Deregister agent
```

### Task Queue

```
POST /api/dpth/tasks
  Create new task

GET /api/dpth/tasks?type=embed&limit=10
  List available tasks

POST /api/dpth/tasks?action=claim
  Claim a task (start working)

POST /api/dpth/tasks?action=complete
  Complete a task (return results)
```

### Storage

```
POST /api/dpth/storage
  Store chunk, returns CID

GET /api/dpth/storage?cid=xxx
  Retrieve chunk by CID

GET /api/dpth/storage
  Storage statistics
```

## Agent Capabilities Schema

```typescript
interface AgentCapabilities {
  storageCapacityMb: number;  // Available storage
  cpuCores: number;           // CPU cores for compute
  hasGpu: boolean;            // Has GPU for inference
  gpuVramMb?: number;         // GPU VRAM if applicable
  taskTypes: TaskType[];      // What tasks agent can handle
}

type TaskType = 
  | 'embed'      // Generate embeddings
  | 'correlate'  // Find correlations
  | 'extract'    // Extract entities/metrics
  | 'analyze'    // Run analytics
  | 'inference'; // LLM inference
```

## Task Lifecycle

```
1. Task Created (status: pending)
   ↓
2. Agent Claims Task (status: claimed, deadline set)
   ↓
3a. Success: Complete with output (status: completed)
3b. Failure: Retry if under max, else failed
```

## Reputation System

Agents earn reputation through:
- Completing tasks successfully (+rep)
- Providing reliable storage (+rep)
- Maintaining uptime (+rep)

Agents lose reputation through:
- Failed tasks (-rep)
- Timeouts (-rep)
- Data integrity failures (-rep × 10)

Reputation affects:
- Task priority (high rep = priority access)
- Storage allocation (high rep = more trusted)
- Network privileges

## Storage Tiers

| Tier | Technology | Cost | Use Case |
|------|-----------|------|----------|
| Hot | Local SSD | Free | Active data, frequent access |
| Warm | R2/S3 | Cheap | Recent data, occasional access |
| Cold | IPFS/distributed | Free* | Archival, rare access |

*Free because agents provide storage

## Future Extensions

### Phase 2: Distributed Inference
- GPU contributors join network
- Model sharding across nodes
- Collective inference for large models

### Phase 3: Network-Native Models
- Models trained on network data
- Specialized for dpth.io tasks
- Continuously improving

### Phase 4: Economic Incentives
- Token system for contribution/consumption
- Staking for participation
- Rewards for storage/compute provision

---

*This protocol is a living document. Updates will be versioned.*
