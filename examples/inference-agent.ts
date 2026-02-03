#!/usr/bin/env npx tsx
/**
 * dpth.io Example: Real Inference Agent
 * 
 * A working agent that:
 * 1. Registers with the dpth.io network
 * 2. Connects to a local Ollama instance
 * 3. Claims inference tasks from the queue
 * 4. Runs inference locally and returns results
 * 5. Earns credits for each completed task
 * 
 * Requirements:
 * - Ollama running locally (https://ollama.ai)
 * - A dpth.io network endpoint
 * 
 * Usage:
 *   # Start Ollama first
 *   ollama serve
 *   ollama pull llama3.2:3b
 * 
 *   # Run the agent
 *   DPTH_API=http://localhost:3000/api/dpth npx tsx examples/inference-agent.ts
 * 
 *   # With custom Ollama URL
 *   OLLAMA_URL=http://192.168.1.100:11434 npx tsx examples/inference-agent.ts
 */

import { DpthAgent } from '../src/agent-sdk';

// ─── Configuration ───────────────────────────────────

const DPTH_API = process.env.DPTH_API || 'http://localhost:3000/api/dpth';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL || '5000');
const AGENT_NAME = process.env.AGENT_NAME || `inference-agent-${Date.now().toString(36)}`;

// ─── Ollama Client ───────────────────────────────────

interface OllamaModel {
  name: string;
  size: number;
  details: {
    parameter_size: string;
    quantization_level: string;
  };
}

interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
  total_duration: number;
  eval_count: number;
  eval_duration: number;
}

async function ollamaList(): Promise<OllamaModel[]> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
    const data = await res.json() as { models: OllamaModel[] };
    return data.models || [];
  } catch (e) {
    console.error(`[ollama] Failed to list models: ${(e as Error).message}`);
    return [];
  }
}

async function ollamaGenerate(
  model: string,
  prompt: string,
  options?: { temperature?: number; maxTokens?: number }
): Promise<{ text: string; tokensGenerated: number; durationMs: number }> {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: {
        temperature: options?.temperature ?? 0.7,
        num_predict: options?.maxTokens ?? 1024,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama error ${res.status}: ${body}`);
  }

  const data = await res.json() as OllamaGenerateResponse;
  return {
    text: data.response,
    tokensGenerated: data.eval_count || 0,
    durationMs: Math.round((data.total_duration || 0) / 1_000_000),
  };
}

async function ollamaChatGenerate(
  model: string,
  messages: Array<{ role: string; content: string }>,
  options?: { temperature?: number; maxTokens?: number }
): Promise<{ text: string; tokensGenerated: number; durationMs: number }> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: {
        temperature: options?.temperature ?? 0.7,
        num_predict: options?.maxTokens ?? 1024,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama error ${res.status}: ${body}`);
  }

  const data = await res.json() as {
    message: { content: string };
    eval_count: number;
    total_duration: number;
  };

  return {
    text: data.message.content,
    tokensGenerated: data.eval_count || 0,
    durationMs: Math.round((data.total_duration || 0) / 1_000_000),
  };
}

// ─── Agent Logic ─────────────────────────────────────

async function main() {
  console.log(`
╔══════════════════════════════════════════╗
║       dpth.io Inference Agent            ║
╚══════════════════════════════════════════╝
  `);

  // 1. Check Ollama is running
  console.log(`[init] Checking Ollama at ${OLLAMA_URL}...`);
  const models = await ollamaList();
  if (models.length === 0) {
    console.error('[init] No models found. Is Ollama running? Try: ollama serve && ollama pull llama3.2:3b');
    process.exit(1);
  }
  console.log(`[init] Found ${models.length} model(s):`);
  for (const m of models) {
    console.log(`       - ${m.name} (${m.details?.parameter_size || 'unknown'}, ${m.details?.quantization_level || 'unknown'})`);
  }

  // 2. Create dpth.io agent
  const agent = new DpthAgent({
    name: AGENT_NAME,
    apiUrl: DPTH_API,
    capabilities: {
      storageCapacityMb: 1000,
      cpuCores: navigator?.hardwareConcurrency || 4,
      hasGpu: true, // Ollama handles GPU detection
      taskTypes: ['inference'],
    },
  });

  console.log(`[init] Agent: ${AGENT_NAME}`);
  console.log(`[init] Public key: ${agent.getPublicKey().slice(0, 16)}...`);
  console.log(`[init] dpth.io API: ${DPTH_API}`);

  // 3. Register with dpth.io network
  console.log('[init] Registering with dpth.io network...');
  try {
    await agent.register();
    console.log(`[init] Registered! Agent ID: ${agent.getAgentId()}`);
  } catch (e) {
    console.warn(`[init] Registration failed (network may be offline): ${(e as Error).message}`);
    console.log('[init] Running in standalone mode — inference only, no credit earning.');
  }

  // 4. Register available models
  const modelNames = models.map(m => m.name);
  console.log(`[models] Registering ${modelNames.length} model(s) with network...`);
  for (const model of models) {
    try {
      const res = await fetch(`${DPTH_API}/models`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-Id': agent.getAgentId() || AGENT_NAME,
          'X-Agent-Key': agent.getPublicKey(),
        },
        body: JSON.stringify({
          modelId: model.name,
          capabilities: ['text-generation'],
          maxContextLength: 4096,
          quantization: model.details?.quantization_level,
        }),
      });
      if (res.ok) {
        console.log(`[models] Registered: ${model.name}`);
      }
    } catch {
      // Network may be offline — that's fine
    }
  }

  // 5. Start work loop
  console.log(`\n[work] Starting inference loop (polling every ${POLL_INTERVAL_MS / 1000}s)...\n`);
  
  let tasksCompleted = 0;
  let totalTokens = 0;

  // Also accept direct inference via stdin for testing
  if (process.stdin.isTTY) {
    console.log('[interactive] Type a prompt and press Enter for direct inference.');
    console.log(`[interactive] Using model: ${modelNames[0]}`);
    console.log('');
    
    const readline = await import('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    
    rl.on('line', async (line: string) => {
      const prompt = line.trim();
      if (!prompt) return;
      if (prompt === 'quit' || prompt === 'exit') {
        console.log('\n[shutdown] Agent shutting down...');
        await agent.stopWorking().catch(() => {});
        process.exit(0);
      }
      
      console.log(`\n[inference] Processing with ${modelNames[0]}...`);
      const start = Date.now();
      
      try {
        const result = await ollamaChatGenerate(modelNames[0], [
          { role: 'user', content: prompt },
        ]);
        
        tasksCompleted++;
        totalTokens += result.tokensGenerated;
        const tokPerSec = result.tokensGenerated / (result.durationMs / 1000);
        
        console.log(`\n${result.text}\n`);
        console.log(`[stats] ${result.tokensGenerated} tokens in ${result.durationMs}ms (${tokPerSec.toFixed(1)} tok/s)`);
        console.log(`[stats] Total: ${tasksCompleted} tasks, ${totalTokens} tokens\n`);
      } catch (e) {
        console.error(`[error] ${(e as Error).message}`);
      }
    });
  }

  // Poll for network tasks
  async function pollForTasks() {
    try {
      const res = await fetch(`${DPTH_API}/tasks?type=inference&limit=1`, {
        headers: {
          'X-Agent-Id': agent.getAgentId() || AGENT_NAME,
          'X-Agent-Key': agent.getPublicKey(),
        },
      });
      
      if (!res.ok) return;
      const data = await res.json() as { tasks?: Array<{
        id: string;
        input: { messages?: Array<{ role: string; content: string }>; prompt?: string; model?: string };
        params?: { temperature?: number; maxTokens?: number };
      }> };
      
      if (!data.tasks || data.tasks.length === 0) return;
      
      for (const task of data.tasks) {
        console.log(`[task] Claimed task ${task.id}`);
        
        // Claim the task
        await fetch(`${DPTH_API}/tasks?action=claim`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Agent-Id': agent.getAgentId() || AGENT_NAME,
            'X-Agent-Key': agent.getPublicKey(),
          },
          body: JSON.stringify({ taskId: task.id }),
        });
        
        // Run inference
        const model = task.input.model || modelNames[0];
        let result;
        
        if (task.input.messages) {
          result = await ollamaChatGenerate(model, task.input.messages, task.params);
        } else if (task.input.prompt) {
          result = await ollamaGenerate(model, task.input.prompt, task.params);
        } else {
          console.warn(`[task] ${task.id} has no messages or prompt, skipping`);
          continue;
        }
        
        // Complete the task
        await fetch(`${DPTH_API}/tasks?action=complete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Agent-Id': agent.getAgentId() || AGENT_NAME,
            'X-Agent-Key': agent.getPublicKey(),
          },
          body: JSON.stringify({
            taskId: task.id,
            output: {
              text: result.text,
              tokensGenerated: result.tokensGenerated,
              model,
              durationMs: result.durationMs,
            },
          }),
        });
        
        tasksCompleted++;
        totalTokens += result.tokensGenerated;
        console.log(`[task] Completed ${task.id}: ${result.tokensGenerated} tokens in ${result.durationMs}ms`);
      }
    } catch {
      // Silently ignore poll errors (network may be down)
    }
  }

  // Start polling
  setInterval(pollForTasks, POLL_INTERVAL_MS);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[shutdown] Agent shutting down...');
    console.log(`[shutdown] Session stats: ${tasksCompleted} tasks, ${totalTokens} tokens`);
    try {
      await agent.stopWorking();
    } catch {}
    process.exit(0);
  });
}

main().catch(e => {
  console.error(`[fatal] ${e.message}`);
  process.exit(1);
});
