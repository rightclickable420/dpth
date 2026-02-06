/**
 * dpth status — show network status
 */

const COORDINATOR = process.env.DPTH_COORDINATOR || 'https://api.dpth.io';

interface NetworkStatus {
  network: {
    name: string;
    version: string;
    uptime: string;
    coordinator: string;
  };
  agents: {
    total: number;
    online: number;
  };
  intelligence: {
    buckets: number;
    domains: number;
    strategies: number;
    totalAttempts: number;
    totalContributions: number;
  };
}

export async function status(): Promise<void> {
  console.log(`Checking ${COORDINATOR}...`);
  console.log('');
  
  try {
    const res = await fetch(COORDINATOR, {
      signal: AbortSignal.timeout(5000),
    });
    
    if (!res.ok) {
      console.error(`Network error: ${res.status}`);
      process.exit(1);
    }
    
    const data: NetworkStatus = await res.json();
    
    console.log('=== dpth network status ===');
    console.log('');
    console.log(`Network:     ${data.network.name} v${data.network.version}`);
    console.log(`Coordinator: ${data.network.coordinator}`);
    console.log(`Uptime:      ${data.network.uptime}`);
    console.log('');
    console.log('Intelligence:');
    console.log(`  Buckets:       ${data.intelligence.buckets}`);
    console.log(`  Domains:       ${data.intelligence.domains}`);
    console.log(`  Strategies:    ${data.intelligence.strategies}`);
    console.log(`  Attempts:      ${data.intelligence.totalAttempts.toLocaleString()}`);
    console.log(`  Contributions: ${data.intelligence.totalContributions}`);
    console.log('');
    console.log(`Agents: ${data.agents.online}/${data.agents.total} online`);
    
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === 'AbortError') {
        console.error('Connection timeout. Is the coordinator running?');
      } else if (err.message.includes('fetch')) {
        console.error('Could not reach dpth network.');
      } else {
        console.error('Error:', err.message);
      }
    }
    process.exit(1);
  }
}
