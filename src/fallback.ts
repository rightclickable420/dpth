/**
 * dpth.io Centralized Inference Fallback
 * 
 * When no agents are available to serve a model, routes to centralized
 * API providers (OpenAI, Anthropic, etc.) as a fallback.
 * 
 * Priority:
 * 1. Distributed network (free, agent-served)
 * 2. Centralized fallback (costs money, but always available)
 * 
 * The fallback is transparent to clients — same API, same format.
 */

// ─── Types ───────────────────────────────────────────

export interface FallbackProvider {
  id: string;
  name: string;
  /** Base URL for API */
  baseUrl: string;
  /** API key env var name */
  apiKeyEnv: string;
  /** Models this provider supports */
  models: FallbackModelMap[];
  /** Is this provider configured (has API key) */
  configured: boolean;
  /** Provider-specific headers */
  headers?: Record<string, string>;
}

interface FallbackModelMap {
  /** dpth.io model pattern (regex) */
  pattern: string;
  /** Provider's model ID */
  providerModel: string;
  /** Cost per 1M input tokens (USD) */
  inputCostPer1M?: number;
  /** Cost per 1M output tokens (USD) */
  outputCostPer1M?: number;
}

export interface FallbackRequest {
  modelId: string;
  messages?: Array<{ role: string; content: string }>;
  prompt?: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stream?: boolean;
}

export interface FallbackResponse {
  text: string;
  tokensGenerated: number;
  tokensPerSecond: number;
  latencyMs: number;
  provider: string;
  providerModel: string;
  cost?: {
    inputTokens: number;
    outputTokens: number;
    totalUsd: number;
  };
}

export interface FallbackStreamChunk {
  text: string;
  done: boolean;
}

// ─── Provider Registry ───────────────────────────────

const PROVIDERS: FallbackProvider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    configured: false,
    models: [
      { pattern: 'gpt-4o', providerModel: 'gpt-4o', inputCostPer1M: 2.5, outputCostPer1M: 10 },
      { pattern: 'gpt-4o-mini', providerModel: 'gpt-4o-mini', inputCostPer1M: 0.15, outputCostPer1M: 0.6 },
      { pattern: 'gpt-4-turbo', providerModel: 'gpt-4-turbo', inputCostPer1M: 10, outputCostPer1M: 30 },
      { pattern: 'o1', providerModel: 'o1', inputCostPer1M: 15, outputCostPer1M: 60 },
      { pattern: 'o3-mini', providerModel: 'o3-mini', inputCostPer1M: 1.1, outputCostPer1M: 4.4 },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    configured: false,
    headers: { 'anthropic-version': '2023-06-01' },
    models: [
      { pattern: 'claude-.*sonnet', providerModel: 'claude-sonnet-4-20250514', inputCostPer1M: 3, outputCostPer1M: 15 },
      { pattern: 'claude-.*haiku', providerModel: 'claude-3-5-haiku-20241022', inputCostPer1M: 0.8, outputCostPer1M: 4 },
      { pattern: 'claude-.*opus', providerModel: 'claude-3-opus-20240229', inputCostPer1M: 15, outputCostPer1M: 75 },
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
    configured: false,
    models: [
      { pattern: 'llama-3\\.3-70b', providerModel: 'llama-3.3-70b-versatile', inputCostPer1M: 0.59, outputCostPer1M: 0.79 },
      { pattern: 'llama-3\\.1-8b', providerModel: 'llama-3.1-8b-instant', inputCostPer1M: 0.05, outputCostPer1M: 0.08 },
      { pattern: 'mixtral', providerModel: 'mixtral-8x7b-32768', inputCostPer1M: 0.24, outputCostPer1M: 0.24 },
      { pattern: 'gemma-2-9b', providerModel: 'gemma2-9b-it', inputCostPer1M: 0.2, outputCostPer1M: 0.2 },
    ],
  },
  {
    id: 'together',
    name: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    apiKeyEnv: 'TOGETHER_API_KEY',
    configured: false,
    models: [
      { pattern: 'llama-3\\.3-70b', providerModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', inputCostPer1M: 0.88, outputCostPer1M: 0.88 },
      { pattern: 'qwen-2\\.5.*72b', providerModel: 'Qwen/Qwen2.5-72B-Instruct-Turbo', inputCostPer1M: 1.2, outputCostPer1M: 1.2 },
      { pattern: 'deepseek-v3', providerModel: 'deepseek-ai/DeepSeek-V3', inputCostPer1M: 0.9, outputCostPer1M: 0.9 },
      { pattern: 'qwen-2\\.5-coder-32b', providerModel: 'Qwen/Qwen2.5-Coder-32B-Instruct', inputCostPer1M: 0.8, outputCostPer1M: 0.8 },
    ],
  },
];

// ─── Core Functions ──────────────────────────────────

/**
 * Check which fallback providers are configured (have API keys)
 */
export function getConfiguredProviders(): FallbackProvider[] {
  return PROVIDERS.map(p => ({
    ...p,
    configured: !!process.env[p.apiKeyEnv],
  })).filter(p => p.configured);
}

/**
 * Find the best fallback provider for a model
 */
export function findFallbackProvider(modelId: string): {
  provider: FallbackProvider;
  providerModel: string;
  cost: { inputCostPer1M: number; outputCostPer1M: number };
} | null {
  const configured = getConfiguredProviders();
  
  for (const provider of configured) {
    for (const mapping of provider.models) {
      const regex = new RegExp(mapping.pattern, 'i');
      if (regex.test(modelId)) {
        return {
          provider,
          providerModel: mapping.providerModel,
          cost: {
            inputCostPer1M: mapping.inputCostPer1M || 0,
            outputCostPer1M: mapping.outputCostPer1M || 0,
          },
        };
      }
    }
  }
  
  return null;
}

/**
 * Execute a fallback inference request (non-streaming)
 */
export async function fallbackInference(request: FallbackRequest): Promise<FallbackResponse> {
  const match = findFallbackProvider(request.modelId);
  
  if (!match) {
    throw new Error(`No fallback provider available for model: ${request.modelId}`);
  }
  
  const { provider, providerModel, cost } = match;
  const apiKey = process.env[provider.apiKeyEnv]!;
  const startTime = Date.now();
  
  // Build request based on provider
  if (provider.id === 'anthropic') {
    return executeAnthropicRequest(provider, apiKey, providerModel, request, cost, startTime);
  }
  
  // OpenAI-compatible providers (OpenAI, Groq, Together)
  return executeOpenAIRequest(provider, apiKey, providerModel, request, cost, startTime);
}

/**
 * Execute a streaming fallback inference request
 * Returns an async generator of text chunks
 */
export async function* fallbackInferenceStream(
  request: FallbackRequest
): AsyncGenerator<FallbackStreamChunk> {
  const match = findFallbackProvider(request.modelId);
  
  if (!match) {
    throw new Error(`No fallback provider available for model: ${request.modelId}`);
  }
  
  const { provider, providerModel } = match;
  const apiKey = process.env[provider.apiKeyEnv]!;
  
  if (provider.id === 'anthropic') {
    yield* streamAnthropicRequest(provider, apiKey, providerModel, request);
  } else {
    yield* streamOpenAIRequest(provider, apiKey, providerModel, request);
  }
}

// ─── Provider Implementations ────────────────────────

async function executeOpenAIRequest(
  provider: FallbackProvider,
  apiKey: string,
  model: string,
  request: FallbackRequest,
  cost: { inputCostPer1M: number; outputCostPer1M: number },
  startTime: number
): Promise<FallbackResponse> {
  const messages = request.messages || [
    ...(request.system ? [{ role: 'system', content: request.system }] : []),
    { role: 'user', content: request.prompt || '' },
  ];
  
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(provider.headers || {}),
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature ?? 0.7,
      top_p: request.topP,
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`${provider.name} API error (${response.status}): ${error}`);
  }
  
  const data = await response.json();
  const latencyMs = Date.now() - startTime;
  const text = data.choices?.[0]?.message?.content || '';
  const inputTokens = data.usage?.prompt_tokens || 0;
  const outputTokens = data.usage?.completion_tokens || 0;
  
  return {
    text,
    tokensGenerated: outputTokens,
    tokensPerSecond: outputTokens / (latencyMs / 1000),
    latencyMs,
    provider: provider.id,
    providerModel: model,
    cost: {
      inputTokens,
      outputTokens,
      totalUsd: (inputTokens * cost.inputCostPer1M + outputTokens * cost.outputCostPer1M) / 1_000_000,
    },
  };
}

async function executeAnthropicRequest(
  provider: FallbackProvider,
  apiKey: string,
  model: string,
  request: FallbackRequest,
  cost: { inputCostPer1M: number; outputCostPer1M: number },
  startTime: number
): Promise<FallbackResponse> {
  const messages = request.messages?.filter(m => m.role !== 'system') || [
    { role: 'user', content: request.prompt || '' },
  ];
  
  const system = request.system || request.messages?.find(m => m.role === 'system')?.content;
  
  const response = await fetch(`${provider.baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      ...(provider.headers || {}),
    },
    body: JSON.stringify({
      model,
      messages,
      system,
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature ?? 0.7,
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`${provider.name} API error (${response.status}): ${error}`);
  }
  
  const data = await response.json();
  const latencyMs = Date.now() - startTime;
  const text = data.content?.map((c: { text: string }) => c.text).join('') || '';
  const inputTokens = data.usage?.input_tokens || 0;
  const outputTokens = data.usage?.output_tokens || 0;
  
  return {
    text,
    tokensGenerated: outputTokens,
    tokensPerSecond: outputTokens / (latencyMs / 1000),
    latencyMs,
    provider: provider.id,
    providerModel: model,
    cost: {
      inputTokens,
      outputTokens,
      totalUsd: (inputTokens * cost.inputCostPer1M + outputTokens * cost.outputCostPer1M) / 1_000_000,
    },
  };
}

async function* streamOpenAIRequest(
  provider: FallbackProvider,
  apiKey: string,
  model: string,
  request: FallbackRequest
): AsyncGenerator<FallbackStreamChunk> {
  const messages = request.messages || [
    ...(request.system ? [{ role: 'system', content: request.system }] : []),
    { role: 'user', content: request.prompt || '' },
  ];
  
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(provider.headers || {}),
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature ?? 0.7,
      stream: true,
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`${provider.name} streaming error (${response.status}): ${error}`);
  }
  
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');
  
  const decoder = new TextDecoder();
  let buffer = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') {
        yield { text: '', done: true };
        return;
      }
      
      try {
        const parsed = JSON.parse(data);
        const text = parsed.choices?.[0]?.delta?.content || '';
        if (text) {
          yield { text, done: false };
        }
      } catch {
        // Skip malformed chunks
      }
    }
  }
  
  yield { text: '', done: true };
}

async function* streamAnthropicRequest(
  provider: FallbackProvider,
  apiKey: string,
  model: string,
  request: FallbackRequest
): AsyncGenerator<FallbackStreamChunk> {
  const messages = request.messages?.filter(m => m.role !== 'system') || [
    { role: 'user', content: request.prompt || '' },
  ];
  
  const system = request.system || request.messages?.find(m => m.role === 'system')?.content;
  
  const response = await fetch(`${provider.baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      ...(provider.headers || {}),
    },
    body: JSON.stringify({
      model,
      messages,
      system,
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature ?? 0.7,
      stream: true,
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`${provider.name} streaming error (${response.status}): ${error}`);
  }
  
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');
  
  const decoder = new TextDecoder();
  let buffer = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      
      try {
        const parsed = JSON.parse(data);
        
        if (parsed.type === 'content_block_delta') {
          const text = parsed.delta?.text || '';
          if (text) {
            yield { text, done: false };
          }
        }
        
        if (parsed.type === 'message_stop') {
          yield { text: '', done: true };
          return;
        }
      } catch {
        // Skip malformed chunks
      }
    }
  }
  
  yield { text: '', done: true };
}

// ─── Status ──────────────────────────────────────────

/**
 * Get fallback status — which providers are available
 */
export function getFallbackStatus(): {
  available: boolean;
  providers: Array<{
    id: string;
    name: string;
    configured: boolean;
    modelCount: number;
  }>;
} {
  const providers = PROVIDERS.map(p => ({
    id: p.id,
    name: p.name,
    configured: !!process.env[p.apiKeyEnv],
    modelCount: p.models.length,
  }));
  
  return {
    available: providers.some(p => p.configured),
    providers,
  };
}
