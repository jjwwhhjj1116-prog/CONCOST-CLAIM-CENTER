import type { InlineConfig } from 'vite';

// Resolve through the web workspace so pnpm dependencies retain their real paths.
export async function createServer(config: InlineConfig) {
  return (await import('vite')).createServer(config);
}
