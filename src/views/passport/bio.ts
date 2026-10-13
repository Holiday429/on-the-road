/* ==========================================================================
   On the Road · Passport — bio page model (pure)
   --------------------------------------------------------------------------
   What the data page of the passport says. Nothing here is a real document:
   the traveller gives a nickname, the passport number is made up from their
   account id, and the two machine-readable lines at the foot are decoration
   built from those same fields (a real passport's MRZ, minus the checksums).
   ========================================================================== */

import { hashStr } from '../../data/palette.ts';

export interface BioInput {
  nickname: string;
  /** ISO-3166 alpha-2 or ''. */
  nationality: string;
  /** Any stable per-account string. */
  uid: string;
}

/** `N° 4823917` — seven digits fixed by the account, so it never changes. */
export function passportNumber(uid: string): string {
  const n = (hashStr(`otr-passport:${uid}`) % 9000000) + 1000000;
  return String(n);
}

const MRZ_LEN = 44;

/** Letters and digits only, upper-case; anything else (spaces, accents, CJK) becomes the filler `<`. */
function mrzText(s: string): string {
  return s.normalize('NFD').toUpperCase().replace(/[^A-Z0-9]+/g, '<').replace(/^<+|<+$/g, '');
}

const pad = (s: string): string => (s + '<'.repeat(MRZ_LEN)).slice(0, MRZ_LEN);

/** The two machine-readable lines. A name with no Latin letters (e.g. 小明) is written as the filler. */
export function mrz(b: BioInput, issued: string): [string, string] {
  const name = mrzText(b.nickname);
  const nat = mrzText(b.nationality).slice(0, 2) || '<<';
  const when = issued.replace(/-/g, '').slice(2, 8) || '<<<<<<';
  return [
    pad(`P<OTR${name}<<`),
    pad(`${passportNumber(b.uid)}<${nat}${when}<<TRAVELLER`),
  ];
}

/** `•••• 1234` — only the last four characters of a document number show until asked. */
export function maskNumber(n: string): string {
  const s = n.replace(/\s+/g, '');
  return s.length <= 4 ? '•'.repeat(s.length) : `${'•'.repeat(Math.min(8, s.length - 4))} ${s.slice(-4)}`;
}
