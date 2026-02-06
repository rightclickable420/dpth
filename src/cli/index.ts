#!/usr/bin/env node
/**
 * dpth CLI — query, log, and watch the dpth network
 * 
 * Commands:
 *   dpth query [domain] [context]     Query network intelligence
 *   dpth log <domain> <ctx> <strat>   Log a signal outcome
 *   dpth watch -- <command>           Watch a command and auto-log
 *   dpth serve [port]                 Run local coordinator
 *   dpth status                       Network status
 */

import { query } from './query.js';
import { log } from './log.js';
import { watch } from './watch.js';
import { serve } from './serve.js';
import { status } from './status.js';

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  try {
    switch (command) {
      case 'query':
      case 'q':
        await query(args.slice(1));
        break;
        
      case 'log':
      case 'l':
        await log(args.slice(1));
        break;
        
      case 'watch':
      case 'w':
        // Find -- separator
        const dashIdx = args.indexOf('--');
        if (dashIdx === -1) {
          console.error('Usage: dpth watch [options] -- <command>');
          process.exit(1);
        }
        const watchOpts = args.slice(1, dashIdx);
        const cmd = args.slice(dashIdx + 1);
        await watch(watchOpts, cmd);
        break;
        
      case 'serve':
      case 's':
        await serve(args.slice(1));
        break;
        
      case 'status':
        await status();
        break;
        
      case 'help':
      case '--help':
      case '-h':
        printHelp();
        break;
        
      case 'version':
      case '--version':
      case '-v':
        console.log(getVersion());
        break;
        
      default:
        if (!command) {
          printHelp();
        } else {
          console.error(`Unknown command: ${command}`);
          console.error('Run `dpth help` for usage.');
          process.exit(1);
        }
    }
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
dpth — Collective intelligence for AI agents

COMMANDS
  dpth query [domain] [context]     Query what the network knows
  dpth log <domain> <ctx> <strat>   Log a signal (outcome: success/failure)
  dpth watch -- <command>           Watch command, auto-log outcomes
  dpth serve [port]                 Run local coordinator (default: 3004)
  dpth status                       Show network status

EXAMPLES
  dpth query api stripe             What works for Stripe API?
  dpth log api stripe retry success Record a successful retry
  dpth watch -- claude-code "fix"   Watch Claude Code session
  dpth serve 8080                   Run coordinator on port 8080

OPTIONS
  -h, --help      Show this help
  -v, --version   Show version

NETWORK
  Default: https://api.dpth.io (public network)
  Set DPTH_COORDINATOR to use a different endpoint.

Learn more: https://dpth.io
`);
}

function getVersion(): string {
  // Read from package.json at runtime
  try {
    const pkg = require('../../package.json');
    return `dpth v${pkg.version}`;
  } catch {
    return 'dpth v0.5.0';
  }
}

main();
