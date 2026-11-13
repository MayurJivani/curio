import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

const api = 'http://localhost:4431';
export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    host: true,
    proxy: { '/api': api, '/img': api, '/health': api, '/socket.io': { target: api, ws: true } },
  },
  test: { include: ['shared/**/*.test.ts', 'server/**/*.test.ts'] },
});
