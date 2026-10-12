import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5180, strictPort: true },
  preview: { host: true, port: 4180, strictPort: true },
  build: { chunkSizeWarningLimit: 4000 },
  // Lazily imported libraries, pre-bundled so the dev server doesn't reload the page on first use.
  optimizeDeps: { include: ['@spotify/basic-pitch', '@tensorflow/tfjs', 'opensheetmusicdisplay', '@tonejs/midi'] },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
