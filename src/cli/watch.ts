/**
 * dpth watch — wrap a command and automatically log outcomes
 * 
 * Spawns the child process, pipes I/O, and monitors for:
 * - Tool call patterns (exec, fetch, etc.)
 * - Failures and errors
 * - Retry attempts
 * 
 * On detection, queries dpth for relevant signals and logs outcomes.
 */

import { spawn } from 'child_process';

const COORDINATOR = process.env.DPTH_COORDINATOR || 'https://api.dpth.io';

interface WatcherState {
  currentDomain: string | null;
  currentContext: string | null;
  lastToolCall: string | null;
  pendingOutcomes: Map<string, { domain: string; context: string; strategy: string; startTime: number }>;
  lastPromptTime: number;
  promptedDomains: Set<string>;
  stats: {
    toolCalls: number;
    failures: number;
    warnings: number;
    logged: number;
  };
}

// Patterns to detect in output
const PATTERNS = {
  // Tool calls
  toolCall: /(?:exec|web_fetch|web_search|browser|Read|Write|Edit)\s*[\(\{:]/i,
  
  // Errors and failures
  error: /(?:error|failed|failure|exception|rejected|timeout|ENOENT|ECONNREFUSED|ETIMEDOUT|ERR_|cannot access|not found|no such file|permission denied|command not found)/i,
  
  // Retry patterns
  retry: /(?:retry|retrying|attempt\s+\d+|trying again|backoff)/i,
  
  // Success patterns (to close pending outcomes)
  success: /(?:success|completed|done|✓|✔|passed)/i,
  
  // Common tool domains
  domains: {
    api: /(?:fetch|request|response|http|api|endpoint|curl)/i,
    exec: /(?:exec|spawn|command|shell|bash|npm|pnpm|yarn|git)/i,
    file: /(?:read|write|edit|file|path|directory|ENOENT)/i,
    browser: /(?:browser|puppeteer|playwright|selenium|chrome)/i,
    db: /(?:database|sql|query|postgres|mysql|sqlite|mongo)/i,
  },
};

export async function watch(opts: string[], cmd: string[]): Promise<void> {
  if (cmd.length === 0) {
    console.error('Usage: dpth watch [options] -- <command>');
    console.error('');
    console.error('Examples:');
    console.error('  dpth watch -- claude-code "fix the bug"');
    console.error('  dpth watch -- aider --model gpt-4');
    console.error('  dpth watch --verbose -- npm test');
    process.exit(1);
  }
  
  const verbose = opts.includes('--verbose') || opts.includes('-v');
  const quiet = opts.includes('--quiet') || opts.includes('-q');
  
  const state: WatcherState = {
    currentDomain: null,
    currentContext: null,
    lastToolCall: null,
    pendingOutcomes: new Map(),
    lastPromptTime: 0,
    promptedDomains: new Set(),
    stats: { toolCalls: 0, failures: 0, warnings: 0, logged: 0 },
  };
  
  if (!quiet) {
    console.log(`dpth watching: ${cmd.join(' ')}`);
  }
  
  // Track domains we've already shown hints for this session
  const hintedDomains = new Set<string>();
  
  // Fetch network vocabulary before starting (what domains/contexts exist)
  await fetchVocabulary();
  
  // Try to detect domain from command itself (await before spawning)
  const cmdStr = cmd.join(' ').toLowerCase();
  const initialDomain = detectDomainFromCommand(cmdStr);
  if (initialDomain && !quiet) {
    await showDomainHint(initialDomain, hintedDomains);
  }
  
  // Spawn the child process
  const child = spawn(cmd[0], cmd.slice(1), {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
  });
  
  // Handle stdin - pass through to child, but intercept dpth: commands
  let childExited = false;
  
  process.stdin.on('data', async (data: Buffer) => {
    const input = data.toString();
    
    // Check for dpth: signal command
    const dpthMatch = input.match(/^dpth:\s*(\S+)\/(\S+)\/(\S+)\s+(success|failure|partial)\s*$/i);
    if (dpthMatch) {
      const [, domain, context, strategy, outcome] = dpthMatch;
      const success = outcome.toLowerCase() === 'success' ? 1 : 
                      outcome.toLowerCase() === 'partial' ? 0.5 : 0;
      await logSignal(domain, context, strategy, success);
      state.stats.logged++;
      console.log(`   ✓ dpth: logged ${domain}/${context}/${strategy} → ${outcome}`);
    } else if (!childExited && child.stdin && !child.stdin.destroyed) {
      // Pass through to child (only if still running)
      try {
        child.stdin.write(data);
      } catch {
        // Ignore write errors if child exited
      }
    }
  });
  
  // Track when child exits
  child.on('exit', () => { childExited = true; });
  
  // Process stdout
  child.stdout?.on('data', (data: Buffer) => {
    const text = data.toString();
    process.stdout.write(text);
    processOutput(text, state, 'stdout', verbose, quiet, hintedDomains);
  });
  
  // Process stderr
  child.stderr?.on('data', (data: Buffer) => {
    const text = data.toString();
    process.stderr.write(text);
    processOutput(text, state, 'stderr', verbose, quiet, hintedDomains);
  });
  
  // Handle exit
  child.on('close', async (code) => {
    // Log any pending outcomes as unknown
    for (const [key, pending] of state.pendingOutcomes) {
      await logSignal(pending.domain, pending.context, pending.strategy, code === 0 ? 1 : 0);
      state.stats.logged++;
    }
    
    if (!quiet && state.stats.logged === 0) {
      const domain = state.currentDomain || 'general';
      if (code !== 0 || state.stats.failures > 0) {
        console.log(`dpth: log? ${domain}/<context>/<strategy> failure`);
      } else if (state.stats.failures > 0) {
        // Recovered from errors
        console.log(`dpth: log? ${domain}/<context>/<strategy> success`);
      }
    }
    
    process.exit(code ?? 0);
  });
  
  child.on('error', (err) => {
    console.error(`Failed to start command: ${err.message}`);
    process.exit(1);
  });
}

async function processOutput(
  text: string,
  state: WatcherState,
  source: 'stdout' | 'stderr',
  verbose: boolean,
  quiet: boolean,
  hintedDomains: Set<string>
): Promise<void> {
  const lines = text.split('\n');
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    // Detect tool calls and domain transitions
    if (PATTERNS.toolCall.test(line)) {
      state.stats.toolCalls++;
      state.lastToolCall = line.slice(0, 100);
      
      // Try to identify domain
      for (const [domain, pattern] of Object.entries(PATTERNS.domains)) {
        if (pattern.test(line)) {
          state.currentDomain = domain;
          // Show hint on domain transition (first touch)
          if (!quiet && !hintedDomains.has(domain)) {
            showDomainHint(domain, hintedDomains);
          }
          break;
        }
      }
      
      if (verbose) {
        console.log(`   [dpth] Tool detected: ${state.currentDomain || 'unknown'}`);
      }
    }
    
    // Detect errors/failures (just count, don't prompt mid-stream)
    if (PATTERNS.error.test(line)) {
      state.stats.failures++;
      
      // Update current domain if we can detect it from error
      const errorDomain = detectDomain(line);
      if (errorDomain && !state.currentDomain) {
        state.currentDomain = errorDomain;
        // Show hint on first error in this domain
        if (!quiet && !hintedDomains.has(errorDomain)) {
          showDomainHint(errorDomain, hintedDomains);
        }
      }
    }
    
    // Detect retries
    if (PATTERNS.retry.test(line)) {
      const domain = state.currentDomain || 'general';
      if (verbose) {
        console.log(`   [dpth] Retry detected in ${domain}`);
      }
    }
    
    // Detect success (close pending outcomes)
    if (PATTERNS.success.test(line)) {
      // Log oldest pending outcome as success
      const oldest = [...state.pendingOutcomes.entries()][0];
      if (oldest) {
        const [key, pending] = oldest;
        await logSignal(pending.domain, pending.context, pending.strategy, 1);
        state.pendingOutcomes.delete(key);
        state.stats.logged++;
        
        if (verbose) {
          console.log(`   [dpth] Logged success: ${pending.domain}/${pending.context}`);
        }
      }
    }
  }
}

function detectDomain(text: string): string | null {
  for (const [domain, pattern] of Object.entries(PATTERNS.domains)) {
    if (pattern.test(text)) return domain;
  }
  return null;
}

function extractContext(text: string): string | null {
  // Try to extract meaningful context from error messages
  // e.g., "ECONNREFUSED 127.0.0.1:3000" -> "localhost"
  // e.g., "npm ERR! 404 Not Found" -> "npm"
  
  const patterns = [
    /npm\s+ERR/i,
    /ECONNREFUSED\s+(\S+)/,
    /ETIMEDOUT\s+(\S+)/,
    /fetch\s+(\S+)/i,
    /api\.(\w+)\.com/i,
  ];
  
  for (const p of patterns) {
    const match = text.match(p);
    if (match) {
      return match[1]?.replace(/[^\w]/g, '_').toLowerCase() || null;
    }
  }
  
  return null;
}

interface SignalBucket {
  domain: string;
  context: string;
  strategy: string;
  successRate: number;
  attempts: number;
}

async function querySignals(domain: string, context?: string | null): Promise<SignalBucket[]> {
  try {
    const params = new URLSearchParams({ domain });
    if (context) params.set('context', context);
    
    const res = await fetch(`${COORDINATOR}/calibrate?${params}`, {
      signal: AbortSignal.timeout(2000), // Don't block too long
    });
    
    if (!res.ok) return [];
    
    const data = await res.json();
    return data.calibration?.buckets || [];
    
  } catch {
    return []; // Silently fail, don't disrupt the watched process
  }
}

async function logSignal(domain: string, context: string, strategy: string, outcome: number): Promise<void> {
  try {
    const body = {
      domain,
      context,
      strategy,
      successes: outcome >= 0.5 ? 1 : 0,
      failures: outcome < 0.5 ? 1 : 0,
      totalAttempts: 1,
    };
    
    await fetch(`${COORDINATOR}/signals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2000),
    });
    
  } catch {
    // Silently fail
  }
}

// Cache of known domains + contexts from the coordinator
let networkVocabulary: { domains: string[]; contexts: string[] } | null = null;

async function fetchVocabulary(): Promise<{ domains: string[]; contexts: string[] }> {
  if (networkVocabulary) return networkVocabulary;
  try {
    const res = await fetch(`${COORDINATOR}/vocabulary`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { domains: [], contexts: [] };
    const data = await res.json();
    networkVocabulary = {
      domains: Object.keys(data.domains || {}),
      contexts: Object.keys(data.contexts || {}),
    };
    return networkVocabulary;
  } catch {
    return { domains: [], contexts: [] };
  }
}

// Detect domain from command string by matching against known network domains + contexts
function detectDomainFromCommand(cmd: string): string | null {
  // First try matching against known network vocabulary
  if (networkVocabulary) {
    const words = cmd.toLowerCase().split(/[\s/\\.\-_]+/);
    
    // Check if any word matches a known context (more specific)
    for (const ctx of networkVocabulary.contexts) {
      const ctxLower = ctx.toLowerCase();
      if (words.some(w => w === ctxLower || cmd.toLowerCase().includes(ctxLower))) {
        // Find which domain this context belongs to — return domain
        // For now just return the context as a hint; showDomainHint will search
        return ctx;
      }
    }
    
    // Check if any word matches a known domain
    for (const domain of networkVocabulary.domains) {
      const domainLower = domain.toLowerCase();
      if (words.some(w => w === domainLower || cmd.toLowerCase().includes(domainLower))) {
        return domain;
      }
    }
  }

  // Fallback: static patterns for common tools
  const patterns: [RegExp, string][] = [
    [/\bnpm\b|\byarn\b|\bpnpm\b|\bpackage\.json/, 'npm'],
    [/\bgit\b/, 'git'],
    [/\bdocker\b|\bcontainer/, 'docker'],
    [/\bkubectl\b|\bk8s/, 'k8s'],
    [/\bpsql\b|\bpostgres/, 'postgres'],
    [/\bmysql\b/, 'mysql'],
    [/\bredis/, 'redis'],
    [/\bcurl\b|\bfetch\b|\bhttp/, 'api'],
    [/\baws\b/, 'aws'],
    [/\bgcloud\b/, 'gcp'],
    [/\bazure\b/, 'azure'],
    [/\bstripe\b/, 'stripe'],
    [/\btest\b|\bjest\b|\bvitest\b|\bpytest/, 'testing'],
    [/\bbuild\b|\bwebpack\b|\bvite\b|\besbuild/, 'build'],
    [/\bdeploy\b|\brelease/, 'deploy'],
    [/\bnginx\b/, 'nginx'],
    [/\btailscale\b/, 'tailscale'],
    [/\bpm2\b/, 'pm2'],
    [/\badb\b/, 'adb'],
    [/\bwalmart\b/, 'walmart'],
    [/\bfathom\b/, 'fathom'],
    [/\bdpth\b/, 'dpth'],
    [/\bnext\b|\bnextjs\b/, 'nextjs'],
  ];
  
  for (const [pattern, domain] of patterns) {
    if (pattern.test(cmd)) return domain;
  }
  return null;
}

// Show domain hint (just presence, not advice)
// Searches both as a domain and as a context to find matching signals
async function showDomainHint(hint: string, hinted: Set<string>): Promise<void> {
  if (hinted.has(hint)) return;
  hinted.add(hint);
  
  try {
    // Try as domain first
    let res = await fetch(`${COORDINATOR}/calibrate?domain=${encodeURIComponent(hint)}`, {
      signal: AbortSignal.timeout(2000),
    });
    
    let data = res.ok ? await res.json() : null;
    let count = data?.count || 0;
    let label = hint;
    
    // If no results as domain, try as context
    if (count === 0) {
      res = await fetch(`${COORDINATOR}/calibrate?context=${encodeURIComponent(hint)}`, {
        signal: AbortSignal.timeout(2000),
      });
      data = res.ok ? await res.json() : null;
      count = data?.count || 0;
    }
    
    if (count > 0) {
      console.log(`dpth: ${label} — ${count} signal${count === 1 ? '' : 's'}`);
    }
  } catch {
    // Silent - don't disrupt the command
  }
}
