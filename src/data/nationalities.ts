/* ==========================================================================
   On the Road · Nationality table
   --------------------------------------------------------------------------
   Mirrors CURRENCIES (see rates.ts): a flat list rendered into a <select> so
   the user picks their nationality the same way they pick a currency. The
   chosen code is stored on the SafetyProfile and fed to the AI when it looks
   up the right embassy for each city. Not exhaustive — the public version can
   grow this; an unknown code just falls back to a generic embassy lookup.
   ========================================================================== */

export interface Nationality {
  code: string;     // ISO 3166-1 alpha-2
  flag: string;
  label: string;    // full demonym/country shown in the picker and AI prompt
  dialCode: string; // e.g. '+86' — default dial code for phone split-input
}

export const NATIONALITIES: Nationality[] = [
  { code: 'CN', flag: '🇨🇳', label: 'China',          dialCode: '+86'  },
  { code: 'US', flag: '🇺🇸', label: 'United States',  dialCode: '+1'   },
  { code: 'GB', flag: '🇬🇧', label: 'United Kingdom', dialCode: '+44'  },
  { code: 'CA', flag: '🇨🇦', label: 'Canada',         dialCode: '+1'   },
  { code: 'AU', flag: '🇦🇺', label: 'Australia',      dialCode: '+61'  },
  { code: 'NZ', flag: '🇳🇿', label: 'New Zealand',    dialCode: '+64'  },
  { code: 'IN', flag: '🇮🇳', label: 'India',          dialCode: '+91'  },
  { code: 'JP', flag: '🇯🇵', label: 'Japan',          dialCode: '+81'  },
  { code: 'KR', flag: '🇰🇷', label: 'South Korea',    dialCode: '+82'  },
  { code: 'SG', flag: '🇸🇬', label: 'Singapore',      dialCode: '+65'  },
  { code: 'MY', flag: '🇲🇾', label: 'Malaysia',       dialCode: '+60'  },
  { code: 'TH', flag: '🇹🇭', label: 'Thailand',       dialCode: '+66'  },
  { code: 'DE', flag: '🇩🇪', label: 'Germany',        dialCode: '+49'  },
  { code: 'FR', flag: '🇫🇷', label: 'France',         dialCode: '+33'  },
  { code: 'ES', flag: '🇪🇸', label: 'Spain',          dialCode: '+34'  },
  { code: 'IT', flag: '🇮🇹', label: 'Italy',          dialCode: '+39'  },
  { code: 'NL', flag: '🇳🇱', label: 'Netherlands',    dialCode: '+31'  },
  { code: 'BE', flag: '🇧🇪', label: 'Belgium',        dialCode: '+32'  },
  { code: 'CH', flag: '🇨🇭', label: 'Switzerland',    dialCode: '+41'  },
  { code: 'DK', flag: '🇩🇰', label: 'Denmark',        dialCode: '+45'  },
  { code: 'SE', flag: '🇸🇪', label: 'Sweden',         dialCode: '+46'  },
  { code: 'NO', flag: '🇳🇴', label: 'Norway',         dialCode: '+47'  },
  { code: 'BR', flag: '🇧🇷', label: 'Brazil',         dialCode: '+55'  },
  { code: 'MX', flag: '🇲🇽', label: 'Mexico',         dialCode: '+52'  },
  { code: 'ZA', flag: '🇿🇦', label: 'South Africa',   dialCode: '+27'  },
];

export function nationalityLabel(code: string): string {
  return NATIONALITIES.find((n) => n.code === code)?.label ?? code;
}

export function nationalityFlag(code: string): string {
  return NATIONALITIES.find((n) => n.code === code)?.flag ?? '🌐';
}

export function dialCodeFor(countryCode: string): string {
  return NATIONALITIES.find((n) => n.code === countryCode)?.dialCode ?? '';
}

/** Deduplicated dial-code list for the phone prefix <select>. */
export interface DialCode { dialCode: string; flag: string; label: string; }
export const DIAL_CODES: DialCode[] = (() => {
  const seen = new Set<string>();
  return NATIONALITIES
    .filter((n) => { const k = n.dialCode; if (seen.has(k)) return false; seen.add(k); return true; })
    .map((n) => ({ dialCode: n.dialCode, flag: n.flag, label: `${n.flag} ${n.dialCode}` }));
})();
