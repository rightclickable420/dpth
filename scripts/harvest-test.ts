#!/usr/bin/env npx tsx
/**
 * GitHub Commit Harvester - Prototype Test
 * Parses conventional commits for dpth signals
 */

interface ParsedSignal {
  domain: string;
  context: string;
  strategy: string;
  outcome: number;
  source: string;
  sha: string;
}

// Conventional commit patterns that indicate learning
const SIGNAL_PATTERNS = [
  // fix(scope): description -> something was broken, now fixed
  /^fix\(([^)]+)\):\s*(.+)/i,
  // fix: description -> general fix
  /^fix:\s*(.+)/i,
  // refactor(scope): description -> improvement
  /^refactor\(([^)]+)\):\s*(.+)/i,
  // perf(scope): description -> performance fix
  /^perf\(([^)]+)\):\s*(.+)/i,
];

function parseCommit(message: string, sha: string): ParsedSignal | null {
  const firstLine = message.split('\n')[0];
  
  // fix(scope): message
  let match = firstLine.match(/^fix\(([^)]+)\):\s*(.+)/i);
  if (match) {
    const [, scope, desc] = match;
    return {
      domain: extractDomain(scope, desc),
      context: scope.toLowerCase(),
      strategy: extractStrategy(desc),
      outcome: 1, // fix commits are successful resolutions
      source: 'github',
      sha: sha.slice(0, 7)
    };
  }
  
  // fix: message (no scope)
  match = firstLine.match(/^fix:\s*(.+)/i);
  if (match) {
    const desc = match[1];
    return {
      domain: extractDomain('general', desc),
      context: 'general',
      strategy: extractStrategy(desc),
      outcome: 1,
      source: 'github',
      sha: sha.slice(0, 7)
    };
  }
  
  return null;
}

function extractDomain(scope: string, desc: string): string {
  const lower = (scope + ' ' + desc).toLowerCase();
  
  // Common domain patterns
  if (/api|endpoint|rest|graphql/i.test(lower)) return 'api';
  if (/ui|css|style|layout|component/i.test(lower)) return 'ui';
  if (/auth|login|token|session/i.test(lower)) return 'auth';
  if (/db|database|query|migration/i.test(lower)) return 'database';
  if (/test|spec|jest|vitest/i.test(lower)) return 'testing';
  if (/build|webpack|vite|bundle/i.test(lower)) return 'build';
  if (/type|typescript|ts/i.test(lower)) return 'types';
  if (/lint|eslint|format/i.test(lower)) return 'lint';
  if (/dep|package|npm|yarn/i.test(lower)) return 'deps';
  if (/ci|action|workflow|deploy/i.test(lower)) return 'ci';
  
  return scope.toLowerCase() || 'general';
}

function extractStrategy(desc: string): string {
  const lower = desc.toLowerCase();
  
  // Extract action verbs and key patterns
  const strategies = [
    [/add.*null.*check|null.*safe/i, 'null_check'],
    [/handle.*error|catch.*exception/i, 'error_handling'],
    [/fix.*type|type.*error/i, 'type_fix'],
    [/remove.*unused|clean.*up/i, 'cleanup'],
    [/update.*dep|bump.*version/i, 'dep_update'],
    [/fix.*import|missing.*import/i, 'import_fix'],
    [/correct.*path|fix.*path/i, 'path_fix'],
    [/escape|sanitize|encode/i, 'sanitization'],
    [/timeout|retry|backoff/i, 'retry_logic'],
    [/cache|memo/i, 'caching'],
    [/async|await|promise/i, 'async_fix'],
    [/race.*condition|concurrent/i, 'concurrency_fix'],
  ];
  
  for (const [pattern, strategy] of strategies) {
    if ((pattern as RegExp).test(desc)) return strategy as string;
  }
  
  // Fallback: extract first verb phrase
  const verbMatch = desc.match(/^(\w+)\s+/);
  return verbMatch ? verbMatch[1].toLowerCase() : 'fix';
}

// Test with sample commits (simulating GitHub API response)
const testCommits = [
  { sha: 'abc1234', message: 'fix(ui): correct padding on mobile breakpoints' },
  { sha: 'def5678', message: 'fix(api): handle null response from upstream service' },
  { sha: 'ghi9012', message: 'fix: remove unused imports causing build warning' },
  { sha: 'jkl3456', message: 'fix(auth): add token refresh retry logic' },
  { sha: 'mno7890', message: 'fix(db): escape special characters in search query' },
  { sha: 'pqr1234', message: 'feat: add new dashboard widget' }, // Should be ignored
  { sha: 'stu5678', message: 'fix(types): correct return type for async handler' },
  { sha: 'vwx9012', message: 'docs: update README' }, // Should be ignored
  { sha: 'yza3456', message: 'fix(ci): increase timeout for integration tests' },
  { sha: 'bcd7890', message: 'refactor(api): simplify error handling' }, // Not captured yet
];

console.log('🔍 GitHub Commit Harvester - Test Run\n');
console.log('=' .repeat(60));

const signals: ParsedSignal[] = [];

for (const commit of testCommits) {
  const signal = parseCommit(commit.message, commit.sha);
  if (signal) {
    signals.push(signal);
    console.log(`\n✓ ${commit.sha.slice(0,7)}: ${commit.message.slice(0,50)}...`);
    console.log(`  → domain: ${signal.domain}, context: ${signal.context}, strategy: ${signal.strategy}`);
  } else {
    console.log(`\n○ ${commit.sha.slice(0,7)}: ${commit.message.slice(0,50)} (skipped)`);
  }
}

console.log('\n' + '='.repeat(60));
console.log(`\n📊 Results: ${signals.length}/${testCommits.length} commits yielded signals\n`);

// Group by domain
const byDomain = signals.reduce((acc, s) => {
  acc[s.domain] = (acc[s.domain] || 0) + 1;
  return acc;
}, {} as Record<string, number>);

console.log('By Domain:');
Object.entries(byDomain).sort((a, b) => b[1] - a[1]).forEach(([d, c]) => {
  console.log(`  ${d}: ${c}`);
});

// Group by strategy
const byStrategy = signals.reduce((acc, s) => {
  acc[s.strategy] = (acc[s.strategy] || 0) + 1;
  return acc;
}, {} as Record<string, number>);

console.log('\nBy Strategy:');
Object.entries(byStrategy).sort((a, b) => b[1] - a[1]).forEach(([s, c]) => {
  console.log(`  ${s}: ${c}`);
});

console.log('\n📝 Sample dpth log commands:');
signals.slice(0, 3).forEach(s => {
  console.log(`  dpth log ${s.domain} ${s.context} ${s.strategy} success`);
});
