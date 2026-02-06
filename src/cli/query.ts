/**
 * dpth query — ask the network what it knows
 */

const COORDINATOR = process.env.DPTH_COORDINATOR || 'https://api.dpth.io';

interface SignalBucket {
  domain: string;
  context: string;
  strategy: string;
  condition?: string;
  successRate: number;
  attempts: number;
}

interface CalibrationResult {
  calibration: SignalBucket[] | null;
  count: number;
  totalAttempts: number;
}

export async function query(args: string[]): Promise<void> {
  const [domain, context, strategy] = args;
  
  if (!domain && !context && !strategy) {
    console.log('Usage: dpth query [domain] [context] [strategy]');
    console.log('');
    console.log('Examples:');
    console.log('  dpth query api stripe        What works for Stripe?');
    console.log('  dpth query api               All API signals');
    console.log('  dpth query                   Show all domains');
    return;
  }
  
  // Build query params
  const params = new URLSearchParams();
  if (domain) params.set('domain', domain);
  if (context) params.set('context', context);
  if (strategy) params.set('strategy', strategy);
  
  const url = `${COORDINATOR}/calibrate?${params}`;
  
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Network error: ${res.status}`);
    }
    
    const data: CalibrationResult = await res.json();
    
    const buckets = data.calibration;
    if (!buckets || buckets.length === 0) {
      console.log('No signals found. You\'re exploring new territory!');
      return;
    }
    
    console.log('=== dpth network intelligence ===\n');
    
    // Group by domain/context for cleaner display
    const grouped = new Map<string, SignalBucket[]>();
    for (const bucket of buckets) {
      const key = `${bucket.domain}/${bucket.context}`;
      const list = grouped.get(key) || [];
      list.push(bucket);
      grouped.set(key, list);
    }
    
    for (const [key, groupBuckets] of grouped) {
      console.log(`📂 ${key}`);
      for (const b of groupBuckets) {
        const pct = Math.round(b.successRate * 100);
        const bar = pct >= 70 ? '🟢' : pct >= 40 ? '🟡' : '🔴';
        const cond = b.condition ? ` [${b.condition}]` : '';
        console.log(`   ${bar} ${b.strategy}: ${pct}% success (${b.attempts} attempts)${cond}`);
      }
      console.log('');
    }
    
    console.log(`(${data.count} strategies, ${data.totalAttempts} total attempts)`);
    
  } catch (err) {
    if (err instanceof Error && err.message.includes('fetch')) {
      console.error('Could not reach dpth network. Check your connection or DPTH_COORDINATOR.');
    } else {
      throw err;
    }
  }
}
