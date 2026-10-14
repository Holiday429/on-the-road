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

/** The title the traveller has earned, 1–5, from how many countries they have stamps for. */
export function travelLevel(countries: number): number {
  return countries >= 25 ? 5 : countries >= 12 ? 4 : countries >= 6 ? 3 : countries >= 2 ? 2 : 1;
}

/** Bars of the barcode strip on the back cover — fixed by the account, so it never changes. [width in 1/4 units, opacity %]. */
export function barcodeBars(uid: string, n = 34): Array<[number, number]> {
  let h = hashStr(`otr-barcode:${uid}`) || 1;
  const next = () => { h = (Math.imul(h, 1103515245) + 12345) >>> 0; return h >>> 8; };
  return Array.from({ length: n }, () => [1 + (next() % 4), 45 + (next() % 5) * 11] as [number, number]);
}
