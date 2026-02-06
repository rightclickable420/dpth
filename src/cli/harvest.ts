/**
 * dpth harvest — extract signals from GitHub commits
 * 
 * Fetches public commits with fix:/bug:/patch: prefixes
 * and parses them into dpth signals.
 * 
 * Features:
 * - SHA deduplication (never process same commit twice)
 * - Incremental harvests (only new commits since last run)
 * - Signal aggregation (batch before submitting)
 * - Quality filtering (confidence threshold)
 */

import {
  loadCache,
  saveCache,
  isProcessed,
  markProcessed,
  addPendingSignal,
  getPendingSignals,
  clearPendingSignals,
  updateStats,
  setLastHarvest,
  getCacheStats,
} from './harvest-cache.js';

const GITHUB_API = 'https://api.github.com';
const COORDINATOR = process.env.DPTH_COORDINATOR || 'https://api.dpth.io';
const MIN_CONFIDENCE = 0.5;

interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: {
      date: string;
    };
  };
  html_url: string;
}

interface ParsedSignal {
  domain: string;
  context: string;
  strategy: string;
  raw: string;
  confidence: number;
}

// Common domains we can detect
const DOMAIN_PATTERNS: Record<string, RegExp[]> = {
  api: [/api/i, /endpoint/i, /request/i, /response/i, /fetch/i, /http/i, /rest/i, /graphql/i],
  auth: [/auth/i, /token/i, /login/i, /session/i, /oauth/i, /jwt/i, /credential/i],
  db: [/database/i, /query/i, /sql/i, /mongo/i, /postgres/i, /mysql/i, /redis/i, /migration/i],
  ui: [/css/i, /style/i, /layout/i, /render/i, /component/i, /display/i, /button/i, /modal/i],
  perf: [/performance/i, /slow/i, /timeout/i, /cache/i, /memory/i, /leak/i, /optimize/i],
  test: [/test/i, /spec/i, /mock/i, /fixture/i, /coverage/i],
  build: [/build/i, /compile/i, /bundle/i, /webpack/i, /vite/i, /typescript/i, /lint/i],
  deps: [/dependency/i, /package/i, /npm/i, /yarn/i, /version/i, /upgrade/i],
  error: [/error/i, /exception/i, /crash/i, /bug/i, /issue/i, /fix/i],
  security: [/security/i, /xss/i, /injection/i, /vulnerability/i, /sanitize/i],
  config: [/config/i, /env/i, /setting/i, /option/i, /flag/i],
  file: [/file/i, /path/i, /directory/i, /import/i, /export/i, /module/i],
};

// Common strategies/patterns
const STRATEGY_PATTERNS: Record<string, RegExp[]> = {
  retry: [/retry/i, /retries/i, /reattempt/i],
  timeout: [/timeout/i, /deadline/i, /time.?out/i],
  null_check: [/null/i, /undefined/i, /optional/i, /\?\./],
  validation: [/validat/i, /check/i, /verify/i, /sanitiz/i],
  error_handling: [/catch/i, /try/i, /error.*handl/i, /exception/i],
  caching: [/cache/i, /memoiz/i, /store/i],
  rate_limit: [/rate.?limit/i, /throttl/i, /backoff/i],
  encoding: [/encod/i, /decod/i, /utf/i, /base64/i],
  escape: [/escape/i, /sanitiz/i, /encode/i],
  async: [/async/i, /await/i, /promise/i, /concurrent/i],
  path: [/path/i, /resolve/i, /absolute/i, /relative/i],
  type: [/type/i, /cast/i, /convert/i, /coerce/i],
};

// Context extractors - try to find specific tech/service
const CONTEXT_PATTERNS: Record<string, RegExp> = {
  stripe: /stripe/i,
  github: /github/i,
  aws: /aws|s3|lambda|dynamo/i,
  google: /google|gcp|firebase/i,
  react: /react|jsx|hook/i,
  node: /node|npm|require/i,
  python: /python|pip|django|flask/i,
  docker: /docker|container|k8s|kubernetes/i,
  postgres: /postgres|psql|pg_/i,
  mongo: /mongo|mongoose/i,
  redis: /redis/i,
  graphql: /graphql|apollo|gql/i,
  rest: /rest|endpoint|route/i,
  webpack: /webpack|bundle/i,
  typescript: /typescript|ts|type/i,
  eslint: /eslint|lint/i,
  jest: /jest|test|spec/i,
  ci: /ci|github.?action|jenkins|travis/i,
};

export async function harvest(args: string[]): Promise<void> {
  const query = args.filter(a => !a.startsWith('--'))[0];
  const limitArg = args.filter(a => !a.startsWith('--'))[1];
  const limit = parseInt(limitArg) || 50;
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose') || args.includes('-v');
  const flush = args.includes('--flush'); // Submit all pending signals
  const stats = args.includes('--stats'); // Show cache stats
  
  // Load cache
  await loadCache();
  
  // Stats mode
  if (stats) {
    const s = getCacheStats();
    console.log('📊 Harvest cache stats:');
    console.log(`   Commits processed: ${s.totalProcessed.toLocaleString()}`);
    console.log(`   Signals submitted: ${s.totalSubmitted.toLocaleString()}`);
    console.log(`   Cached SHAs: ${s.processedCount.toLocaleString()}`);
    console.log(`   Pending signals: ${s.pendingCount}`);
    console.log(`   Last run: ${s.lastRun || 'never'}`);
    return;
  }
  
  // Flush mode - submit all pending signals
  if (flush) {
    const pending = getPendingSignals();
    if (pending.length === 0) {
      console.log('No pending signals to flush.');
      return;
    }
    
    console.log(`📤 Flushing ${pending.length} pending signals...`);
    let submitted = 0;
    for (const { domain, context, strategy, count } of pending) {
      if (verbose) {
        console.log(`   ${count}x ${domain}/${context}/${strategy}`);
      }
      const success = await submitSignal(domain, context, strategy, count);
      if (success) submitted++;
    }
    
    clearPendingSignals();
    updateStats(0, submitted);
    await saveCache(await loadCache());
    
    console.log(`✓ Submitted ${submitted} signals to network`);
    return;
  }
  
  if (!query) {
    console.log('Usage: dpth harvest <query> [limit] [options]');
    console.log('');
    console.log('Options:');
    console.log('  --dry-run     Preview without submitting or caching');
    console.log('  --verbose     Show each parsed signal');
    console.log('  --flush       Submit all pending signals');
    console.log('  --stats       Show harvest cache statistics');
    console.log('');
    console.log('Examples:');
    console.log('  dpth harvest stripe 100          Harvest Stripe fix commits');
    console.log('  dpth harvest "rate limit" 200    Harvest rate limit fixes');
    console.log('  dpth harvest retry --dry-run     Preview retry patterns');
    console.log('  dpth harvest --flush             Submit all pending signals');
    console.log('  dpth harvest --stats             Show cache statistics');
    console.log('');
    console.log('Signals are aggregated and cached. Use --flush to submit.');
    console.log('Set GITHUB_TOKEN for higher API rate limits.');
    return;
  }
  
  console.log(`🌾 Harvesting signals from GitHub...`);
  console.log(`   Query: fix + "${query}"`);
  console.log(`   Limit: ${limit} commits`);
  
  try {
    // Search GitHub for commits
    const allCommits = await searchCommits(query, limit);
    
    // Filter out already-processed commits
    const newCommits = allCommits.filter(c => !isProcessed(c.sha));
    const skipped = allCommits.length - newCommits.length;
    
    console.log(`   Found: ${allCommits.length} commits (${skipped} already processed)`);
    console.log(`   New: ${newCommits.length} commits to process`);
    console.log('');
    
    if (newCommits.length === 0) {
      console.log('No new commits to process. Try a different query or higher limit.');
      return;
    }
    
    // Parse into signals
    let parsed = 0;
    let lowConfidence = 0;
    
    for (const commit of newCommits) {
      const signal = parseCommitMessage(commit.commit.message);
      
      if (signal) {
        if (signal.confidence >= MIN_CONFIDENCE) {
          parsed++;
          addPendingSignal(signal.domain, signal.context, signal.strategy);
          
          if (verbose) {
            console.log(`   📝 ${signal.domain}/${signal.context}/${signal.strategy}`);
            console.log(`      "${signal.raw.slice(0, 60)}${signal.raw.length > 60 ? '...' : ''}"`);
          }
        } else {
          lowConfidence++;
        }
      }
      
      // Mark as processed (unless dry run)
      if (!dryRun) {
        markProcessed(commit.sha);
      }
    }
    
    const hitRate = Math.round(parsed / newCommits.length * 100);
    console.log(`   Parsed: ${parsed} signals (${hitRate}% hit rate, ${lowConfidence} low-confidence skipped)`);
    
    // Show aggregated pending signals
    const pending = getPendingSignals();
    const sorted = pending.sort((a, b) => b.count - a.count);
    
    console.log(`   Pending: ${pending.length} unique patterns`);
    console.log('');
    
    if (sorted.length > 0) {
      console.log('   Top patterns (pending):');
      for (const { domain, context, strategy, count } of sorted.slice(0, 10)) {
        console.log(`      ${count}x ${domain}/${context}/${strategy}`);
      }
      console.log('');
    }
    
    if (dryRun) {
      console.log('   --dry-run: Not saving to cache or submitting.');
      return;
    }
    
    // Update stats and save cache
    updateStats(newCommits.length, 0);
    setLastHarvest(query);
    await saveCache(await loadCache());
    
    console.log(`   ✓ Cached ${parsed} signals. Run 'dpth harvest --flush' to submit.`);
    
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

async function searchCommits(query: string, limit: number): Promise<GitHubCommit[]> {
  // GitHub search API: search for commits with "fix" in message
  const searchQuery = encodeURIComponent(`fix ${query}`);
  const url = `${GITHUB_API}/search/commits?q=${searchQuery}&sort=committer-date&order=desc&per_page=${Math.min(limit, 100)}`;
  
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.cloak-preview+json', // Commit search is preview API
    'User-Agent': 'dpth-harvester',
  };
  
  // Use token if available
  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
  }
  
  const res = await fetch(url, { headers });
  
  if (!res.ok) {
    if (res.status === 403) {
      throw new Error('GitHub rate limit hit. Set GITHUB_TOKEN for higher limits.');
    }
    throw new Error(`GitHub API error: ${res.status}`);
  }
  
  const data = await res.json();
  return data.items || [];
}

function parseCommitMessage(message: string): ParsedSignal | null {
  // Get first line
  const firstLine = message.split('\n')[0].trim();
  
  // Must start with fix/bug/patch prefix (conventional commits)
  if (!/^(fix|bug|patch)(\(.+\))?:/i.test(firstLine)) {
    // Also accept without prefix if it mentions "fix"
    if (!/fix/i.test(firstLine)) {
      return null;
    }
  }
  
  // Extract scope from conventional commit format: fix(scope): message
  let scope: string | null = null;
  const scopeMatch = firstLine.match(/^(?:fix|bug|patch)\(([^)]+)\):/i);
  if (scopeMatch) {
    scope = scopeMatch[1].toLowerCase();
  }
  
  // Detect domain
  let domain = 'general';
  for (const [d, patterns] of Object.entries(DOMAIN_PATTERNS)) {
    if (patterns.some(p => p.test(firstLine))) {
      domain = d;
      break;
    }
  }
  
  // Detect context (specific tech/service)
  let context = scope || 'general';
  for (const [c, pattern] of Object.entries(CONTEXT_PATTERNS)) {
    if (pattern.test(firstLine)) {
      context = c;
      break;
    }
  }
  
  // Detect strategy
  let strategy = 'fix';
  for (const [s, patterns] of Object.entries(STRATEGY_PATTERNS)) {
    if (patterns.some(p => p.test(firstLine))) {
      strategy = s;
      break;
    }
  }
  
  // Calculate confidence based on how specific we could get
  let confidence = 0.3;
  if (domain !== 'general') confidence += 0.2;
  if (context !== 'general') confidence += 0.2;
  if (strategy !== 'fix') confidence += 0.2;
  if (scopeMatch) confidence += 0.1; // Conventional commit format is higher quality
  
  return {
    domain,
    context,
    strategy,
    raw: firstLine,
    confidence,
  };
}

async function submitSignal(domain: string, context: string, strategy: string, count: number): Promise<boolean> {
  try {
    const res = await fetch(`${COORDINATOR}/signals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain,
        context,
        strategy,
        successes: count, // Assume fixes that got merged are successful strategies
        failures: 0,
        totalAttempts: count,
      }),
    });
    
    return res.ok;
  } catch {
    return false;
  }
}
