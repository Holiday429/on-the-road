import { z } from 'zod';
import { doc } from './base.ts';

/* ── Passport (user-scoped, not trip-scoped) ─────────────────────────────────
   The traveller has ONE passport for the whole account. Which stamps exist is
   derived from the legs of every trip (data/passport.ts); what is stored here
   is only what the traveller did and wrote:
     users/{uid}/passport/me       nickname, photo, signature, how each stamp was pressed
     users/{uid}/passportDocs/me   optional real document details (private; never exported or shared)
   Both live under users/{uid}/…, which firestore.rules already makes owner-only. */

/** A copy of what a stamp said when it was pressed, so it survives its trip being deleted (Q3). */
export const StampSnapSchema = z.object({
  tripId: z.string(),
  tripName: z.string().default(''),
  iso: z.string().default(''),
  country: z.string(),
  date: z.string(),
  nights: z.number().default(1),
  cities: z.array(z.string()).default([]),
  mode: z.string().optional(),
});
export type StampSnap = z.infer<typeof StampSnapSchema>;

/** Where and how hard a stamp was pressed. x / y are the stamp's centre in % of the page. */
export const PlacementSchema = z.object({
  page: z.string(),            // `${tripId}#${n}`
  x: z.number(),
  y: z.number(),
  rot: z.number(),
  pressure: z.number().min(0).max(1).default(0.75),
  at: z.number(),
  snap: StampSnapSchema.optional(),
});
export type PlacementRec = z.infer<typeof PlacementSchema>;

export const PassportSchema = doc({
  nickname: z.string().default(''),        // '' = the account's first name
  photoURL: z.string().default(''),        // '' = the account photo
  nationality: z.string().default(''),     // ISO alpha-2; '' = the safety profile's
  occupation: z.string().default(''),      // '' = "Traveller"
  signature: z.string().default(''),       // SVG path data in a 300 × 100 box ('' = unsigned)
  placements: z.record(z.string(), PlacementSchema).default({}),
});
export type PassportDoc = z.infer<typeof PassportSchema>;

/** Optional real details — the traveller can use the passport page to look them up. Never required, never shared. */
export const PassportDocSchema = doc({
  fullName: z.string().default(''),
  number: z.string().default(''),
  issuingCountry: z.string().default(''),
  issued: z.string().default(''),          // ISO date
  expires: z.string().default(''),         // ISO date
  birthDate: z.string().default(''),       // ISO date
});
export type PassportDetails = z.infer<typeof PassportDocSchema>;
