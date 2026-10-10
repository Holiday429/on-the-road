import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import type { Plugin } from 'vite';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Warm the app's entry bundle from the marketing page.
 *
 * Every landing-page CTA goes to /app, and the app's JS/CSS filenames are hashed,
 * so only the build knows them. After the bundle is written, read the app shell
 * (dist/app.html), collect the entry script + its modulepreload chain + stylesheet,
 * and inject a tiny idle-time prefetcher into dist/index.html at the
 * <!-- @app-prefetch --> marker. By the time a visitor clicks "Open app" the
 * code is already in the HTTP cache. Skipped on Save-Data and 2G connections.
 *
 * Runs in writeBundle so it lands BEFORE vite-plugin-pwa's closeBundle computes
 * the precache revisions — index.html must not change after that.
 */
function landingPrefetch(): Plugin {
  return {
    name: 'landing-prefetch-app',
    apply: 'build',
    writeBundle(options) {
      const out = options.dir ?? 'dist';
      const appPath = join(out, 'app.html');
      const landingPath = join(out, 'index.html');
      if (!existsSync(appPath) || !existsSync(landingPath)) return;

      const app = readFileSync(appPath, 'utf8');
      const urls = new Set<string>();
      const grab = (re: RegExp) => { for (const m of app.matchAll(re)) urls.add(m[1]); };
      grab(/<script[^>]+type="module"[^>]+src="([^"]+)"/g);
      grab(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g);
      grab(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g);
      // Hashed build output only — fonts are already warm from the landing page.
      const list = [...urls].filter((u) => u.includes('/assets/'));
      if (!list.length) return;

      const snippet = `<script>
  (function () {
    var c = navigator.connection;
    if (c && (c.saveData || /2g/.test(c.effectiveType || ''))) return;
    var urls = ${JSON.stringify(list)};
    function warm() {
      urls.forEach(function (u) {
        var l = document.createElement('link');
        l.rel = 'prefetch'; l.as = /\.css$/.test(u) ? 'style' : 'script';
        l.href = u; l.crossOrigin = '';
        document.head.appendChild(l);
      });
    }
    window.addEventListener('load', function () { (window.requestIdleCallback || setTimeout)(warm); });
  })();
</script>`;
      const landing = readFileSync(landingPath, 'utf8');
      if (!landing.includes('<!-- @app-prefetch -->')) return;
      writeFileSync(landingPath, landing.replace('<!-- @app-prefetch -->', snippet));
    },
  };
}

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
    landingPrefetch(),
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
          // Only the Guide/Itinerary/Journal views use Leaflet. Without an explicit
          // chunk, Rolldown parks its shared runtime helpers inside the Leaflet
          // chunk, so the entry bundle imports it and every first paint pays for
          // 149KB of map library (+ its CSS) that the dashboard never touches.
          if (id.includes('node_modules/leaflet')) {
            return 'leaflet';
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
