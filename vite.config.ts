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
      output: {
        // Firebase is the single largest dependency and changes far less
        // often than app code — its own chunk means a normal app deploy
        // doesn't invalidate the browser's cache of it. (Rolldown's
        // manualChunks takes a function, not the classic Rollup object form.)
        manualChunks(id: string) {
          if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) {
            return 'firebase';
          }
        },
      },
    },
  },
  server: {
    port: 5180,
    host: '127.0.0.1',
  },
});
