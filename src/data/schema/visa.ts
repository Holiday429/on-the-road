import { z } from 'zod';
import { doc } from './base.ts';

/* ── Visas (user-scoped) ─────────────────────────────────────────────────────
   users/{uid}/visas/{id} — one document per visa the traveller wants on their
   passport's visa pages. Optional and free-form: nothing is looked up for them
   and nothing here is shared. `region` is an ISO-3166 alpha-2 code, or the
   special 'SCHENGEN' for the whole area (one visa, twenty-nine countries). */

export const VISA_ENTRIES = ['single', 'double', 'multiple'] as const;
export type VisaEntries = typeof VISA_ENTRIES[number];

export const VisaSchema = doc({
  region: z.string(),                         // 'DE', 'JP', … or 'SCHENGEN'
  type: z.string().default(''),               // tourist / business / work / … (free text)
  number: z.string().default(''),
  validFrom: z.string().default(''),          // ISO date
  validTo: z.string().default(''),            // ISO date
  entries: z.enum(VISA_ENTRIES).optional(),
  stayDays: z.number().int().min(1).max(3650).optional(),  // days allowed per stay
  notes: z.string().default(''),
  photoURL: z.string().default(''),
});
export type Visa = z.infer<typeof VisaSchema>;
