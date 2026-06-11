# On the Road — Setup

## Quick start

```bash
cd on-the-road
cp .env.example .env
# Fill in your keys (see below)
npm install
npm run dev
```

Open http://localhost:5173

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

| Route       | Status | Description |
|-------------|--------|-------------|
| `/prep`     | ✅ Full | Timeline-based checklist, 30 pre-loaded tasks, templates, per-category add |
| `/route`    | ✅ Full | City-by-city timeline, pre-seeded Europe itinerary, add/delete stops |
| `/expenses` | ✅ Full | Add expenses, multi-currency, category breakdown, city filter |
| `/cities`   | ✅ Full | DeepSeek AI city cards: greetings, customs, neighborhoods, safety |
| `/pack`     | 🚧 v2  | Packing formula |
| `/budget`   | 🚧 v2  | Accommodation scorer |
| `/safety`   | 🚧 v2  | Solo safety kit |
| `/journal`  | 🚧 v2  | Travel journal |
| `/map`      | 🚧 v2  | Footprint map |

## Build

```bash
npm run build   # outputs to dist/
npm run preview # preview the build locally
```
