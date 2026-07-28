import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

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
  plugins: [
    VitePWA({
      // injectManifest (not generateSW) — src/sw.ts owns notification handling
      // and the SPA navigation fallback that generateSW can't express; Workbox
      // only supplies precacheAndRoute(self.__WB_MANIFEST) inside it.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // We register the SW ourselves (src/core/sw-update.ts, via
      // virtual:pwa-register) so the onNeedRefresh toast can use the app's own
      // i18n + toast styling instead of the plugin's injected script.
      injectRegister: false,
      // public/manifest.json is already hand-maintained and referenced from
      // app.html — don't let the plugin generate or touch it.
      manifest: false,
      injectManifest: {
        // The three GIFs alone are ~22MB — way past Workbox's 2MB default,
        // which would otherwise fail the build. They're already excluded from
        // precaching below (globIgnores), so this just covers the rest of the
        // largest chunks (firebase, leaflet) with headroom.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      // Only precache the app build's own assets — the marketing site
      // (public/*.gif, landing images) is served from '/', not '/app', and
      // isn't part of the offline-views goal this stage targets.
      globPatterns: ['**/*.{js,css,html,woff2}'],
      globIgnores: ['**/node_modules/**'],
      devOptions: {
        // Lets `npm run dev` register a real SW for local testing; the plugin
        // otherwise disables itself outside of `vite build`.
        enabled: true,
        type: 'module',
      },
    }),
  ],
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
