/**
 * dpth.io Model Registry API
 * 
 * Agents register which AI models they can serve.
 * Clients query available models and their capabilities.
 * 
 * POST /api/dpth/models - Register a model
 * GET /api/dpth/models - List available models
 * GET /api/dpth/models?model=xxx - Get model details and available agents
 * DELETE /api/dpth/models - Remove agent's model
 */

import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs/promises';
import * as path from 'path';

// ─── Types ───────────────────────────────────────────

type ModelType = 'llm' | 'embedding' | 'image' | 'audio' | 'vision' | 'multimodal';

interface ModelCapabilities {
  /** Model type */
  type: ModelType;
  /** Maximum context length (for LLMs) */
  maxContextLength?: number;
  /** Maximum tokens to generate */
  maxOutputTokens?: number;
  /** Embedding dimensions (for embedding models) */
  embeddingDimensions?: number;
  /** Supported image sizes (for image models) */
  imageSizes?: string[];
  /** Supports streaming */
  streaming: boolean;
  /** Supports function calling */
  functionCalling?: boolean;
  /** Supports vision (image input) */
  vision?: boolean;
  /** Languages supported */
  languages?: string[];
}

interface ModelProvider {
  agentId: string;
  /** When agent registered this model */
  registeredAt: string;
  /** Last heartbeat for this model */
  lastSeen: string;
  /** Agent's current status */
  status: 'online' | 'offline' | 'busy';
  /** Performance stats */
  stats: {
    requestsServed: number;
    avgLatencyMs: number;
    avgTokensPerSecond: number;
    errorRate: number;
  };
  /** Agent's reputation score */
  reputation: number;
  /** Hardware info */
  hardware: {
    gpuModel?: string;
    vramMb?: number;
    quantization?: string; // e.g., "q4_k_m", "fp16"
  };
}

interface RegisteredModel {
  /** Model identifier (e.g., "llama-3.3-70b", "qwen-2.5-coder-32b") */
  modelId: string;
  /** Human-readable name */
  name: string;
  /** Model family/base */
  family: string;
  /** Parameter count (billions) */
  parametersBillions?: number;
  /** Model capabilities */
  capabilities: ModelCapabilities;
  /** Agents serving this model */
  providers: ModelProvider[];
  /** Total requests served across all providers */
  totalRequests: number;
}

interface ModelRegistry {
  models: Record<string, RegisteredModel>;
  /** Last update timestamp */
  updatedAt: string;
}

// ─── Storage ─────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR || 'data';
const MODELS_FILE = path.join(DATA_DIR, 'dpth', 'models.json');
const REPUTATION_FILE = path.join(DATA_DIR, 'dpth', 'reputation.json');

async function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

async function loadModels(): Promise<ModelRegistry> {
  try {
    const data = await fs.readFile(MODELS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {
      models: {},
      updatedAt: new Date().toISOString(),
    };
  }
}

async function saveModels(registry: ModelRegistry): Promise<void> {
  registry.updatedAt = new Date().toISOString();
  await ensureDir(MODELS_FILE);
  await fs.writeFile(MODELS_FILE, JSON.stringify(registry, null, 2));
}

async function getAgentReputation(agentId: string): Promise<number> {
  try {
    const data = await fs.readFile(REPUTATION_FILE, 'utf-8');
    const reputation = JSON.parse(data);
    return reputation.agents?.[agentId]?.score || 50;
  } catch {
    return 50;
  }
}

// ─── Helpers ─────────────────────────────────────────

function inferModelType(modelId: string): ModelType {
  const id = modelId.toLowerCase();
  if (id.includes('embed') || id.includes('bge') || id.includes('e5-')) return 'embedding';
  if (id.includes('stable-diffusion') || id.includes('sdxl') || id.includes('flux')) return 'image';
  if (id.includes('whisper') || id.includes('audio')) return 'audio';
  if (id.includes('vision') || id.includes('vl')) return 'vision';
  if (id.includes('pixtral') || id.includes('llava')) return 'multimodal';
  return 'llm';
}

function extractModelFamily(modelId: string): string {
  const id = modelId.toLowerCase();
  if (id.includes('llama')) return 'llama';
  if (id.includes('qwen')) return 'qwen';
  if (id.includes('mistral')) return 'mistral';
  if (id.includes('gemma')) return 'gemma';
  if (id.includes('phi')) return 'phi';
  if (id.includes('deepseek')) return 'deepseek';
  if (id.includes('codestral')) return 'codestral';
  if (id.includes('claude')) return 'claude';
  if (id.includes('gpt')) return 'gpt';
  if (id.includes('bge')) return 'bge';
  if (id.includes('e5')) return 'e5';
  return 'other';
}

// Mark offline providers (not seen in 2 minutes)
function updateProviderStatuses(model: RegisteredModel): void {
  const now = Date.now();
  const offlineThreshold = 2 * 60 * 1000; // 2 minutes
  
  for (const provider of model.providers) {
    if (now - new Date(provider.lastSeen).getTime() > offlineThreshold) {
      provider.status = 'offline';
    }
  }
}

// ─── Handlers ────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const modelId = searchParams.get('model');
    const type = searchParams.get('type') as ModelType | null;
    const available = searchParams.get('available');
    
    const registry = await loadModels();
    
    // Update all provider statuses
    for (const model of Object.values(registry.models)) {
      updateProviderStatuses(model);
    }
    
    // Return specific model details
    if (modelId) {
      const model = registry.models[modelId];
      if (!model) {
        return NextResponse.json({ error: 'Model not found' }, { status: 404 });
      }
      
      const onlineProviders = model.providers.filter(p => p.status === 'online');
      
      return NextResponse.json({
        ...model,
        availableProviders: onlineProviders.length,
        providers: model.providers.map(p => ({
          agentId: p.agentId,
          status: p.status,
          stats: p.stats,
          reputation: p.reputation,
          hardware: p.hardware,
        })),
      });
    }
    
    // Filter models
    let models = Object.values(registry.models);
    
    if (type) {
      models = models.filter(m => m.capabilities.type === type);
    }
    
    if (available !== null) {
      // Only return models with online providers
      models = models.filter(m => m.providers.some(p => p.status === 'online'));
    }
    
    // Return model list
    return NextResponse.json({
      models: models.map(m => {
        const onlineProviders = m.providers.filter(p => p.status === 'online');
        return {
          modelId: m.modelId,
          name: m.name,
          family: m.family,
          type: m.capabilities.type,
          parametersBillions: m.parametersBillions,
          providerCount: m.providers.length,
          availableProviders: onlineProviders.length,
          totalRequests: m.totalRequests,
          streaming: m.capabilities.streaming,
        };
      }),
      totalModels: models.length,
      totalProviders: models.reduce((sum, m) => sum + m.providers.length, 0),
      onlineProviders: models.reduce(
        (sum, m) => sum + m.providers.filter(p => p.status === 'online').length,
        0
      ),
    });
    
  } catch (error) {
    console.error('Failed to list models:', error);
    return NextResponse.json({ error: 'Failed to list models' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      agentId,
      modelId,
      name,
      capabilities,
      hardware,
      parametersBillions,
    } = body;
    
    if (!agentId || !modelId) {
      return NextResponse.json(
        { error: 'Missing agentId or modelId' },
        { status: 400 }
      );
    }
    
    const registry = await loadModels();
    const now = new Date().toISOString();
    
    // Get or create model entry
    if (!registry.models[modelId]) {
      registry.models[modelId] = {
        modelId,
        name: name || modelId,
        family: extractModelFamily(modelId),
        parametersBillions,
        capabilities: capabilities || {
          type: inferModelType(modelId),
          streaming: true,
        },
        providers: [],
        totalRequests: 0,
      };
    }
    
    const model = registry.models[modelId];
    
    // Update model info if provided
    if (name) model.name = name;
    if (capabilities) {
      model.capabilities = { ...model.capabilities, ...capabilities };
    }
    if (parametersBillions) model.parametersBillions = parametersBillions;
    
    // Get agent's reputation
    const reputation = await getAgentReputation(agentId);
    
    // Find or create provider entry
    let provider = model.providers.find(p => p.agentId === agentId);
    
    if (provider) {
      // Update existing provider
      provider.lastSeen = now;
      provider.status = 'online';
      provider.reputation = reputation;
      if (hardware) {
        provider.hardware = { ...provider.hardware, ...hardware };
      }
    } else {
      // Add new provider
      provider = {
        agentId,
        registeredAt: now,
        lastSeen: now,
        status: 'online',
        stats: {
          requestsServed: 0,
          avgLatencyMs: 0,
          avgTokensPerSecond: 0,
          errorRate: 0,
        },
        reputation,
        hardware: hardware || {},
      };
      model.providers.push(provider);
    }
    
    await saveModels(registry);
    
    return NextResponse.json({
      message: 'Model registered',
      modelId,
      providerId: agentId,
      totalProviders: model.providers.length,
    }, { status: 201 });
    
  } catch (error) {
    console.error('Failed to register model:', error);
    return NextResponse.json({ error: 'Failed to register model' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');
    const modelId = searchParams.get('modelId');
    
    if (!agentId) {
      return NextResponse.json({ error: 'Missing agentId' }, { status: 400 });
    }
    
    const registry = await loadModels();
    
    if (modelId) {
      // Remove agent from specific model
      const model = registry.models[modelId];
      if (model) {
        model.providers = model.providers.filter(p => p.agentId !== agentId);
        
        // Remove model if no providers left
        if (model.providers.length === 0) {
          delete registry.models[modelId];
        }
      }
    } else {
      // Remove agent from all models
      for (const model of Object.values(registry.models)) {
        model.providers = model.providers.filter(p => p.agentId !== agentId);
      }
      
      // Clean up empty models
      for (const [id, model] of Object.entries(registry.models)) {
        if (model.providers.length === 0) {
          delete registry.models[id];
        }
      }
    }
    
    await saveModels(registry);
    
    return NextResponse.json({ message: 'Model provider removed' });
    
  } catch (error) {
    console.error('Failed to remove model provider:', error);
    return NextResponse.json({ error: 'Failed to remove model provider' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentId, modelId, status, stats } = body;
    
    if (!agentId || !modelId) {
      return NextResponse.json(
        { error: 'Missing agentId or modelId' },
        { status: 400 }
      );
    }
    
    const registry = await loadModels();
    const model = registry.models[modelId];
    
    if (!model) {
      return NextResponse.json({ error: 'Model not found' }, { status: 404 });
    }
    
    const provider = model.providers.find(p => p.agentId === agentId);
    
    if (!provider) {
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    }
    
    // Update provider
    provider.lastSeen = new Date().toISOString();
    
    if (status) {
      provider.status = status;
    }
    
    if (stats) {
      // Rolling average update for stats
      const oldStats = provider.stats;
      const requests = oldStats.requestsServed;
      
      if (stats.latencyMs !== undefined) {
        oldStats.avgLatencyMs = (oldStats.avgLatencyMs * requests + stats.latencyMs) / (requests + 1);
      }
      if (stats.tokensPerSecond !== undefined) {
        oldStats.avgTokensPerSecond = (oldStats.avgTokensPerSecond * requests + stats.tokensPerSecond) / (requests + 1);
      }
      if (stats.error !== undefined) {
        const errors = oldStats.errorRate * requests;
        oldStats.errorRate = (errors + (stats.error ? 1 : 0)) / (requests + 1);
      }
      
      oldStats.requestsServed++;
      model.totalRequests++;
    }
    
    await saveModels(registry);
    
    return NextResponse.json({
      message: 'Provider updated',
      stats: provider.stats,
    });
    
  } catch (error) {
    console.error('Failed to update provider:', error);
    return NextResponse.json({ error: 'Failed to update provider' }, { status: 500 });
  }
}
