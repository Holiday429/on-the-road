/* ==========================================================================
   On the Road · Stamp icons
   --------------------------------------------------------------------------
   Line-art landmarks for the passport's country stamps, drawn on a 24×24 grid
   as stroke-only paths (the stamp's CSS gives them the ink colour and a
   rounded 1.5px stroke). A country with its own landmark uses it; every other
   country falls back to a motif for its continent, and anything unmapped to a
   compass — so a country is never blank.

   Add a landmark: put its paths in ICONS and its ISO in BY_ISO. Nothing else.
   ========================================================================== */

import { continentFor } from '../../data/geo-index.ts';

export type StampIconKey =
  | 'houses' | 'gate' | 'windmill' | 'atomium' | 'eiffel' | 'sagrada' | 'tower' | 'matterhorn' | 'colosseum'
  | 'bigben' | 'fuji' | 'pyramid' | 'temple' | 'dome' | 'sails' | 'skyline'
  | 'castle' | 'pagoda' | 'sun' | 'peaks' | 'compass';

/** Inner SVG markup (24×24 viewBox, no fill). */
export const ICONS: Record<StampIconKey, string> = {
  houses: '<path d="M2 21V11l3-3 3 3v10M8 21V9l3.5-4L15 9v12M15 21v-9l3-3 3 3v9M1 21h22M4.5 14h1M11 12h1M11 16h1M17.5 15h1"/>',
  gate: '<path d="M3 9h18M3 6h18v3M5 9v12M9 9v12M15 9v12M19 9v12M2 21h20M9 6V4h6v2M11 4V2.5h2V4"/>',
  windmill: '<path d="M9.5 21 11 12.5h2L14.5 21M7.5 21h9M12 10 5 4M12 10l7-6M12 10 5.5 16M12 10l6.5 6"/>',
  atomium: '<circle cx="12" cy="4.5" r="2.4"/><circle cx="4.5" cy="15" r="2.4"/><circle cx="19.5" cy="15" r="2.4"/><circle cx="12" cy="11.5" r="2.4"/><circle cx="12" cy="20" r="2"/><path d="M12 6.9v2.2M12 13.9V18M6.5 13.6l3.2-1.2M17.5 13.6l-3.2-1.2M6 13l4.4-6.2M18 13l-4.4-6.2"/>',
  eiffel: '<path d="M12 2v4M10.5 9.5 12 6l1.5 3.5M9 14c1-1 1.6-2.5 1.5-4.5h3c-.1 2 .5 3.5 1.5 4.5M6 21l3-7M18 21l-3-7M9 14h6M7 21h10M10.8 17.5h2.4"/>',
  sagrada: '<path d="M5 21V9l1.5-5L8 9v12M10 21V6l2-4 2 4v15M16 21V9l1.5-5L19 9v12M3 21h18"/>',
  tower: '<path d="M7 21V9h10v12M6 9h12M7 9V6h2v3M11 9V6h2v3M15 9V6h2v3M10 21v-5a2 2 0 0 1 4 0v5M5 21h14"/>',
  matterhorn: '<path d="M2 21 10 3l3 6 3-3 6 15zM7.4 12.5 10 11l2 2 1.2-2.2"/>',
  colosseum: '<path d="M3 20V8c0-2 4-3 9-3s9 1 9 3v12M3 20h18M3 12.5h18M6 20v-4a1.5 1.5 0 0 1 3 0v4M10.5 20v-4a1.5 1.5 0 0 1 3 0v4M15 20v-4a1.5 1.5 0 0 1 3 0v4"/>',
  bigben: '<path d="M9 21V8h6v13M8 8h8l-4-5zM12 3V1.5M9 21h6M7 21h10"/><circle cx="12" cy="12" r="1.8"/>',
  fuji: '<path d="M1 21 8.5 7h7L23 21M8.5 7c1 1.5 2 1.5 3.5 0 1.5 1.5 2.5 1.5 3.5 0"/>',
  pyramid: '<path d="M2 21 12 4l10 17zM12 4v17M7 21l5-8"/>',
  temple: '<path d="M3 9l9-5 9 5zM5 9v10M9 9v10M15 9v10M19 9v10M3 20h18"/>',
  dome: '<path d="M4 21v-8h16v8M6 13a6 6 0 0 1 12 0M12 7V4M11 4h2M2 21h20M19.5 13V8M4.5 13V8"/>',
  sails: '<path d="M2 18c4 0 5-6 8-11 .3 3-1 7 .5 11M11 18c1-4 4-7 9-8-1 4-3 7-7 8M1 21h22"/>',
  skyline: '<path d="M3 21V12h4v9M7 21V6h5v15M12 21V10h4v11M16 21v-7h5v7M1 21h22M9 8.5h1M9 11.5h1"/>',
  castle: '<path d="M4 21V8h3v2h2V8h2v2h2V8h2v2h2V8h3v13M4 21h16M10 21v-5a2 2 0 0 1 4 0v5"/>',
  pagoda: '<path d="M12 2v3M7 8h10L12 5zM6 12h12l-2-4M5 16h14l-2-4M8 16v5M16 16v5M4 21h16"/>',
  sun: '<circle cx="12" cy="9" r="3.5"/><path d="M12 2v1.5M12 14.5V16M5 9H3.5M20.5 9H19M7 4l1 1M17 4l-1 1M2 20c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>',
  peaks: '<path d="M1 21 8 7l4 7 3-4 8 11zM5.5 13.5 8 11l2.5 2.5"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
};

/** Countries with a landmark of their own. */
const BY_ISO: Record<string, StampIconKey> = {
  DK: 'houses', DE: 'gate', NL: 'windmill', BE: 'atomium', FR: 'eiffel', ES: 'sagrada', PT: 'tower',
  CH: 'matterhorn', IT: 'colosseum', GB: 'bigben', JP: 'fuji', EG: 'pyramid', GR: 'temple', TR: 'dome',
  AU: 'sails', US: 'skyline', CA: 'skyline', CN: 'pagoda',
};

const BY_CONTINENT: Record<string, StampIconKey> = {
  Europe: 'castle', Asia: 'pagoda', Africa: 'pyramid', 'North America': 'skyline', 'South America': 'peaks', Oceania: 'sun',
};

/** The landmark for a country: its own, else its continent's motif, else a compass. */
export function iconFor(iso: string): StampIconKey {
  const k = iso.toUpperCase();
  return BY_ISO[k] ?? BY_CONTINENT[continentFor(k) ?? ''] ?? 'compass';
}
