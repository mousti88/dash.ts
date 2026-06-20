import { defineConfig } from 'vite';

export default defineConfig({
  // The entry point is index.html in the project root
  root: '.',
  server: {
    port: 3000,
    open: true,  // Auto-open browser on `npm run dev`
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
