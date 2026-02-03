/**
 * dpth.io Ingestion Pipeline
 * 
 * Connects Fathom's data connectors to dpth.io's intelligence layer.
 * When data flows in from Stripe, GitHub, HubSpot, etc., it automatically:
 * 1. Extracts entities (people, companies, products)
 * 2. Extracts metrics (time-series values)
 * 3. Registers everything with dpth.io for correlation discovery
 */

import { DeepNode, Presentation } from '../types';
import { Entity, EntityType, Metric, MetricPoint } from './types';
import { resolveOrCreate, getEntitiesByType } from './entity';
import { registerMetric, addMetricPoints } from './correlation';
import { embedEntity, embedMetric } from './embed';

// Note: DuckDB analytics is available separately via './analytics' 
// but not imported here due to native module bundling issues.
// For now, correlation engine runs in-memory which is sufficient
// for early-stage use. DuckDB can be added as a standalone worker.

// ─── Connector → Entity Mapping ──────────────────────

interface EntityExtraction {
  type: EntityType;
  name: string;
  externalId: string;
  email?: string;
  attributes?: Record<string, unknown>;
}

interface MetricExtraction {
  id: string;
  name: string;
  value: number;
  timestamp: Date;
  unit?: string;
  entityRef?: string; // External ID of related entity
}

/**
 * Extract entities and metrics from a connector's node tree
 */
export function extractFromNodes(
  nodes: DeepNode[],
  sourceId: string
): { entities: EntityExtraction[]; metrics: MetricExtraction[] } {
  const entities: EntityExtraction[] = [];
  const metrics: MetricExtraction[] = [];
  
  function traverse(node: DeepNode, path: string[] = []) {
    const fullPath = [...path, node.title].join(' > ');
    
    // Extract metrics from metric nodes
    if (node.type === 'metric' && node.metricValue) {
      const value = parseMetricValue(node.metricValue);
      if (value !== null) {
        metrics.push({
          id: `${sourceId}:${node.id}`,
          name: node.title,
          value,
          timestamp: new Date(),
          unit: extractUnit(node.metricValue),
        });
      }
    }
    
    // Extract metrics from chart data
    if (node.chartData) {
      for (const bar of node.chartData) {
        metrics.push({
          id: `${sourceId}:${node.id}:${bar.label}`,
          name: `${node.title} - ${bar.label}`,
          value: bar.value,
          timestamp: new Date(),
        });
      }
    }
    
    // Extract metrics from stats
    if (node.stats) {
      for (const stat of node.stats) {
        const value = parseMetricValue(stat.value);
        if (value !== null) {
          metrics.push({
            id: `${sourceId}:${node.id}:${stat.label}`,
            name: `${node.title} - ${stat.label}`,
            value,
            timestamp: new Date(),
          });
        }
      }
    }
    
    // Extract entities from table data (common pattern: name/email columns)
    if (node.tableData && node.tableData.headers && node.tableData.rows) {
      const headers = node.tableData.headers.map(h => h.toLowerCase());
      const nameIdx = headers.findIndex(h => 
        h.includes('name') || h.includes('customer') || h.includes('user')
      );
      const emailIdx = headers.findIndex(h => h.includes('email'));
      const idIdx = headers.findIndex(h => h.includes('id'));
      
      if (nameIdx !== -1) {
        for (const row of node.tableData.rows) {
          const name = row[nameIdx];
          if (name && typeof name === 'string' && name.length > 0) {
            // Determine entity type from context
            const type = inferEntityType(node.title, fullPath);
            entities.push({
              type,
              name,
              externalId: row[idIdx] || `${sourceId}:${name}`,
              email: emailIdx !== -1 ? row[emailIdx] : undefined,
            });
          }
        }
      }
    }
    
    // Recurse into children
    for (const child of node.children || []) {
      traverse(child, [...path, node.title]);
    }
  }
  
  for (const node of nodes) {
    traverse(node);
  }
  
  return { entities, metrics };
}

/**
 * Parse a metric value string to number
 */
function parseMetricValue(value: string): number | null {
  if (!value) return null;
  
  // Remove currency symbols, commas, percentage signs
  const cleaned = value.replace(/[$€£¥,]/g, '').replace(/%$/, '').trim();
  
  // Handle K, M, B suffixes
  const match = cleaned.match(/^(-?\d+\.?\d*)\s*([KMBkmb])?$/);
  if (!match) return null;
  
  let num = parseFloat(match[1]);
  if (isNaN(num)) return null;
  
  const suffix = match[2]?.toUpperCase();
  if (suffix === 'K') num *= 1000;
  if (suffix === 'M') num *= 1000000;
  if (suffix === 'B') num *= 1000000000;
  
  return num;
}

/**
 * Extract unit from metric value
 */
function extractUnit(value: string): string | undefined {
  if (value.startsWith('$') || value.includes('USD')) return 'USD';
  if (value.startsWith('€')) return 'EUR';
  if (value.startsWith('£')) return 'GBP';
  if (value.endsWith('%')) return 'percent';
  return undefined;
}

/**
 * Infer entity type from node title and path
 */
function inferEntityType(title: string, path: string): EntityType {
  const lowerTitle = title.toLowerCase();
  const lowerPath = path.toLowerCase();
  
  if (lowerTitle.includes('customer') || lowerPath.includes('customer')) return 'person';
  if (lowerTitle.includes('user') || lowerPath.includes('user')) return 'person';
  if (lowerTitle.includes('employee') || lowerPath.includes('employee')) return 'person';
  if (lowerTitle.includes('company') || lowerPath.includes('company')) return 'company';
  if (lowerTitle.includes('account') || lowerPath.includes('account')) return 'company';
  if (lowerTitle.includes('product') || lowerPath.includes('product')) return 'product';
  if (lowerTitle.includes('project') || lowerPath.includes('project')) return 'project';
  if (lowerTitle.includes('team') || lowerPath.includes('team')) return 'team';
  
  return 'custom';
}

// ─── Ingestion Pipeline ──────────────────────────────

/**
 * Ingest a presentation into dpth.io
 */
export async function ingestPresentation(
  presentation: Presentation,
  sourceId: string
): Promise<{
  entitiesCreated: number;
  entitiesMatched: number;
  metricsIngested: number;
}> {
  // dpth.io ingestion uses in-memory correlation engine
  // DuckDB analytics can be added as separate worker for SQL queries
  
  const { entities, metrics } = extractFromNodes(presentation.nodes, sourceId);
  
  let entitiesCreated = 0;
  let entitiesMatched = 0;
  
  // Process entities
  for (const extraction of entities) {
    const { entity, isNew } = resolveOrCreate(
      extraction.type,
      extraction.name,
      sourceId,
      extraction.externalId,
      {
        email: extraction.email,
        attributes: extraction.attributes,
      }
    );
    
    if (isNew) {
      entitiesCreated++;
      // Embed the entity for semantic search
      embedEntity(entity);
    } else {
      entitiesMatched++;
    }
  }
  
  // Process metrics
  for (const extraction of metrics) {
    // Create or update metric in correlation engine
    const metric: Metric = {
      id: extraction.id,
      entityId: extraction.entityRef || '',
      name: extraction.name,
      unit: extraction.unit,
      points: [{
        timestamp: extraction.timestamp,
        value: extraction.value,
        source: sourceId,
        confidence: 1.0,
      }],
      aggregation: 'last',
    };
    
    registerMetric(metric);
    embedMetric(metric);
    
    // Note: DuckDB SQL analytics available separately if needed
    // In-memory correlation engine is sufficient for pattern discovery
  }
  
  return {
    entitiesCreated,
    entitiesMatched,
    metricsIngested: metrics.length,
  };
}

/**
 * Ingest connector refresh data (incremental update)
 */
export async function ingestRefresh(
  presentation: Presentation,
  sourceId: string,
  previousTimestamp?: Date
): Promise<{
  newMetrics: number;
  updatedMetrics: number;
}> {
  const { metrics } = extractFromNodes(presentation.nodes, sourceId);
  
  let newMetrics = 0;
  let updatedMetrics = 0;
  
  for (const extraction of metrics) {
    const point: MetricPoint = {
      timestamp: extraction.timestamp,
      value: extraction.value,
      source: sourceId,
      confidence: 1.0,
    };
    
    // Add to correlation engine (in-memory)
    addMetricPoints(extraction.id, [point]);
    
    // Count as new or updated based on whether we've seen this metric before
    // (simplified - real implementation would check existing metrics)
    updatedMetrics++;
  }
  
  return { newMetrics, updatedMetrics };
}

// ─── Connector-Specific Extractors ───────────────────

/**
 * Stripe-specific entity/metric extraction
 */
export function extractFromStripe(data: Record<string, unknown>): {
  entities: EntityExtraction[];
  metrics: MetricExtraction[];
} {
  const entities: EntityExtraction[] = [];
  const metrics: MetricExtraction[] = [];
  const now = new Date();
  
  // Extract customers as entities
  if (Array.isArray(data.customers)) {
    for (const customer of data.customers) {
      entities.push({
        type: 'person',
        name: (customer as Record<string, unknown>).name as string || (customer as Record<string, unknown>).email as string || 'Unknown',
        externalId: (customer as Record<string, unknown>).id as string,
        email: (customer as Record<string, unknown>).email as string,
        attributes: {
          stripeCustomerId: (customer as Record<string, unknown>).id,
          created: (customer as Record<string, unknown>).created,
        },
      });
    }
  }
  
  // Extract MRR, ARR, revenue metrics
  if (typeof data.mrr === 'number') {
    metrics.push({ id: 'stripe:mrr', name: 'MRR', value: data.mrr, timestamp: now, unit: 'USD' });
  }
  if (typeof data.arr === 'number') {
    metrics.push({ id: 'stripe:arr', name: 'ARR', value: data.arr, timestamp: now, unit: 'USD' });
  }
  if (typeof data.revenue === 'number') {
    metrics.push({ id: 'stripe:revenue', name: 'Revenue', value: data.revenue, timestamp: now, unit: 'USD' });
  }
  if (typeof data.customerCount === 'number') {
    metrics.push({ id: 'stripe:customers', name: 'Customer Count', value: data.customerCount, timestamp: now });
  }
  
  return { entities, metrics };
}

/**
 * GitHub-specific entity/metric extraction
 */
export function extractFromGitHub(data: Record<string, unknown>): {
  entities: EntityExtraction[];
  metrics: MetricExtraction[];
} {
  const entities: EntityExtraction[] = [];
  const metrics: MetricExtraction[] = [];
  const now = new Date();
  
  // Extract contributors as entities
  if (Array.isArray(data.contributors)) {
    for (const contributor of data.contributors) {
      entities.push({
        type: 'person',
        name: (contributor as Record<string, unknown>).login as string || (contributor as Record<string, unknown>).name as string,
        externalId: `github:${(contributor as Record<string, unknown>).id || (contributor as Record<string, unknown>).login}`,
        email: (contributor as Record<string, unknown>).email as string,
        attributes: {
          githubLogin: (contributor as Record<string, unknown>).login,
          contributions: (contributor as Record<string, unknown>).contributions,
        },
      });
    }
  }
  
  // Extract repo as project entity
  if (data.repo) {
    const repo = data.repo as Record<string, unknown>;
    entities.push({
      type: 'project',
      name: repo.name as string || repo.full_name as string,
      externalId: `github:repo:${repo.id || repo.full_name}`,
      attributes: {
        githubUrl: repo.html_url,
        language: repo.language,
        stars: repo.stargazers_count,
      },
    });
  }
  
  // Metrics
  if (typeof data.stars === 'number') {
    metrics.push({ id: 'github:stars', name: 'Stars', value: data.stars, timestamp: now });
  }
  if (typeof data.openIssues === 'number') {
    metrics.push({ id: 'github:issues', name: 'Open Issues', value: data.openIssues, timestamp: now });
  }
  if (typeof data.openPRs === 'number') {
    metrics.push({ id: 'github:prs', name: 'Open PRs', value: data.openPRs, timestamp: now });
  }
  if (typeof data.commits === 'number') {
    metrics.push({ id: 'github:commits', name: 'Commits', value: data.commits, timestamp: now });
  }
  
  return { entities, metrics };
}

/**
 * HubSpot-specific entity/metric extraction
 */
export function extractFromHubSpot(data: Record<string, unknown>): {
  entities: EntityExtraction[];
  metrics: MetricExtraction[];
} {
  const entities: EntityExtraction[] = [];
  const metrics: MetricExtraction[] = [];
  const now = new Date();
  
  // Extract contacts as entities
  if (Array.isArray(data.contacts)) {
    for (const contact of data.contacts) {
      const c = contact as Record<string, unknown>;
      const props = c.properties as Record<string, unknown> || {};
      entities.push({
        type: 'person',
        name: `${props.firstname || ''} ${props.lastname || ''}`.trim() || props.email as string || 'Unknown',
        externalId: `hubspot:contact:${c.id}`,
        email: props.email as string,
        attributes: {
          hubspotId: c.id,
          lifecycleStage: props.lifecyclestage,
          company: props.company,
        },
      });
    }
  }
  
  // Extract companies as entities
  if (Array.isArray(data.companies)) {
    for (const company of data.companies) {
      const c = company as Record<string, unknown>;
      const props = c.properties as Record<string, unknown> || {};
      entities.push({
        type: 'company',
        name: props.name as string || 'Unknown Company',
        externalId: `hubspot:company:${c.id}`,
        attributes: {
          hubspotId: c.id,
          domain: props.domain,
          industry: props.industry,
        },
      });
    }
  }
  
  // Metrics
  if (typeof data.totalContacts === 'number') {
    metrics.push({ id: 'hubspot:contacts', name: 'Total Contacts', value: data.totalContacts, timestamp: now });
  }
  if (typeof data.totalDeals === 'number') {
    metrics.push({ id: 'hubspot:deals', name: 'Total Deals', value: data.totalDeals, timestamp: now });
  }
  if (typeof data.pipelineValue === 'number') {
    metrics.push({ id: 'hubspot:pipeline', name: 'Pipeline Value', value: data.pipelineValue, timestamp: now, unit: 'USD' });
  }
  
  return { entities, metrics };
}
