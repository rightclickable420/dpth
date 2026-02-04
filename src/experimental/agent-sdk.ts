/**
 * dpth.io Agent SDK
 * 
 * Simple client for agents to participate in the dpth.io network.
 * Handles registration, heartbeat, task claiming, and result submission.
 * 
 * Usage:
 *   const agent = new DpthAgent({
 *     name: 'my-agent',
 *     apiUrl: 'https://api.dpth.io',
 *     capabilities: { storageCapacityMb: 1000, cpuCores: 4, ... }
 *   });
 *   
 *   await agent.register();
 *   await agent.startWorking();
 */

import { createHash, generateKeyPairSync, sign, verify } from 'crypto';

// ─── Types ───────────────────────────────────────────

export interface AgentCapabilities {
  storageCapacityMb: number;
  cpuCores: number;
  hasGpu: boolean;
  gpuVramMb?: number;
  taskTypes: ('embed' | 'correlate' | 'extract' | 'analyze' | 'inference')[];
}

/** Default coordinator URL */
export const DPTH_COORDINATOR_URL = 'https://api.dpth.io';

export interface AgentConfig {
  name: string;
  /** Coordinator URL (default: https://api.dpth.io) */
  apiUrl?: string;
  capabilities: AgentCapabilities;
  /** Private key for signing (generated if not provided) */
  privateKey?: string;
  /** Polling interval in ms (default: 5000) */
  pollIntervalMs?: number;
  /** Task handlers by type */
  handlers?: Partial<Record<string, TaskHandler>>;
}

export interface Task {
  id: string;
  type: string;
  priority: string;
  input: {
    cid?: string;
    data?: unknown;
    params?: Record<string, unknown>;
  };
  deadline?: string;
}

export type TaskHandler = (task: Task) => Promise<TaskResult>;

export interface TaskResult {
  success: boolean;
  output?: {
    cid?: string;
    data?: unknown;
  };
  error?: string;
}

// ─── Agent Class ─────────────────────────────────────

export class DpthAgent {
  private config: Required<AgentConfig>;
  private agentId: string | null = null;
  private publicKey: string;
  private privateKey: string;
  private running = false;
  private pollTimeout: ReturnType<typeof setTimeout> | null = null;
  
  constructor(config: AgentConfig) {
    // Generate key pair if not provided
    if (config.privateKey) {
      this.privateKey = config.privateKey;
      // Derive public key from private
      this.publicKey = this.derivePublicKey(config.privateKey);
    } else {
      const { publicKey, privateKey } = generateKeyPairSync('ed25519');
      this.privateKey = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
      this.publicKey = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    }
    
    this.config = {
      ...config,
      apiUrl: config.apiUrl || DPTH_COORDINATOR_URL,
      privateKey: this.privateKey,
      pollIntervalMs: config.pollIntervalMs || 5000,
      handlers: config.handlers || {},
    };
  }
  
  private derivePublicKey(privateKeyPem: string): string {
    // For ed25519, derive a compact public key identifier
    const hash = createHash('sha256').update(privateKeyPem).digest('hex');
    return `dpth:pub:${hash.slice(0, 32)}`;
  }
  
  /**
   * Get a header-safe version of the public key (base64, no PEM wrapping)
   */
  private getHeaderSafeKey(): string {
    // Strip PEM headers and newlines for HTTP header compatibility
    return this.publicKey
      .replace(/-----BEGIN.*?-----/g, '')
      .replace(/-----END.*?-----/g, '')
      .replace(/\n/g, '')
      .trim();
  }
  
  // ─── API Methods ─────────────────────────────────
  
  private async fetch(path: string, options?: RequestInit): Promise<Response> {
    const url = `${this.config.apiUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Id': this.agentId || '',
        'X-Public-Key': this.getHeaderSafeKey(),
        ...options?.headers,
      },
    });
    return response;
  }
  
  /**
   * Register this agent with the network
   */
  async register(): Promise<void> {
    const response = await this.fetch('/agents', {
      method: 'POST',
      body: JSON.stringify({
        name: this.config.name,
        publicKey: this.publicKey,
        capabilities: this.config.capabilities,
      }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Registration failed: ${error.error || response.statusText}`);
    }
    
    const result = await response.json();
    this.agentId = result.agent.id;
    console.log(`[dpth] Agent registered: ${this.agentId}`);
  }
  
  /**
   * Send heartbeat — tell the coordinator this agent is still alive.
   */
  async heartbeat(): Promise<void> {
    if (!this.agentId) return;
    await this.fetch(`/agents/${this.agentId}/heartbeat`, { method: 'POST' });
  }
  
  /**
   * Deregister from the network
   */
  async deregister(): Promise<void> {
    if (!this.agentId) return;
    
    await this.fetch(`/agents?id=${this.agentId}`, {
      method: 'DELETE',
    });
    
    this.agentId = null;
    console.log('[dpth] Agent deregistered');
  }
  
  /**
   * Fetch available tasks
   */
  async getTasks(limit = 10): Promise<Task[]> {
    const response = await this.fetch(`/tasks?status=pending`);
    
    if (!response.ok) {
      throw new Error('Failed to fetch tasks');
    }
    
    const result = await response.json();
    return result.tasks;
  }
  
  /**
   * Claim a task for processing
   */
  async claimTask(taskId: string): Promise<Task> {
    const response = await this.fetch(`/tasks/${taskId}/claim`, {
      method: 'POST',
      body: JSON.stringify({
        agentId: this.agentId,
      }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to claim task: ${error.error}`);
    }
    
    const result = await response.json();
    return result.task;
  }
  
  /**
   * Complete a task with results
   */
  async completeTask(taskId: string, result: TaskResult): Promise<void> {
    const response = await this.fetch(`/tasks/${taskId}/complete`, {
      method: 'POST',
      body: JSON.stringify({
        agentId: this.agentId,
        result: result.output,
        reward: 5,
      }),
    });
    
    if (!response.ok) {
      throw new Error('Failed to complete task');
    }
  }
  
  // ── Resolution Signals (The Waze Layer) ──────────

  /**
   * Submit a resolution signal — share how well a matching rule works.
   * This is the core of dpth's collective intelligence: agents share
   * anonymized statistics about entity matching, making everyone's
   * resolution smarter.
   * 
   * Example:
   *   await agent.submitSignal({
   *     schema: 'stripe+github',
   *     rule: 'email_exact_match',
   *     truePositives: 847,
   *     falsePositives: 12,
   *     totalAttempts: 859,
   *   });
   */
  async submitSignal(signal: {
    schema: string;
    rule: string;
    modifier?: string;
    truePositives: number;
    falsePositives: number;
    totalAttempts: number;
  }): Promise<{ id: string; precision: number }> {
    const response = await this.fetch('/signals', {
      method: 'POST',
      body: JSON.stringify({
        ...signal,
        agentId: this.agentId,
      }),
    });
    
    if (!response.ok) {
      throw new Error('Failed to submit signal');
    }
    
    const result = await response.json();
    return { id: result.signal.id, precision: result.signal.precision };
  }
  
  /**
   * Get calibration data — ask the network how well a matching rule works.
   * Returns aggregate precision from all contributing agents.
   * 
   * Example:
   *   const cal = await agent.getCalibration('stripe+github', 'email_exact_match');
   *   // { precision: 0.986, confidence: 0.859, contributorCount: 47 }
   */
  async getCalibration(schema: string, rule: string): Promise<{
    precision: number;
    confidence: number;
    totalAttempts: number;
    contributorCount: number;
  } | null> {
    const response = await this.fetch(
      `/signals/calibrate?schema=${encodeURIComponent(schema)}&rule=${encodeURIComponent(rule)}`
    );
    
    if (!response.ok) {
      throw new Error('Failed to get calibration');
    }
    
    const result = await response.json();
    return result.calibration;
  }

  // ── Storage ────────────────────────────────────────

  /**
   * Store a chunk, returns CID
   */
  async storeChunk(data: unknown): Promise<string> {
    const response = await this.fetch('/storage', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    
    if (!response.ok) {
      throw new Error('Failed to store chunk');
    }
    
    const result = await response.json();
    return result.cid;
  }
  
  /**
   * Retrieve a chunk by CID
   */
  async getChunk(cid: string): Promise<unknown> {
    const response = await this.fetch(`/storage?cid=${cid}`);
    
    if (!response.ok) {
      throw new Error('Chunk not found');
    }
    
    return response.json();
  }
  
  /**
   * Get pending storage proof challenges for this agent
   */
  async getPendingChallenges(): Promise<Array<{
    id: string;
    cid: string;
    nonce: string;
    expiresAt: string;
  }>> {
    const response = await this.fetch('/proofs?pending');
    
    if (!response.ok) {
      throw new Error('Failed to get pending challenges');
    }
    
    const result = await response.json();
    return result.pending.filter((c: { agentId: string }) => c.agentId === this.agentId);
  }
  
  /**
   * Submit a storage proof response
   * @param challengeId The challenge ID
   * @param proof SHA256(chunk_data + nonce)
   */
  async submitProof(challengeId: string, proof: string): Promise<{
    valid: boolean;
    stats: { successRate: number };
  }> {
    const response = await this.fetch('/proofs?action=respond', {
      method: 'POST',
      body: JSON.stringify({
        challengeId,
        agentId: this.agentId,
        proof,
      }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Proof submission failed: ${error.error}`);
    }
    
    return response.json();
  }
  
  /**
   * Generate a proof for a chunk + nonce
   * (Agents should use this to compute proofs from their local storage)
   */
  static computeProof(chunkData: string, nonce: string): string {
    // In browser/Node environments, use Web Crypto or Node crypto
    // This is a placeholder - agents implement their own
    const encoder = new TextEncoder();
    const data = encoder.encode(chunkData + nonce);
    // Note: Real implementation needs async crypto
    // This is just to show the interface
    throw new Error('Implement with crypto.subtle.digest or createHash');
  }
  
  // ─── Worker Loop ─────────────────────────────────
  
  /**
   * Start the work loop — continuously poll for and process tasks
   */
  async startWorking(): Promise<void> {
    if (this.running) return;
    if (!this.agentId) {
      await this.register();
    }
    
    this.running = true;
    console.log('[dpth] Starting work loop');
    
    this.pollLoop();
  }
  
  /**
   * Stop the work loop
   */
  stopWorking(): void {
    this.running = false;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
    console.log('[dpth] Stopped work loop');
  }
  
  private async pollLoop(): Promise<void> {
    if (!this.running) return;
    
    try {
      // Fetch available tasks
      const tasks = await this.getTasks(1);
      
      if (tasks.length > 0) {
        const task = tasks[0];
        await this.processTask(task);
      }
    } catch (error) {
      console.error('[dpth] Error in poll loop:', error);
    }
    
    // Schedule next poll
    this.pollTimeout = setTimeout(
      () => this.pollLoop(),
      this.config.pollIntervalMs
    );
  }
  
  private async processTask(task: Task): Promise<void> {
    console.log(`[dpth] Processing task ${task.id} (${task.type})`);
    
    try {
      // Claim the task
      const claimed = await this.claimTask(task.id);
      
      // Get handler for task type
      const handler = this.config.handlers[task.type];
      if (!handler) {
        throw new Error(`No handler for task type: ${task.type}`);
      }
      
      // Execute handler
      const result = await handler(claimed);
      
      // Complete the task
      await this.completeTask(task.id, result);
      
      console.log(`[dpth] Completed task ${task.id}`);
      
    } catch (error) {
      console.error(`[dpth] Task ${task.id} failed:`, error);
      
      // Report failure
      await this.completeTask(task.id, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
  
  // ─── Utilities ───────────────────────────────────
  
  /**
   * Get the agent's public key (for verification)
   */
  getPublicKey(): string {
    return this.publicKey;
  }
  
  /**
   * Get the agent's ID (after registration)
   */
  getAgentId(): string | null {
    return this.agentId;
  }
  
  /**
   * Check if agent is registered
   */
  isRegistered(): boolean {
    return this.agentId !== null;
  }
  
  /**
   * Check if work loop is running
   */
  isWorking(): boolean {
    return this.running;
  }
}

// ─── Built-in Task Handlers ──────────────────────────

/**
 * Default embedding handler using OpenAI-compatible API
 */
export function createEmbedHandler(apiKey: string, model = 'text-embedding-3-small'): TaskHandler {
  return async (task) => {
    const text = task.input.data as string;
    
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: text,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Embedding API failed: ${response.statusText}`);
    }
    
    const result = await response.json();
    return {
      success: true,
      output: {
        data: result.data[0].embedding,
      },
    };
  };
}

/**
 * Default extraction handler (simple regex-based)
 */
export function createExtractHandler(): TaskHandler {
  return async (task) => {
    const text = task.input.data as string;
    
    // Simple email extraction
    const emails = text.match(/[\w.-]+@[\w.-]+\.\w+/g) || [];
    
    // Simple number extraction
    const numbers = text.match(/\$?[\d,]+\.?\d*/g) || [];
    
    return {
      success: true,
      output: {
        data: {
          emails,
          numbers,
          length: text.length,
        },
      },
    };
  };
}
