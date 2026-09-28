# Launch checklist

Findings from the 2026-07-28 full audit (code, security, performance,
offline, product). Ordered by priority — P0 blocks launch.

## P0 — launch blockers

- [ ] **Convert the three large GIFs to webm/mp4** (`location.gif` 11.5MB,
      `travel.gif` 8.3MB, `logo.gif` 2.2MB — 22MB of a 23MB dist).
      `app.html` eager-loads ~10.5MB of them on the auth screen. Follow the
      existing `logo.webm` precedent; expect ~90% size reduction.
- [ ] **Authenticate `/api/places`.** Currently no auth + `Access-Control-Allow-Origin: *`
      — anyone can burn the Google Places quota. Require a Firebase ID token
      (anonymous users get one too) and set a quota cap on the key in Google
      Cloud console as a backstop.
- [ ] **Server-side rate limiting** across `api/` (token bucket per uid+IP,
      e.g. Vercel KV/Upstash). AI credits meter usage but nothing returns 429.

## P1 — launch week

- [ ] **Move the hand-written SW to workbox / vite-plugin-pwa**: precache all
      view chunks (today, offline only works for pages already visited) and
      add a "new version available — reload" prompt (today, cache name is
      bumped by hand, users never know an update landed).
- [ ] **i18n policy**: en/zh are complete; es/fr/ja/ko are ~30% and already
      hidden from the picker. Launch advertising EN/ZH only.
- [ ] **Cleanup**: delete `src/style.css` (unreferenced Vite template leftover
      — contains a dark-mode block that misleads), `firestore-debug.log`.

## P2 — post-launch

- [ ] **Product slimming decision**: Nomad and Compare are the weakest links
      to the planning core (narrow audience, no cross-feature links) —
      candidates to demote or cut. Safety: consider demoting from top-level
      nav. Clarify Pack vs Checklist overlap.
- [ ] **Dark mode**: the iOS app has a full dark theme; the web has none.
      Decide: build it (CSS variable system is ready) or explicitly defer.
- [ ] **Big-view-file rule**: `map.ts` (1803), `itinerary.ts` (1799),
      `expenses.ts` (1468), `guide.ts` (1457), `dashboard.ts` (1331) may only
      shrink. New code goes in submodules (see `views/journal/` for the pattern).

## Verified healthy (no action)

Layered architecture with all stores from one factory · 18 test files incl.
Firestore rules against a real emulator · six-gate CI · systematic XSS
escaping with tiered ESLint enforcement · `.env` never in git history ·
token verification + server-only keys in `api/` · dev/prod Firebase split ·
lazy-loaded views with a separate firebase chunk.
