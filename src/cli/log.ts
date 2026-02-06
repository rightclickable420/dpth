/**
 * dpth log — record an outcome to the network
 */

const COORDINATOR = process.env.DPTH_COORDINATOR || 'https://api.dpth.io';

export async function log(args: string[]): Promise<void> {
  // Parse: dpth log <domain> <context> <strategy> <outcome> [condition] [cost]
  // Or with flags: dpth log --domain=api --context=stripe --strategy=retry --outcome=success
  
  let domain: string | undefined;
  let context: string | undefined;
  let strategy: string | undefined;
  let outcome: string | undefined;
  let condition: string | undefined;
  let cost: number = 0;
  
  // Check for flag-style args
  const flagArgs = args.filter(a => a.startsWith('--'));
  const posArgs = args.filter(a => !a.startsWith('--'));
  
  if (flagArgs.length > 0) {
    for (const flag of flagArgs) {
      const [key, value] = flag.slice(2).split('=');
      if (key === 'domain') domain = value;
      else if (key === 'context') context = value;
      else if (key === 'strategy') strategy = value;
      else if (key === 'outcome') outcome = value;
      else if (key === 'condition') condition = value;
      else if (key === 'cost') cost = parseFloat(value) || 0;
    }
  } else {
    // Positional args
    [domain, context, strategy, outcome, condition] = posArgs;
    if (posArgs[5]) cost = parseFloat(posArgs[5]) || 0;
  }
  
  if (!domain || !context || !strategy || !outcome) {
    console.log('Usage: dpth log <domain> <context> <strategy> <outcome> [condition] [cost]');
    console.log('');
    console.log('Outcome: success, failure, partial, or 0-1 number');
    console.log('');
    console.log('Examples:');
    console.log('  dpth log api stripe retry_60s success');
    console.log('  dpth log tool web_fetch blocked failure');
    console.log('  dpth log css tailwind4 avoid_global_reset success');
    return;
  }
  
  // Normalize
  domain = normalize(domain);
  context = normalize(context);
  strategy = normalize(strategy);
  
  // Sort context if it has + (for consistent keys)
  if (context.includes('+')) {
    context = context.split('+').sort().join('+');
  }
  
  // Convert outcome to successes/failures
  let successes = 0;
  let failures = 0;
  
  switch (outcome.toLowerCase()) {
    case 'success':
    case '1':
    case 'true':
      successes = 1;
      break;
    case 'failure':
    case 'fail':
    case '0':
    case 'false':
      failures = 1;
      break;
    case 'partial':
    case '0.5':
      successes = 1;
      failures = 1;
      break;
    default:
      const num = parseFloat(outcome);
      if (!isNaN(num) && num >= 0 && num <= 1) {
        if (num >= 0.5) successes = 1;
        else failures = 1;
      } else {
        console.error(`Invalid outcome: ${outcome}`);
        console.error('Use: success, failure, partial, or a number 0-1');
        process.exit(1);
      }
  }
  
  const totalAttempts = successes + failures;
  
  const body = {
    domain,
    context,
    strategy,
    successes,
    failures,
    totalAttempts,
    cost,
    ...(condition && { condition: normalize(condition) }),
  };
  
  try {
    const res = await fetch(`${COORDINATOR}/signals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Network error: ${res.status} - ${text}`);
    }
    
    const data = await res.json();
    
    if (data.accepted) {
      const outcomeStr = successes > failures ? 'success' : failures > successes ? 'failure' : 'partial';
      console.log(`✓ dpth: ${domain}/${context}/${strategy} → ${outcomeStr}`);
      if (data.bucket) {
        const pct = Math.round(data.bucket.successRate * 100);
        console.log(`  Network: ${pct}% success rate (${data.bucket.attempts} total attempts)`);
      }
    } else {
      console.error('Signal rejected:', data.error || 'Unknown error');
      process.exit(1);
    }
    
  } catch (err) {
    if (err instanceof Error && err.message.includes('fetch')) {
      console.error('Could not reach dpth network. Check your connection or DPTH_COORDINATOR.');
    } else {
      throw err;
    }
  }
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '_');
}
