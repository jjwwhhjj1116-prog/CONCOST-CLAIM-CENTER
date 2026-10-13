import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { html2canvasSource, stablePdfFontMetrics } from './pdf-font-metrics';

export default defineConfig({
  plugins: [react(), stablePdfFontMetrics()],
  resolve: {
    alias: [
      { find: '@claim-studio/ui', replacement: fileURLToPath(new URL('../../packages/ui/src/index.ts', import.meta.url)) },
      { find: /^html2canvas$/, replacement: html2canvasSource }
    ]
  },
  optimizeDeps: { exclude: ['html2canvas'] },
  server: {
    port: 3000
  }
});
