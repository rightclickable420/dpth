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
    stats: { toolCalls: 0, failures: 0, warnings: 0, logged: 0 },
  };
  
  if (!quiet) {
    console.log(`🔍 dpth watcher active`);
    console.log(`   Running: ${cmd.join(' ')}`);
    console.log('');
  }
  
  // Spawn the child process
  const child = spawn(cmd[0], cmd.slice(1), {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true,
  });
  
  // Process stdout
  child.stdout?.on('data', (data: Buffer) => {
    const text = data.toString();
    process.stdout.write(text);
    processOutput(text, state, 'stdout', verbose, quiet);
  });
  
  // Process stderr
  child.stderr?.on('data', (data: Buffer) => {
    const text = data.toString();
    process.stderr.write(text);
    processOutput(text, state, 'stderr', verbose, quiet);
  });
  
  // Handle exit
  child.on('close', async (code) => {
    // Log any pending outcomes as unknown
    for (const [key, pending] of state.pendingOutcomes) {
      await logSignal(pending.domain, pending.context, pending.strategy, code === 0 ? 1 : 0);
      state.stats.logged++;
    }
    
    if (!quiet) {
      console.log('');
      console.log(`🔍 dpth watcher summary:`);
      console.log(`   Tool calls detected: ${state.stats.toolCalls}`);
      console.log(`   Failures detected: ${state.stats.failures}`);
      console.log(`   Warnings shown: ${state.stats.warnings}`);
      console.log(`   Signals logged: ${state.stats.logged}`);
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
  quiet: boolean
): Promise<void> {
  const lines = text.split('\n');
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    // Detect tool calls
    if (PATTERNS.toolCall.test(line)) {
      state.stats.toolCalls++;
      state.lastToolCall = line.slice(0, 100);
      
      // Try to identify domain
      for (const [domain, pattern] of Object.entries(PATTERNS.domains)) {
        if (pattern.test(line)) {
          state.currentDomain = domain;
          break;
        }
      }
      
      if (verbose) {
        console.log(`   [dpth] Tool detected: ${state.currentDomain || 'unknown'}`);
      }
    }
    
    // Detect errors/failures
    if (PATTERNS.error.test(line)) {
      state.stats.failures++;
      
      const domain = state.currentDomain || detectDomain(line);
      const context = extractContext(line);
      
      // Query dpth for relevant signals
      if (domain) {
        const signals = await querySignals(domain, context);
        if (signals.length > 0 && !quiet) {
          state.stats.warnings++;
          console.log('');
          console.log(`   💡 dpth: Known patterns for ${domain}/${context || '*'}:`);
          for (const sig of signals.slice(0, 3)) {
            const pct = Math.round(sig.successRate * 100);
            console.log(`      ${sig.strategy}: ${pct}% success`);
          }
          console.log('');
        }
        
        // Start tracking this as a pending outcome
        const key = `${domain}:${context}:${Date.now()}`;
        state.pendingOutcomes.set(key, {
          domain,
          context: context || 'general',
          strategy: 'auto_detected',
          startTime: Date.now(),
        });
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
