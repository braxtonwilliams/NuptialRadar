import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
  },
  optimizeDeps: {
    include: ['sql.js/dist/sql-wasm.js'],
  },
  assetsInclude: ['**/*.wasm'],
});
