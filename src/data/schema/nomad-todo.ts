import { z } from 'zod';
import { doc } from './base.ts';


/* ── Nomad (work-friendly spots) ─────────────────────────────────────────── */
// Flattened to users/{uid}/nomadSpots with a tripId tag so the gallery can
// show one trip or all trips, and filter by country. `visibility`/`ownerId`
// are reserved for a future community/sharing layer (not queried yet).
export const NomadRatingsSchema = z.object({
  wifi: z.number().default(0),
  power: z.number().default(0),
  restroom: z.number().default(0),
  coffee: z.number().default(0),
  service: z.number().default(0),
});
export type NomadRatings = z.infer<typeof NomadRatingsSchema>;

/* ── To-Do ───────────────────────────────────────────────────────────────── */
// User-scoped reminders / tasks. tripId null = global (cross-trip); set to
// a trip id to scope to that trip. dueDate is ISO date; remindAt is epoch ms.
export const TodoSchema = doc({
  tripId:   z.string().nullable().default(null),
  text:     z.string(),
  done:     z.boolean().default(false),
  dueDate:  z.string().nullable().default(null),   // ISO date 'YYYY-MM-DD'
  remindAt: z.number().nullable().default(null),   // epoch ms
  order:    z.number().default(0),
});
export type Todo = z.infer<typeof TodoSchema>;

/* ── Nomad (work-friendly spots) ─────────────────────────────────────────── */
// Flattened to users/{uid}/nomadSpots with a tripId tag so the gallery can
// show one trip or all trips, and filter by country. `visibility`/`ownerId`
// are reserved for a future community/sharing layer (not queried yet).
export const NomadSpotSchema = doc({
  tripId: z.string().nullable().default(null),
  name: z.string(),
  city: z.string().default(''),
  country: z.string().default(''),
  type: z.enum(['Café', 'Co-working', 'Library', 'Hotel lobby']).default('Café'),
  ratings: NomadRatingsSchema,
  comment: z.string().optional(),
  photos: z.array(z.string()).default([]),
  placeId: z.string().optional(),
  mapsUrl: z.string().optional(),
  address: z.string().optional(),
  placePhotoUrl: z.string().optional(),
  // Reserved for a future cross-user community layer — not queried yet.
  visibility: z.enum(['private', 'public']).default('private'),
  ownerId: z.string().default(''),
});
export type NomadSpot = z.infer<typeof NomadSpotSchema>;
