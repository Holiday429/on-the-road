# On the Road — Setup

## Quick start

```bash
cd on-the-road
cp .env.example .env
# Fill in your keys (see below)
npm install
npm run dev
```

Open http://localhost:5180

---

## Environment variables (.env)

### Firebase
Copy your Firebase project config from the Firebase Console → Project Settings:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

> Firestore is the source of truth; localStorage is only an offline cache that
> paints the UI instantly and queues writes while offline.

**Use the `on-the-road-dev` project for local development, not production.**
Local dev, CI, and Vercel Preview deploys all point at `on-the-road-dev`;
only the production Vercel deploy (main branch) points at `on-the-road-trip`.
This keeps local testing, a broken migration, or a stray script from ever
touching real user data. `.firebaserc`'s `default` alias is `on-the-road-dev`
for the same reason — Firebase CLI commands without an explicit `--project`
land on dev, not prod (see `npm run deploy:rules:dev` / `:prod` and
SECURITY.md). If `on-the-road-dev` doesn't exist yet: Firebase Console →
Add project → enable Firestore (production mode) + Authentication
(Anonymous + Google providers) → Authentication → Settings → Authorized
domains → add `localhost` and `127.0.0.1` → deploy the rules with
`npm run deploy:rules:dev`.

### DeepSeek (powers all AI: Guide, Safety, Checklist check, Journal recap)
Get your key from https://platform.deepseek.com

```
DEEPSEEK_API_KEY=sk-...
```

This is a **server-side only** variable (no `VITE_` prefix) — all AI calls go
through the `/api/*` serverless functions so the key never reaches the browser.
Without it, AI features fall back to generic templates / heuristics.

Optional server-side keys: `TAVILY_API_KEY` (web-search grounding for Safety),
`UNSPLASH_ACCESS_KEY` (Guide card photos), `GOOGLE_GEOCODING_KEY`.

---

## What's built

All routes are shipped and in active use.

| Route       | Description |
|-------------|-------------|
| `/prep`     | Timeline-based checklist, templates, per-category add |
| `/route`    | City-by-city itinerary, multi-country trips, drag-and-drop stops |
| `/pack`     | Weight-aware packing lists, reusable core kit, per-bag limits |
| `/budget`   | Compare (flights/trains/stays/shopping) |
| `/cities`   | DeepSeek AI city guides: attractions, food, culture, safety |
| `/map`      | Interactive world map — auto-lit route, flight arcs, country drill-down |
| `/nomad`    | Work-friendly spot ratings (wifi/power/vibe) for digital nomads |
| `/safety`   | Emergency numbers, embassy info, local scams, personal medical card |
| `/expenses` | Multi-currency expense tracking, category/day/country breakdown |
| `/journal`  | Travel journal with photo capture, AI-generated trip recap |
| `/calendar` | Full calendar view (accessible from the Dashboard) |

## Build

```bash
npm run build   # outputs to dist/
npm run preview # preview the build locally
```
