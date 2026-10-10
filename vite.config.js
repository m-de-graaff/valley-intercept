import { defineConfig } from 'vite';

// Relative base so the built game runs from any folder or static host.
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 800 },
});
