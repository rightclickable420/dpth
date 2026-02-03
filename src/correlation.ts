/**
 * dpth.io Correlation Engine
 * 
 * The magic sauce. Automatically discovers relationships between metrics
 * across different data sources without explicit configuration.
 * 
 * Key capabilities:
 * - Pearson correlation for contemporaneous relationships
 * - Cross-correlation for lagged/causal relationships
 * - Anomaly detection via statistical analysis
 * - Significance testing to filter noise
 */

import {
  Metric,
  MetricPoint,
  Pattern,
  CorrelationData,
  AnomalyData,
  TrendData,
  CorrelationQuery,
} from './types.js';

// ─── Metric Store ────────────────────────────────────

/** In-memory metric store */
const metrics = new Map<string, Metric>();

/**
 * Register a metric for correlation analysis
 */
export function registerMetric(metric: Metric): void {
  metrics.set(metric.id, metric);
}

/**
 * Add data points to a metric
 */
export function addMetricPoints(metricId: string, points: MetricPoint[]): void {
  const metric = metrics.get(metricId);
  if (!metric) return;
  
  metric.points.push(...points);
  // Keep sorted by timestamp
  metric.points.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

/**
 * Get a metric by ID
 */
export function getMetric(id: string): Metric | undefined {
  return metrics.get(id);
}

/**
 * List all metrics
 */
export function listMetrics(): Metric[] {
  return Array.from(metrics.values());
}

// ─── Statistical Helpers ─────────────────────────────

/**
 * Calculate mean of values
 */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Calculate standard deviation
 */
function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const squareDiffs = values.map(v => Math.pow(v - avg, 2));
  return Math.sqrt(mean(squareDiffs));
}

/**
 * Calculate Pearson correlation coefficient
 */
function pearsonCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 3) return 0;
  
  const n = x.length;
  const meanX = mean(x);
  const meanY = mean(y);
  
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  
  const denominator = Math.sqrt(denomX * denomY);
  if (denominator === 0) return 0;
  
  return numerator / denominator;
}

/**
 * Calculate statistical significance (p-value approximation)
 * Uses t-distribution approximation for correlation significance
 */
function correlationSignificance(r: number, n: number): number {
  if (n < 4 || Math.abs(r) >= 1) return 1;
  
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  const df = n - 2;
  
  // Approximation of two-tailed p-value
  // Using normal approximation for large df
  const p = 2 * (1 - normalCDF(Math.abs(t)));
  return p;
}

/**
 * Normal CDF approximation
 */
function normalCDF(x: number): number {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

// ─── Time Alignment ──────────────────────────────────

/**
 * Align two metrics to the same time points using interpolation
 */
function alignMetrics(
  metricA: Metric,
  metricB: Metric,
  lagDays: number = 0
): { valuesA: number[]; valuesB: number[]; timestamps: Date[] } {
  // Get overlapping time range
  const pointsA = metricA.points;
  const pointsB = metricB.points;
  
  if (pointsA.length < 2 || pointsB.length < 2) {
    return { valuesA: [], valuesB: [], timestamps: [] };
  }

  const startA = pointsA[0].timestamp.getTime();
  const endA = pointsA[pointsA.length - 1].timestamp.getTime();
  const startB = pointsB[0].timestamp.getTime() + lagDays * 86400000;
  const endB = pointsB[pointsB.length - 1].timestamp.getTime() + lagDays * 86400000;

  const start = Math.max(startA, startB);
  const end = Math.min(endA, endB);

  if (start >= end) {
    return { valuesA: [], valuesB: [], timestamps: [] };
  }

  // Sample at daily intervals
  const dayMs = 86400000;
  const valuesA: number[] = [];
  const valuesB: number[] = [];
  const timestamps: Date[] = [];

  for (let t = start; t <= end; t += dayMs) {
    const valueA = interpolateAt(pointsA, t);
    const valueB = interpolateAt(pointsB, t - lagDays * dayMs);
    
    if (valueA !== null && valueB !== null) {
      valuesA.push(valueA);
      valuesB.push(valueB);
      timestamps.push(new Date(t));
    }
  }

  return { valuesA, valuesB, timestamps };
}

/**
 * Linear interpolation at a specific timestamp
 */
function interpolateAt(points: MetricPoint[], timestamp: number): number | null {
  if (points.length === 0) return null;
  
  // Find surrounding points
  let before: MetricPoint | null = null;
  let after: MetricPoint | null = null;
  
  for (const point of points) {
    const t = point.timestamp.getTime();
    if (t <= timestamp) {
      before = point;
    } else {
      after = point;
      break;
    }
  }
  
  if (!before && !after) return null;
  if (!before) return after!.value;
  if (!after) return before.value;
  
  // Linear interpolation
  const t1 = before.timestamp.getTime();
  const t2 = after.timestamp.getTime();
  const ratio = (timestamp - t1) / (t2 - t1);
  
  return before.value + ratio * (after.value - before.value);
}

// ─── Correlation Discovery ───────────────────────────

export interface CorrelationResult {
  metricA: string;
  metricB: string;
  correlation: number;
  lagDays: number;
  pValue: number;
  sampleSize: number;
  direction: 'positive' | 'negative';
}

/**
 * Calculate correlation between two metrics
 */
export function calculateCorrelation(
  metricIdA: string,
  metricIdB: string,
  lagDays: number = 0
): CorrelationResult | null {
  const metricA = metrics.get(metricIdA);
  const metricB = metrics.get(metricIdB);
  
  if (!metricA || !metricB) return null;
  
  const { valuesA, valuesB } = alignMetrics(metricA, metricB, lagDays);
  
  if (valuesA.length < 10) return null; // Need minimum sample size
  
  const correlation = pearsonCorrelation(valuesA, valuesB);
  const pValue = correlationSignificance(correlation, valuesA.length);
  
  return {
    metricA: metricIdA,
    metricB: metricIdB,
    correlation,
    lagDays,
    pValue,
    sampleSize: valuesA.length,
    direction: correlation >= 0 ? 'positive' : 'negative',
  };
}

/**
 * Find all correlations for a metric
 */
export function findCorrelations(query: CorrelationQuery): CorrelationResult[] {
  const results: CorrelationResult[] = [];
  const minCorrelation = query.minCorrelation ?? 0.5;
  const maxLag = query.maxLagDays ?? 30;
  
  const targetMetric = metrics.get(query.metricId);
  if (!targetMetric) return results;
  
  for (const [id, metric] of metrics) {
    if (id === query.metricId) continue;
    
    // Check different lag values
    for (let lag = 0; lag <= maxLag; lag++) {
      const result = calculateCorrelation(query.metricId, id, lag);
      
      if (result && Math.abs(result.correlation) >= minCorrelation && result.pValue < 0.05) {
        results.push(result);
      }
      
      // Also check negative lag (B leads A)
      if (lag > 0) {
        const reverseResult = calculateCorrelation(id, query.metricId, lag);
        if (reverseResult && Math.abs(reverseResult.correlation) >= minCorrelation && reverseResult.pValue < 0.05) {
          // Flip the result to show from perspective of query metric
          results.push({
            ...reverseResult,
            metricA: query.metricId,
            metricB: id,
            lagDays: -lag, // Negative lag means target is lagging
          });
        }
      }
    }
  }
  
  // Sort by absolute correlation strength
  results.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
  
  // Deduplicate (keep strongest correlation per metric pair)
  const seen = new Set<string>();
  const deduped: CorrelationResult[] = [];
  for (const result of results) {
    const key = [result.metricA, result.metricB].sort().join(':');
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(result);
    }
  }
  
  return deduped.slice(0, query.limit ?? 20);
}

/**
 * Discover all significant correlations in the system
 */
export function discoverAllCorrelations(
  minCorrelation: number = 0.6,
  maxLagDays: number = 14
): CorrelationResult[] {
  const allResults: CorrelationResult[] = [];
  const metricList = Array.from(metrics.keys());
  
  for (let i = 0; i < metricList.length; i++) {
    for (let j = i + 1; j < metricList.length; j++) {
      // Check contemporaneous
      const result = calculateCorrelation(metricList[i], metricList[j], 0);
      if (result && Math.abs(result.correlation) >= minCorrelation && result.pValue < 0.05) {
        allResults.push(result);
      }
      
      // Check lagged relationships
      for (let lag = 1; lag <= maxLagDays; lag++) {
        const laggedAB = calculateCorrelation(metricList[i], metricList[j], lag);
        if (laggedAB && Math.abs(laggedAB.correlation) >= minCorrelation && laggedAB.pValue < 0.05) {
          allResults.push(laggedAB);
        }
        
        const laggedBA = calculateCorrelation(metricList[j], metricList[i], lag);
        if (laggedBA && Math.abs(laggedBA.correlation) >= minCorrelation && laggedBA.pValue < 0.05) {
          allResults.push(laggedBA);
        }
      }
    }
  }
  
  // Sort and deduplicate
  allResults.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
  
  return allResults;
}

// ─── Anomaly Detection ───────────────────────────────

export interface AnomalyResult {
  metricId: string;
  timestamp: Date;
  value: number;
  expected: number;
  stdDeviations: number;
  severity: 'low' | 'medium' | 'high';
}

/**
 * Detect anomalies in a metric using z-score
 */
export function detectAnomalies(
  metricId: string,
  threshold: number = 2.5
): AnomalyResult[] {
  const metric = metrics.get(metricId);
  if (!metric || metric.points.length < 10) return [];
  
  const values = metric.points.map(p => p.value);
  const avg = mean(values);
  const std = stdDev(values);
  
  if (std === 0) return [];
  
  const anomalies: AnomalyResult[] = [];
  
  for (const point of metric.points) {
    const zScore = Math.abs((point.value - avg) / std);
    
    if (zScore >= threshold) {
      anomalies.push({
        metricId,
        timestamp: point.timestamp,
        value: point.value,
        expected: avg,
        stdDeviations: zScore,
        severity: zScore >= 4 ? 'high' : zScore >= 3 ? 'medium' : 'low',
      });
    }
  }
  
  return anomalies;
}

/**
 * Detect all anomalies across all metrics
 */
export function discoverAllAnomalies(threshold: number = 2.5): AnomalyResult[] {
  const allAnomalies: AnomalyResult[] = [];
  
  for (const metricId of metrics.keys()) {
    const anomalies = detectAnomalies(metricId, threshold);
    allAnomalies.push(...anomalies);
  }
  
  // Sort by severity and recency
  allAnomalies.sort((a, b) => {
    const severityOrder = { high: 3, medium: 2, low: 1 };
    const severityDiff = severityOrder[b.severity] - severityOrder[a.severity];
    if (severityDiff !== 0) return severityDiff;
    return b.timestamp.getTime() - a.timestamp.getTime();
  });
  
  return allAnomalies;
}

// ─── Trend Detection ─────────────────────────────────

export interface TrendResult {
  metricId: string;
  direction: 'up' | 'down' | 'stable';
  slope: number;
  rSquared: number;
  changePercent: number;
  period: { start: Date; end: Date };
}

/**
 * Detect trend in a metric using linear regression
 */
export function detectTrend(
  metricId: string,
  periodDays: number = 30
): TrendResult | null {
  const metric = metrics.get(metricId);
  if (!metric || metric.points.length < 5) return null;
  
  // Filter to period
  const cutoff = Date.now() - periodDays * 86400000;
  const recentPoints = metric.points.filter(p => p.timestamp.getTime() >= cutoff);
  
  if (recentPoints.length < 5) return null;
  
  // Linear regression
  const n = recentPoints.length;
  const x = recentPoints.map((_, i) => i);
  const y = recentPoints.map(p => p.value);
  
  const meanX = mean(x);
  const meanY = mean(y);
  
  let numerator = 0;
  let denominator = 0;
  
  for (let i = 0; i < n; i++) {
    numerator += (x[i] - meanX) * (y[i] - meanY);
    denominator += (x[i] - meanX) * (x[i] - meanX);
  }
  
  const slope = denominator !== 0 ? numerator / denominator : 0;
  const intercept = meanY - slope * meanX;
  
  // Calculate R-squared
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const predicted = intercept + slope * x[i];
    ssRes += Math.pow(y[i] - predicted, 2);
    ssTot += Math.pow(y[i] - meanY, 2);
  }
  const rSquared = ssTot !== 0 ? 1 - ssRes / ssTot : 0;
  
  // Calculate percent change
  const firstValue = recentPoints[0].value;
  const lastValue = recentPoints[recentPoints.length - 1].value;
  const changePercent = firstValue !== 0 ? ((lastValue - firstValue) / firstValue) * 100 : 0;
  
  // Determine direction (need significant slope and R²)
  let direction: 'up' | 'down' | 'stable' = 'stable';
  if (rSquared > 0.3 && Math.abs(changePercent) > 5) {
    direction = slope > 0 ? 'up' : 'down';
  }
  
  return {
    metricId,
    direction,
    slope,
    rSquared,
    changePercent,
    period: {
      start: recentPoints[0].timestamp,
      end: recentPoints[recentPoints.length - 1].timestamp,
    },
  };
}

// ─── Pattern Conversion ──────────────────────────────

/**
 * Convert correlation results to Pattern format
 */
export function correlationToPattern(result: CorrelationResult): Pattern {
  const isCausal = result.lagDays !== 0;
  
  const data: CorrelationData = {
    type: isCausal ? 'causation' : 'correlation',
    metricA: result.metricA,
    metricB: result.metricB,
    coefficient: result.correlation,
    lagDays: result.lagDays,
    sampleSize: result.sampleSize,
  };
  
  const metricA = metrics.get(result.metricA);
  const metricB = metrics.get(result.metricB);
  
  let summary: string;
  if (isCausal) {
    const direction = result.correlation > 0 ? 'increases' : 'decreases';
    summary = `${metricA?.name || result.metricA} ${direction} → ${metricB?.name || result.metricB} follows ${Math.abs(result.lagDays)} days later`;
  } else {
    const direction = result.correlation > 0 ? 'move together' : 'move opposite';
    summary = `${metricA?.name || result.metricA} and ${metricB?.name || result.metricB} ${direction} (r=${result.correlation.toFixed(2)})`;
  }
  
  return {
    id: `corr_${result.metricA}_${result.metricB}_${result.lagDays}`,
    type: isCausal ? 'causation' : 'correlation',
    confidence: 1 - result.pValue,
    significance: 1 / Math.max(result.pValue, 0.001),
    entities: [],
    metrics: [result.metricA, result.metricB],
    data,
    discoveredAt: new Date(),
    lastValidated: new Date(),
    validationCount: 1,
    summary,
  };
}

/**
 * Convert anomaly result to Pattern format
 */
export function anomalyToPattern(result: AnomalyResult): Pattern {
  const metric = metrics.get(result.metricId);
  
  const data: AnomalyData = {
    type: 'anomaly',
    metric: result.metricId,
    value: result.value,
    expected: result.expected,
    stdDeviations: result.stdDeviations,
    timestamp: result.timestamp,
  };
  
  const direction = result.value > result.expected ? 'spike' : 'drop';
  const summary = `Unusual ${direction} in ${metric?.name || result.metricId}: ${result.value.toFixed(1)} vs expected ${result.expected.toFixed(1)}`;
  
  return {
    id: `anom_${result.metricId}_${result.timestamp.getTime()}`,
    type: 'anomaly',
    confidence: Math.min(result.stdDeviations / 5, 1),
    significance: result.stdDeviations,
    entities: [],
    metrics: [result.metricId],
    data,
    discoveredAt: new Date(),
    lastValidated: new Date(),
    validationCount: 1,
    summary,
  };
}

/**
 * Clear all metrics (for testing)
 */
export function clearMetrics(): void {
  metrics.clear();
}
