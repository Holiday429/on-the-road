import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/on-the-road/',
  server: {
    port: 5180,
  },
});
