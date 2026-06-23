/* ==========================================================================
   On the Road · i18n strings (aggregator)
   --------------------------------------------------------------------------
   English is the source. Every other locale only needs to override the keys it
   has translations for — t() falls back to English for anything missing, so the
   tables can be filled in incrementally without breaking the UI.

   The per-locale tables live in ./i18n/<locale>.ts. This file just re-exports
   the shared type and assembles the STRINGS map consumed by i18n.ts.
   ========================================================================== */

import type { Locale } from './i18n.ts';
import type { StringTable } from './i18n/types.ts';
import { en } from './i18n/en.ts';
import { zh } from './i18n/zh.ts';
import { ja } from './i18n/ja.ts';
import { fr } from './i18n/fr.ts';
import { es } from './i18n/es.ts';
import { ko } from './i18n/ko.ts';

export type { StringTable };

export const STRINGS: Record<Locale, StringTable> = { en, zh, ja, fr, es, ko };
