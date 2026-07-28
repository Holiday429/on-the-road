# On the Road

A collaborative trip planner: itinerary, packing, expenses, city guides, a
data-driven world map of your footprint, safety briefings, and a travel
journal — with AI assists throughout and Google-Sheets-style sharing.

Live at **https://easy-on-the-road.vercel.app** (marketing page at `/`, the
app at `/app`).

## Quick start

```bash
cp .env.example .env      # then fill in your keys — see SETUP.md
npm install
npm run dev               # http://localhost:5180
```

You need a Firebase project (Firestore + Auth) and a DeepSeek API key for the
AI features. Full walkthrough — including the dev-vs-prod Firebase split — is
in **[SETUP.md](SETUP.md)**.

## Stack

- **Frontend**: vanilla TypeScript + [Vite](https://vite.dev) SPA. No UI
  framework — views render to strings and mount into the DOM shell.
- **Backend**: [Firebase](https://firebase.google.com) (Firestore, Auth,
  Storage) + [Vercel serverless functions](https://vercel.com/docs/functions)
  under `api/` for the money and AI paths (the DeepSeek key never reaches the
  browser).
- **Validation**: [zod](https://zod.dev) — one schema per stored document,
  the single source of truth for both runtime validation and TypeScript types.
- **Map**: [amCharts 5](https://www.amcharts.com) (globe/geo) + Leaflet
  (per-city plan maps), both loaded lazily.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on :5180 |
| `npm run build` | Typecheck (`tsc`) then production build |
| `npm test` | Unit tests (vitest) |
| `npm run test:rules` | Firestore security-rules tests against a real emulator (needs JDK 21+) |
| `npm run lint` | ESLint |
| `npm run deploy:rules:dev` / `:prod` | Deploy Firestore rules to the dev / prod project |

## Architecture

Three layers, cleanly separated:

```
src/views/        feature UIs (dashboard, itinerary, map, expenses, guide, …)
src/data/stores/  18 Firestore-backed stores, all built on one factory
src/firebase/     Firebase SDK adapters (db.ts is the store factory)
src/core/         app shell, router, i18n, shared utilities
api/              Vercel serverless functions (billing, AI proxies, receipts)
```

- **Stores** are created by `createCollectionStore` (trip-scoped),
  `createTaggedCollectionStore` (trip-tagged, aggregatable across trips), or
  `createUserCollectionStore` (user-scoped) in
  [`src/firebase/db.ts`](src/firebase/db.ts). Firestore is the source of truth;
  localStorage is an offline cache that paints instantly and queues offline
  writes.
- **Boot** is a small state machine (guest / viewer / authenticated shells)
  in `src/boot-*.ts`, with the routing decisions extracted as pure, tested
  functions in [`src/boot-flow.ts`](src/boot-flow.ts).
- **Escaping**: user- and AI-controlled data is escaped via `escHtml()` /
  `safeUrl()` before it reaches `innerHTML`. A tiered ESLint rule fails the
  build on new un-audited `innerHTML` in the reviewed files.

## CI

Every push and PR runs a six-gate pipeline (`.github/workflows/ci.yml`):
typecheck → lint → runtime-dependency audit → unit tests → Firestore rules
tests (real emulator) → production build. Green is required before merge.

## Status

Pre-launch. A full audit (2026-07-28) found the engineering fundamentals
sound. `/api/places` auth and server-side rate limiting are done (see
SECURITY.md); remaining pre-launch work — GIF asset weight, PWA offline
polish, and cleanup — is tracked internally.

## Documentation

- **[SETUP.md](SETUP.md)** — environment setup, keys, dev/prod Firebase split.
- **[SECURITY.md](SECURITY.md)** — dependency-audit policy, rules deployment,
  and case studies of two production bugs the rules tests caught.
