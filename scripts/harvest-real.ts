#!/usr/bin/env npx tsx
/**
 * Test harvester on real GitHub commits
 */

const REPOS = [
  'vercel/next.js',
  'facebook/react', 
  'microsoft/vscode',
];

async function fetchCommits(repo: string, limit = 100): Promise<any[]> {
  const url = `https://api.github.com/repos/${repo}/commits?per_page=${limit}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'dpth-harvester' }
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function parseCommit(message: string): { domain: string; context: string; strategy: string } | null {
  const firstLine = message.split('\n')[0];
  
  // fix(scope): message
  let match = firstLine.match(/^fix\(([^)]+)\):\s*(.+)/i);
  if (match) {
    const [, scope, desc] = match;
    return { domain: extractDomain(scope, desc), context: scope.toLowerCase(), strategy: extractStrategy(desc) };
  }
  
  // fix: message
  match = firstLine.match(/^fix:\s*(.+)/i);
  if (match) {
    return { domain: extractDomain('', match[1]), context: 'general', strategy: extractStrategy(match[1]) };
  }
  
  return null;
}

function extractDomain(scope: string, desc: string): string {
  const lower = (scope + ' ' + desc).toLowerCase();
  if (/api|endpoint|rest|graphql|fetch/i.test(lower)) return 'api';
  if (/ui|css|style|layout|component|render/i.test(lower)) return 'ui';
  if (/auth|login|token|session|cookie/i.test(lower)) return 'auth';
  if (/db|database|query|prisma|sql/i.test(lower)) return 'database';
  if (/test|spec|jest|vitest|cypress/i.test(lower)) return 'testing';
  if (/build|webpack|vite|bundle|turbopack/i.test(lower)) return 'build';
  if (/type|typescript|ts\b/i.test(lower)) return 'types';
  if (/lint|eslint|format|prettier/i.test(lower)) return 'lint';
  if (/dep|package|npm|yarn|pnpm/i.test(lower)) return 'deps';
  if (/ci|action|workflow|deploy|release/i.test(lower)) return 'ci';
  if (/doc|readme|comment/i.test(lower)) return 'docs';
  if (/cache|memo|perf|optim/i.test(lower)) return 'performance';
  if (/error|exception|crash|bug/i.test(lower)) return 'error_handling';
  return scope.toLowerCase() || 'general';
}

function extractStrategy(desc: string): string {
  const patterns: [RegExp, string][] = [
    [/null.*check|undefined|optional/i, 'null_safety'],
    [/handle.*error|catch|try/i, 'error_handling'],
    [/type|typing|inference/i, 'type_fix'],
    [/remove|delete|clean/i, 'cleanup'],
    [/update|upgrade|bump/i, 'update'],
    [/import|export|module/i, 'module_fix'],
    [/path|route|url/i, 'path_fix'],
    [/escape|sanitize|encode|xss/i, 'sanitization'],
    [/timeout|retry|backoff/i, 'retry'],
    [/cache|memo|store/i, 'caching'],
    [/async|await|promise|concurrent/i, 'async_fix'],
    [/race|deadlock|mutex/i, 'concurrency'],
    [/memory|leak|gc/i, 'memory_fix'],
    [/correct|fix|repair/i, 'correction'],
    [/revert|rollback/i, 'revert'],
  ];
  for (const [p, s] of patterns) if (p.test(desc)) return s;
  return 'fix';
}

async function main() {
  console.log('🔍 Real GitHub Commit Harvester Test\n');
  
  let totalCommits = 0;
  let totalSignals = 0;
  const allSignals: any[] = [];
  
  for (const repo of REPOS) {
    console.log(`\n📦 ${repo}`);
    console.log('-'.repeat(40));
    
    try {
      const commits = await fetchCommits(repo, 100);
      let signals = 0;
      
      for (const c of commits) {
        const parsed = parseCommit(c.commit.message);
        if (parsed) {
          signals++;
          allSignals.push({ repo, ...parsed, sha: c.sha.slice(0, 7) });
          if (signals <= 3) {
            console.log(`  ✓ ${c.sha.slice(0,7)}: ${c.commit.message.split('\n')[0].slice(0,50)}`);
            console.log(`    → ${parsed.domain}/${parsed.context}/${parsed.strategy}`);
          }
        }
      }
      
      console.log(`  ... ${signals}/${commits.length} commits → signals`);
      totalCommits += commits.length;
      totalSignals += signals;
    } catch (e: any) {
      console.log(`  ✗ Error: ${e.message}`);
    }
  }
  
  console.log('\n' + '='.repeat(50));
  console.log(`📊 TOTAL: ${totalSignals}/${totalCommits} commits (${(totalSignals/totalCommits*100).toFixed(1)}%)`);
  
  // Aggregate stats
  const domains = allSignals.reduce((a, s) => { a[s.domain] = (a[s.domain] || 0) + 1; return a; }, {} as Record<string, number>);
  const strategies = allSignals.reduce((a, s) => { a[s.strategy] = (a[s.strategy] || 0) + 1; return a; }, {} as Record<string, number>);
  
  console.log('\n📈 Top Domains:');
  Object.entries(domains).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([d, c]) => console.log(`  ${d}: ${c}`));
  
  console.log('\n🎯 Top Strategies:');
  Object.entries(strategies).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([s, c]) => console.log(`  ${s}: ${c}`));
}

main().catch(console.error);
