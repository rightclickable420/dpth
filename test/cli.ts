/**
 * CLI Tests — verify dpth CLI commands work
 */

import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '../bin/dpth.js');
const run = (args: string) => execSync(`node ${CLI} ${args}`, { encoding: 'utf-8' });

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

console.log('\n━━━ dpth CLI Tests ━━━\n');

console.log('Help & Version:');
test('help shows usage', () => {
  const out = run('help');
  assert(out.includes('dpth —'), 'should show title');
  assert(out.includes('COMMANDS'), 'should show commands');
  assert(out.includes('query'), 'should mention query');
  assert(out.includes('watch'), 'should mention watch');
});

test('--help works', () => {
  const out = run('--help');
  assert(out.includes('COMMANDS'), 'should show commands');
});

test('--version shows version', () => {
  const out = run('--version');
  assert(out.includes('dpth v'), 'should show version');
});

console.log('\nStatus:');
test('status connects to network', () => {
  const out = run('status');
  assert(out.includes('dpth network status'), 'should show status header');
  assert(out.includes('Coordinator'), 'should show coordinator');
  assert(out.includes('Intelligence'), 'should show intelligence section');
});

console.log('\nQuery:');
test('query with no args shows usage', () => {
  const out = run('query');
  assert(out.includes('Usage:'), 'should show usage');
});

test('query ui returns results', () => {
  const out = run('query ui');
  // Might have results or "exploring new territory"
  assert(out.includes('dpth') || out.includes('exploring'), 'should return something');
});

console.log('\nLog:');
test('log with no args shows usage', () => {
  const out = run('log');
  assert(out.includes('Usage:'), 'should show usage');
});

test('log signal works', () => {
  const out = run('log test cli_test test_signal success');
  assert(out.includes('✓ dpth:'), 'should confirm signal');
  assert(out.includes('test/cli_test/test_signal'), 'should show path');
});

console.log('\nWatch:');
test('watch with no command shows usage', () => {
  try {
    run('watch');
  } catch (err: any) {
    assert(err.message.includes('Usage:') || err.status === 1, 'should error with usage');
  }
});

test('watch runs simple command', () => {
  const out = run('watch -- echo hello');
  assert(out.includes('dpth watcher active'), 'should show watcher banner');
  assert(out.includes('hello'), 'should show command output');
  assert(out.includes('summary'), 'should show summary');
});

console.log('\n━━━ Results:', passed, 'passed,', failed, 'failed ━━━\n');

if (failed > 0) process.exit(1);
