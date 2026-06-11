/* ==========================================================================
   On the Road · Pack formula suggestions
   --------------------------------------------------------------------------
   Rule-based engine: trip metadata → suggested items with rationale.
   No AI — instant, offline, zero cost.

   Input: trip legs (for days + destinations + travel months).
   Output: { category, items: [{ text, qty, rationale }] }[]
   ========================================================================== */

import type { StoredLeg } from './stores/route-store.ts';

export interface SuggestedItem {
  text: string;
  qty: number;
  rationale: string;
  category: string;
}

export interface SuggestionGroup {
  title: string;
  icon: string;
  items: SuggestedItem[];
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function tripDays(legs: StoredLeg[]): number {
  if (!legs.length) return 7;
  const from = new Date(legs[0].dateFrom);
  const to   = new Date(legs[legs.length - 1].dateTo);
  return Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));
}

function travelMonths(legs: StoredLeg[]): number[] {
  const months = new Set<number>();
  for (const leg of legs) {
    months.add(new Date(leg.dateFrom).getMonth()); // 0-based
  }
  return [...months];
}

/** Check if any leg spans a cold month (Oct–Mar in Northern Hemisphere) */
function hasColdMonths(months: number[]): boolean {
  return months.some(m => m >= 9 || m <= 2); // Oct, Nov, Dec, Jan, Feb, Mar
}

function hasHotMonths(months: number[]): boolean {
  return months.some(m => m >= 4 && m <= 8); // May–Sep
}

/* ── Formula ─────────────────────────────────────────────────────────────── */

export function buildPackSuggestions(legs: StoredLeg[]): SuggestionGroup[] {
  const days  = tripDays(legs);
  const months = travelMonths(legs);
  const cold  = hasColdMonths(months);
  const hot   = hasHotMonths(months);
  // Cap clothing at 1 week before suggesting laundry
  const laundry = days > 7;
  const clothingDays = Math.min(days, 7);

  const groups: SuggestionGroup[] = [];

  /* ── Clothing ─────────────────────────────────────────────────────────── */
  const clothingItems: SuggestedItem[] = [
    {
      text: 'T-shirt / light top',
      qty: Math.min(clothingDays, 5),
      rationale: laundry
        ? `${clothingDays} days then laundry — 5 max keeps weight down`
        : `1 per day for ${days}-day trip`,
      category: 'clothing',
    },
    {
      text: 'Underwear',
      qty: clothingDays + 1,
      rationale: 'One extra in case of spills or extended wear',
      category: 'clothing',
    },
    {
      text: 'Socks',
      qty: clothingDays + 1,
      rationale: 'One extra pair — feet get wet or sweaty',
      category: 'clothing',
    },
    {
      text: 'Walking trousers / jeans',
      qty: 2,
      rationale: 'One on, one spare — rotate every few days',
      category: 'clothing',
    },
  ];

  if (cold) {
    clothingItems.push(
      {
        text: 'Base layer (thermal top)',
        qty: 2,
        rationale: 'Layer 1 of 3 for cold weather — wicks moisture, worn daily',
        category: 'clothing',
      },
      {
        text: 'Mid layer (fleece or wool sweater)',
        qty: 1,
        rationale: 'Layer 2 of 3 — insulates; can also wear alone indoors',
        category: 'clothing',
      },
      {
        text: 'Outer shell (waterproof jacket)',
        qty: 1,
        rationale: 'Layer 3 of 3 — blocks wind and rain. Critical for cold Europe',
        category: 'clothing',
      },
      {
        text: 'Warm hat + gloves',
        qty: 1,
        rationale: 'Loses 20–30% body heat from the head — pack these even for mild cold',
        category: 'clothing',
      },
    );
  }

  if (hot) {
    clothingItems.push(
      {
        text: 'Sun hat',
        qty: 1,
        rationale: 'Essential for sunny sightseeing — reduces heat stroke risk',
        category: 'clothing',
      },
      {
        text: 'Swimwear',
        qty: 1,
        rationale: 'Beaches, hotel pools, and thermal baths all require it',
        category: 'clothing',
      },
    );
  }

  clothingItems.push({
    text: 'Smart outfit (dinner / museum)',
    qty: 1,
    rationale: 'One evening-appropriate outfit covers most dress codes',
    category: 'clothing',
  });

  groups.push({ title: 'Clothing', icon: '👗', items: clothingItems });

  /* ── Footwear ─────────────────────────────────────────────────────────── */
  const shoeItems: SuggestedItem[] = [
    {
      text: 'Walking shoes / trainers',
      qty: 1,
      rationale: 'You will walk 10–15 km/day sightseeing — comfort is non-negotiable',
      category: 'clothing',
    },
  ];
  if (cold) {
    shoeItems.push({
      text: 'Warm waterproof boots',
      qty: 1,
      rationale: 'Wet cobblestones + cold weather = miserable in regular shoes',
      category: 'clothing',
    });
  }
  if (hot) {
    shoeItems.push({
      text: 'Sandals / flip-flops',
      qty: 1,
      rationale: 'Essential for beach, hostel showers, and hot city evenings',
      category: 'clothing',
    });
  }

  groups.push({ title: 'Footwear', icon: '👟', items: shoeItems });

  /* ── Toiletries ───────────────────────────────────────────────────────── */
  groups.push({
    title: 'Toiletries',
    icon: '🧴',
    items: [
      { text: 'Travel-size shampoo + conditioner', qty: 1, rationale: 'Liquid rules: 100ml max per item in carry-on', category: 'toiletries' },
      { text: 'Deodorant', qty: 1, rationale: 'Travel-size or solid stick to stay under 100ml', category: 'toiletries' },
      { text: 'Toothbrush + toothpaste', qty: 1, rationale: 'Pack a travel toothbrush holder to protect bristles', category: 'toiletries' },
      { text: 'Face wash + moisturiser', qty: 1, rationale: 'Combined SPF moisturiser saves space and weight', category: 'toiletries' },
      { text: 'SPF 50 sunscreen', qty: 1, rationale: hot ? 'Critical for summer travel — reapply every 2 hours' : 'Even winter sun reflects off buildings and snow', category: 'toiletries' },
      { text: 'Menstrual products (supply)', qty: days + 4, rationale: 'Bring a buffer — availability varies by country', category: 'feminine' },
      { text: 'Microfibre towel', qty: 1, rationale: 'Many hostels charge for towels; dries in 30 min', category: 'toiletries' },
    ],
  });

  /* ── Health & Documents ───────────────────────────────────────────────── */
  groups.push({
    title: 'Health & Documents',
    icon: '💊',
    items: [
      { text: 'Painkiller (ibuprofen / paracetamol)', qty: 1, rationale: 'Don\'t hunt a pharmacy abroad with a headache', category: 'health' },
      { text: 'Antihistamine', qty: 1, rationale: 'New environments trigger unexpected allergies', category: 'health' },
      { text: 'Blister plasters', qty: 10, rationale: 'New walking shoes on cobblestones = blisters. Guaranteed.', category: 'health' },
      { text: 'Rehydration sachets', qty: 4, rationale: 'Heat, alcohol, or stomach bugs — this fixes all three', category: 'health' },
      { text: 'Passport + copies', qty: 1, rationale: 'Keep digital scan in cloud + paper copy separate from original', category: 'documents' },
      { text: 'Travel insurance card/details', qty: 1, rationale: 'Screenshot the 24h helpline number — save it offline', category: 'documents' },
      { text: 'Credit/debit cards (2+)', qty: 1, rationale: 'One gets blocked abroad frequently — always carry a backup', category: 'documents' },
    ],
  });

  if (laundry) {
    groups.push({
      title: 'Laundry',
      icon: '🧺',
      items: [
        { text: 'Laundry detergent pods / sheets', qty: 4, rationale: `${days}-day trip needs mid-trip wash — pods are lightest format`, category: 'consumables' },
        { text: 'Travel clothes line', qty: 1, rationale: 'Dry clothes overnight in the hotel room', category: 'consumables' },
      ],
    });
  }

  /* ── Electronics ─────────────────────────────────────────────────────── */
  groups.push({
    title: 'Electronics',
    icon: '🔌',
    items: [
      { text: 'Universal travel adapter', qty: 1, rationale: 'EU uses Type C/E/F — don\'t assume your charger fits', category: 'electronics' },
      { text: 'Power bank (10,000+ mAh)', qty: 1, rationale: 'Navigation + photos drains phones fast. Charge overnight.', category: 'electronics' },
      { text: 'Phone charger + cable', qty: 1, rationale: 'Bring a backup cable — they fail at worst times', category: 'electronics' },
      { text: 'Earphones / AirPods', qty: 1, rationale: 'Trains, planes, and noisy hostels — essential', category: 'electronics' },
    ],
  });

  /* ── Bag & Security ───────────────────────────────────────────────────── */
  groups.push({
    title: 'Bag & Security',
    icon: '🔒',
    items: [
      { text: 'TSA-approved padlock', qty: 1, rationale: 'Secures checked luggage and hostel lockers', category: 'other' },
      { text: 'Day pack / small backpack', qty: 1, rationale: 'Carry water, jacket, and camera during city days', category: 'other' },
      { text: 'Packing cubes (set)', qty: 1, rationale: 'Keeps bags organised and compresses clothing 20–30%', category: 'other' },
      { text: 'Waterproof bag liner or dry bag', qty: 1, rationale: 'Protects electronics and documents in rain or on boats', category: 'other' },
    ],
  });

  return groups;
}
