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

/** How the traveller dressed the booklet. Absent = the navy cloth cover with gold foil. */
export const PassportCoverSchema = z.object({
  color: z.string().default('#34465e'),     // #rrggbb
  material: z.enum(['leather', 'cloth', 'vinyl']).default('cloth'),
  foil: z.enum(['gold', 'silver', 'white', 'blind']).default('gold'),
  emblem: z.enum(['globe', 'compass', 'route', 'sign']).default('globe'),   // neutral marks only — never a national emblem
  title: z.string().default(''),            // '' = "PASSPORT" in the reader's language; ≤ 22 characters
});
export type PassportCover = z.infer<typeof PassportCoverSchema>;

export const PassportSchema = doc({
  nickname: z.string().default(''),        // '' = the account's first name
  photoURL: z.string().default(''),        // '' = the account photo
  nationality: z.string().default(''),     // ISO alpha-2; '' = the safety profile's
  occupation: z.string().default(''),      // '' = "Traveller"
  signature: z.string().default(''),       // SVG path data in a 300 × 100 box ('' = unsigned)
  placements: z.record(z.string(), PlacementSchema).default({}),
  cover: PassportCoverSchema.optional(),
});
export type PassportDoc = z.infer<typeof PassportSchema>;

/** Optional real details — the traveller can use the passport page to look them up. Never required, never exported or sent anywhere; the data page shows only the items the traveller marked as shown. */
export const PassportDocSchema = doc({
  fullName: z.string().default(''),
  number: z.string().default(''),
  issuingCountry: z.string().default(''),
  issued: z.string().default(''),          // ISO date
  expires: z.string().default(''),         // ISO date
  birthDate: z.string().default(''),       // ISO date
  gender: z.enum(['', 'F', 'M', 'X']).default(''),   // shown on the data page as the passport's "Sex"
  // Which of the three personal items the data page shows; false = it shows as hidden dots. Everything else on the page is always shown.
  showNumber: z.boolean().default(false),
  showFullName: z.boolean().default(false),
  showBirth: z.boolean().default(false),
});
export type PassportDetails = z.infer<typeof PassportDocSchema>;
