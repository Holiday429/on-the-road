import { z } from 'zod';
import { doc } from './base.ts';


/* ── Safety ──────────────────────────────────────────────────────────────── */
// Two halves, mirroring the Stay/Guide split:
//   SafetyProfile — one user-scoped doc (id: 'me'). Personal + emergency info
//     the traveller fills in once and carries across every trip. Stored under
//     users/{uid}/safetyProfile so it is NOT tied to a single trip. Everything
//     defaults to '' — the form starts empty and the user populates it.
//   CitySafety — one doc per city (id = slugged city), trip-scoped, AI-seeded
//     but hand-correctable. `source` flips to 'edited' the moment the user
//     changes a field, so a re-generate can skip cards they've curated.

export const EmergencyContactSchema = z.object({
  name: z.string().default(''),
  relation: z.string().default(''),
  dialCode: z.string().default(''),   // e.g. '+86' — stored separately for the split input
  phone: z.string().default(''),      // local number without country code
  isPrimary: z.boolean().default(false),
});
export type EmergencyContact = z.infer<typeof EmergencyContactSchema>;

export const SafetyProfileSchema = doc({
  nationality: z.string().default(''),          // ISO code → drives embassy lookup
  emergencyContacts: z.array(EmergencyContactSchema).default([]),
  bloodType: z.string().default(''),
  allergies: z.string().default(''),
  medications: z.string().default(''),
  conditions: z.string().default(''),           // chronic conditions worth flagging to medics
  insuranceProvider: z.string().default(''),
  insurancePolicy: z.string().default(''),
  insuranceHotline: z.string().default(''),     // hotline stored as single string (often intl already)
  insurancePdfUrl: z.string().default(''),      // Firebase Storage download URL
  insurancePdfName: z.string().default(''),     // original filename for display
  medicalDocUrl: z.string().default(''),        // medical card / summary doc
  medicalDocName: z.string().default(''),
  notes: z.string().default(''),
});
export type SafetyProfile = z.infer<typeof SafetyProfileSchema>;

/* ── Safety content (remote-controlled, app-global) ─────────────────────────
   Essentials checklists and any app-wide safety content editable via Firestore
   without a code redeploy. Each doc id = group slug (e.g. 'accommodation').   */

export const EssentialItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  sortOrder: z.number().default(0),
});
export type EssentialItem = z.infer<typeof EssentialItemSchema>;

export const EssentialGroupSchema = doc({
  icon: z.string().default('📋'),
  title: z.string(),
  sortOrder: z.number().default(0),
  items: z.array(EssentialItemSchema).default([]),
});
export type EssentialGroup = z.infer<typeof EssentialGroupSchema>;

// One labelled emergency number (Police / Ambulance / Fire / Women's helpline).
export const SafetyNumberSchema = z.object({
  label: z.string().default(''),
  number: z.string().default(''),
});
export type SafetyNumber = z.infer<typeof SafetyNumberSchema>;

export const SafetyHospitalSchema = z.object({
  name: z.string().default(''),
  address: z.string().default(''),
  phone: z.string().default(''),
  is24h: z.boolean().default(false),
});
export type SafetyHospital = z.infer<typeof SafetyHospitalSchema>;

export const SafetyPhraseSchema = z.object({
  en: z.string().default(''),            // "Call the police"
  local: z.string().default(''),         // local-language equivalent
  pronunciation: z.string().default(''),
});
export type SafetyPhrase = z.infer<typeof SafetyPhraseSchema>;

export const SafetyEmbassySchema = z.object({
  nationality: z.string().default(''),   // which country's embassy this is
  name: z.string().default(''),
  address: z.string().default(''),
  phone: z.string().default(''),
  website: z.string().default(''),
});
export type SafetyEmbassy = z.infer<typeof SafetyEmbassySchema>;

export const CitySafetySchema = doc({
  city: z.string(),
  country: z.string().default(''),
  flag: z.string().default(''),
  generalEmergency: z.string().default('112'),       // pan-EU default
  emergencyNumbers: z.array(SafetyNumberSchema).default([]),
  embassy: SafetyEmbassySchema.default({ nationality: '', name: '', address: '', phone: '', website: '' }),
  hospitals: z.array(SafetyHospitalSchema).default([]),
  trustedTransport: z.array(z.string()).default([]),  // ride apps + night-travel advice
  areasToAvoid: z.array(z.string()).default([]),       // zone + time-of-day
  commonScams: z.array(z.string()).default([]),
  phrases: z.array(SafetyPhraseSchema).default([]),
  womenTips: z.array(z.string()).default([]),
  source: z.enum(['ai', 'edited']).default('ai'),      // 'edited' = curated, don't overwrite
});
export type CitySafety = z.infer<typeof CitySafetySchema>;
