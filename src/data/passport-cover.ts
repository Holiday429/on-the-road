/* ==========================================================================
   On the Road · Passport cover (pure)
   --------------------------------------------------------------------------
   The traveller dresses their own booklet: colour, material, foil, a neutral
   emblem and a title line. Real passports differ in colour from country to
   country, so there is no "right" cover and none is assumed — the navy cloth
   one is simply where everybody starts. Nothing here is a national emblem.
   ========================================================================== */

import type { PassportCover } from './schema.ts';

export type CoverMaterial = PassportCover['material'];
export type CoverFoil = PassportCover['foil'];
export type CoverEmblem = PassportCover['emblem'];

export const DEFAULT_COVER: PassportCover = { color: '#34465e', material: 'cloth', foil: 'gold', emblem: 'globe', title: '' };

export const TITLE_MAX = 22;

/** Starting colours — a spread of what real booklets look like, none of them "the default". */
export const COVER_SWATCHES: ReadonlyArray<{ id: string; color: string }> = [
  { id: 'navy', color: '#34465e' },
  { id: 'burgundy', color: '#6b2733' },
  { id: 'forest', color: '#28402f' },
  { id: 'black', color: '#1f1f22' },
  { id: 'crimson', color: '#8a2130' },
  { id: 'teal', color: '#1d4347' },
  { id: 'tan', color: '#9a7444' },
  { id: 'charcoal', color: '#4a4a4e' },
];

export const COVER_MATERIALS: readonly CoverMaterial[] = ['leather', 'cloth', 'vinyl'];
export const COVER_FOILS: readonly CoverFoil[] = ['gold', 'silver', 'white', 'blind'];
export const COVER_EMBLEMS: readonly CoverEmblem[] = ['globe', 'compass', 'route', 'sign'];

export const FOIL_COLOR: Record<CoverFoil, string> = {
  gold: '#c9a24a',
  silver: '#c3c7cb',
  white: '#f1ece0',
  blind: 'rgba(0, 0, 0, .34)',
};

const HEX = /^#[0-9a-f]{6}$/i;

/** A cover that is safe to paint, whatever was stored. */
export function normalizeCover(raw: Partial<PassportCover> | null | undefined): PassportCover {
  const c = raw ?? {};
  return {
    color: typeof c.color === 'string' && HEX.test(c.color) ? c.color.toLowerCase() : DEFAULT_COVER.color,
    material: COVER_MATERIALS.includes(c.material as CoverMaterial) ? (c.material as CoverMaterial) : DEFAULT_COVER.material,
    foil: COVER_FOILS.includes(c.foil as CoverFoil) ? (c.foil as CoverFoil) : DEFAULT_COVER.foil,
    emblem: COVER_EMBLEMS.includes(c.emblem as CoverEmblem) ? (c.emblem as CoverEmblem) : DEFAULT_COVER.emblem,
    title: typeof c.title === 'string' ? c.title.trim().slice(0, TITLE_MAX) : '',
  };
}

/** Surface texture of each material, drawn over the colour. */
export const MATERIAL_TEXTURE: Record<CoverMaterial, string> = {
  leather: 'radial-gradient(circle at 1px 1px, rgba(0,0,0,.22) .9px, transparent 1.2px) 0 0 / 7px 7px, '
    + 'radial-gradient(circle at 4px 5px, rgba(255,255,255,.07) .9px, transparent 1.2px) 0 0 / 9px 9px, '
    + 'repeating-linear-gradient(32deg, rgba(0,0,0,.07) 0 1px, transparent 1px 6px)',
  cloth: 'repeating-linear-gradient(0deg, rgba(0,0,0,.16) 0 1px, rgba(255,255,255,.06) 1px 3px), '
    + 'repeating-linear-gradient(90deg, rgba(0,0,0,.16) 0 1px, rgba(255,255,255,.05) 1px 3px)',
  vinyl: 'radial-gradient(130% 90% at 28% 12%, rgba(255,255,255,.18), transparent 58%), '
    + 'repeating-linear-gradient(118deg, rgba(0,0,0,.05) 0 2px, transparent 2px 7px)',
};

/** The custom properties a cover sets on the book (read by passport.css). The default cover sets none, so the theme's own navy shows. */
export function coverVars(c: PassportCover): Record<string, string> {
  return {
    '--pp-cloth': c.color,
    '--pp-cloth-2': `color-mix(in srgb, ${c.color} 76%, black)`,
    '--pp-gold': FOIL_COLOR[c.foil],
    '--pp-foil-edge': c.foil === 'blind' ? 'rgba(255, 255, 255, .22)' : 'rgba(0, 0, 0, .45)',
    '--pp-texture': MATERIAL_TEXTURE[c.material],
  };
}

export function coverStyle(c: PassportCover): string {
  return Object.entries(coverVars(c)).map(([k, v]) => `${k}:${v}`).join(';');
}

export const sameCover = (a: PassportCover, b: PassportCover): boolean =>
  a.color === b.color && a.material === b.material && a.foil === b.foil && a.emblem === b.emblem && a.title === b.title;
