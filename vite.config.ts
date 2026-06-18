import { defineConfig } from 'vite';

// Base path for built asset URLs:
//   - GitHub Pages serves the app under /on-the-road/, set explicitly by the
//     deploy workflow (VITE_BASE_PATH=/on-the-road/).
//   - Vercel serves the app at the domain root (marketing page at /, app at
//     /app), so assets must resolve from an ABSOLUTE '/'. Vercel leaves
//     VITE_BASE_PATH empty, which selects '/' here.
//   - Local dev / unset → '/' too.
// A relative base ('' or './') would break the app at /app — asset URLs would
// resolve against /app/ and 404 — so we always use an absolute base.
const base = process.env.VITE_BASE_PATH?.trim() || '/';

export default defineConfig({
  base,
  build: {
    rollupOptions: {
      // The SPA entry is app.html (served at /app). The marketing landing page
      // is public/index.html, copied verbatim to dist/index.html and served at /
      // by Vercel's filesystem default. Keeping the app out of index.html is what
      // lets the landing page own the domain root.
      input: 'app.html',
    },
  },
  server: {
    port: 5180,
    host: '127.0.0.1',
  },
});
