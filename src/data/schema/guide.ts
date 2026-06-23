import { z } from 'zod';
import { doc } from './base.ts';


/* ── City intel (AI cache) ───────────────────────────────────────────────── */

// A single actionable "Do" card — attraction, restaurant, café, experience, city walk.
export const GuideCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  highlight: z.string(),           // one-liner shown on card front
  detail: z.string(),              // full description shown in the detail modal
  background: z.string().default(''),  // cultural/historical context
  searchUrl: z.string().default(''),   // auto-built Google search URL, never AI-generated
  address: z.string().default(''),
  duration: z.string().default(''),    // e.g. "2–3h"
  cost: z.string().default(''),        // e.g. "€10–15"
  category: z.string().default(''),    // matches ClipCategory id in itinerary
  // Unsplash photo for landmark-ish cards (attractions/experiences). Restaurants
  // and cafés intentionally have no image — they use a colour-block + emoji.
  imageUrl: z.string().default(''),
  photographer: z.string().default(''),  // Unsplash attribution name
  photographerUrl: z.string().default(''),
  saved: z.boolean().default(false),   // user bookmark
});
export type GuideCard = z.infer<typeof GuideCardSchema>;

// City walk is a route — waypoints go in the detail field, overall is still one PlanItem.
// One ordered stop on a walk. lat/lng are filled in client-side by geocoding
// (Nominatim) so the route can be drawn on a map and exported to Google Maps.
export const WaypointSchema = z.object({
  name: z.string(),
  note: z.string().default(''),    // why stop here / what to see
  lat: z.number().optional(),      // cached geocode result
  lng: z.number().optional(),
});
export type Waypoint = z.infer<typeof WaypointSchema>;

export const CityWalkSchema = z.object({
  id: z.string(),
  title: z.string(),
  highlight: z.string(),
  detail: z.string(),              // overall prose description of the route
  waypoints: z.array(WaypointSchema).default([]),  // ordered stops
  background: z.string().default(''),
  searchUrl: z.string().default(''),
  duration: z.string().default(''),
  distance: z.string().default(''),  // e.g. "3 km"
  imageUrl: z.string().default(''),
  photographer: z.string().default(''),
  photographerUrl: z.string().default(''),
  saved: z.boolean().default(false),
});
export type CityWalk = z.infer<typeof CityWalkSchema>;

// A "Know" tip — money saving, transport, cultural background. Read-only, no itinerary link.
export const GuideTipSchema = z.object({
  id: z.string(),
  text: z.string(),
  saved: z.boolean().default(false),
});
export type GuideTip = z.infer<typeof GuideTipSchema>;

export const CityIntelSchema = doc({
  city: z.string(),
  country: z.string(),
  flag: z.string().default(''),
  bannerColor: z.string().default('#f9b830'),
  // ── Know (cultural background) ──────────────────────────────────────────
  intro: z.string().default(''),                    // 3-4 sentence city portrait
  funFacts: z.array(z.string()).default([]),         // 3-5 short punchy facts
  // Multi-dimensional overview cards: history, geography, when-to-visit, etc.
  overviewSections: z.array(z.object({
    icon: z.string().default('📌'),
    title: z.string(),
    body: z.string(),
  })).default([]),
  greetings: z.array(z.object({
    phrase: z.string(), pronunciation: z.string(), meaning: z.string(),
  })).default([]),
  customs: z.array(z.string()).default([]),
  taboos: z.array(z.string()).default([]),
  neighborhoods: z.array(z.object({ name: z.string(), vibe: z.string() })).default([]),
  safetyTips: z.array(z.string()).default([]),
  transport: z.array(z.string()).default([]),
  moneyTips: z.array(GuideTipSchema).default([]),
  // ── Do (actionable cards) ────────────────────────────────────────────────
  attractions: z.array(GuideCardSchema).default([]),
  cityWalks: z.array(CityWalkSchema).default([]),
  restaurants: z.array(GuideCardSchema).default([]),
  cafes: z.array(GuideCardSchema).default([]),
  experiences: z.array(GuideCardSchema).default([]),
  // ── Meta ─────────────────────────────────────────────────────────────────
  generatedQuery: z.string().default(''),   // the free-text query used for this generation
});
export type CityIntel = z.infer<typeof CityIntelSchema>;
