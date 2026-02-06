/**
 * dpth serve — run a local coordinator
 * 
 * Starts the dpth coordinator server for local/private networks.
 */

export async function serve(args: string[]): Promise<void> {
  const port = parseInt(args[0]) || 3004;
  
  console.log(`Starting dpth coordinator on port ${port}...`);
  console.log('');
  console.log('For local development, set:');
  console.log(`  export DPTH_COORDINATOR=http://localhost:${port}`);
  console.log('');
  
  // Dynamic import to avoid loading server deps when not needed
  try {
    // The server is in the parent package
    const serverPath = new URL('../../server/index.js', import.meta.url).pathname;
    
    // Set port via env
    process.env.PORT = String(port);
    
    // Import and run the server
    await import(serverPath);
    
  } catch (err) {
    console.error('Failed to start coordinator.');
    console.error('Make sure you have the full dpth package installed (not just the CLI).');
    if (err instanceof Error) {
      console.error('Error:', err.message);
    }
    process.exit(1);
  }
}
