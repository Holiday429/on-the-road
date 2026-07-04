/* ==========================================================================
   On the Road · Itinerary · city-level sharing
   --------------------------------------------------------------------------
   When the same city appears more than once in a trip (e.g. two Copenhagen
   stays, at the start and end of a Europe trip), the user's "intent layer"
   — what they want to see, what they've researched — carries across the
   visits, while the "execution layer" (which day, which hotel) stays private
   to each leg.

   The intent layer is stored per-trip in trips/{tripId}/cityShared/{slug}
   (see CitySharedSchema + city-shared-store). This module is the read/compute
   side the detail view uses:
     • cityShareContext  — is this city repeated? which are the sibling legs?
     • sharedPlans       — the shared wishlist, with per-visit footprints,
                           preferring the stored doc and falling back to a
                           live derivation from the sibling legs (so a freshly
                           created second leg works before migration seeds).
   ========================================================================== */

import { slugId } from '../../core/utils.ts';
import type { Leg } from './itinerary-shared.ts';
import type {
  Clip, NoteCard, CityShared, SharedPlanItem,
} from '../../data/schema.ts';
import { legNoteCardsOf } from './itinerary-utils.ts';

/** One past/other occurrence of the same city within the trip. */
export interface CityVisit {
  legId: string;
  city: string;
  dateFrom: string;
  dateTo: string;
  index: number;        // 1-based position among same-city siblings, in date order
}

/** A wishlist entry aggregated across every visit to the city. */
export interface SharedPlan {
  /** Stable identity — the shared item id (== normalised title). */
  key: string;
  title: string;
  category: string;
  note?: string;
  /** Visits where this item was scheduled, and whether it was done there. */
  occurrences: { legId: string; dateFrom: string; done: boolean }[];
  /** True if it lives unscheduled (wishlist) — i.e. no visit has consumed it. */
  inWishlist: boolean;
  /** Convenience: any occurrence marked done. */
  visited: boolean;
  /** Convenience: scheduled somewhere but never marked done. */
  missed: boolean;
}

export interface CityShareContext {
  slug: string;
  /** All legs of the trip sharing this city, in date order (incl. the current one). */
  siblings: Leg[];
  /** Same as siblings minus the current leg. */
  others: Leg[];
  /** Position of the current leg among siblings, 1-based. */
  currentIndex: number;
  /** Other visits, for the status bar. */
  otherVisits: CityVisit[];
  /** The stored shared doc, if it exists yet (else we derive from siblings). */
  shared?: CityShared;
}

/** slug of a leg's city, the shared identity key. */
export function citySlug(leg: Leg): string {
  return slugId(leg.city);
}

/** Title-based identity so the same place folds across visits regardless of id. */
export function planKey(title: string): string {
  return slugId(title) || title.trim().toLowerCase();
}

/**
 * Find every leg in `allLegs` that shares the current leg's trip and city, and
 * attach the stored shared doc for that slug if present. Returns null when the
 * city is unique in the trip — callers skip all sharing UI.
 */
export function cityShareContext(
  leg: Leg, allLegs: Leg[], sharedDocs: CityShared[] = [],
): CityShareContext | null {
  const slug = citySlug(leg);
  const siblings = allLegs
    .filter(l => l.tripId === leg.tripId && slugId(l.city) === slug)
    .sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));

  if (siblings.length < 2) return null;

  const currentIndex = siblings.findIndex(l => l.id === leg.id) + 1;
  const others = siblings.filter(l => l.id !== leg.id);
  const otherVisits: CityVisit[] = others.map(l => ({
    legId: l.id, city: l.city, dateFrom: l.dateFrom, dateTo: l.dateTo,
    index: siblings.findIndex(s => s.id === l.id) + 1,
  }));

  const shared = sharedDocs.find(s => (s as { id?: string }).id === slug);

  return { slug, siblings, others, currentIndex, otherVisits, shared };
}

/** Map a stored SharedPlanItem into the render-friendly SharedPlan shape. */
function fromStored(p: SharedPlanItem): SharedPlan {
  const occurrences = (p.visits ?? []).map(v => ({
    legId: v.legId, dateFrom: v.dateFrom, done: !!v.done,
  }));
  const visited = occurrences.some(o => o.done);
  return {
    key: p.id, title: p.title, category: p.category ?? '', note: p.note,
    occurrences,
    inWishlist: occurrences.length === 0,
    visited,
    missed: !visited && occurrences.length > 0,
  };
}

/**
 * The shared wishlist for this city. Prefers the stored doc; if none exists yet
 * (city just became repeated, migration hasn't seeded), derives it live from the
 * sibling legs' own plans — same logic the migration uses, so the two agree.
 */
export function sharedPlans(ctx: CityShareContext): SharedPlan[] {
  if (ctx.shared) return (ctx.shared.plans ?? []).map(fromStored);

  // Fallback: derive from siblings, keyed by normalised title.
  const map = new Map<string, SharedPlan>();
  for (const sib of ctx.siblings) {
    for (const p of sib.plans ?? []) {
      const key = planKey(p.title);
      if (!key) continue;
      let row = map.get(key);
      if (!row) {
        row = {
          key, title: p.title, category: p.category ?? '', note: p.note,
          occurrences: [], inWishlist: false, visited: false, missed: false,
        };
        map.set(key, row);
      }
      if (!row.note && p.note) row.note = p.note;
      if (p.dayId) row.occurrences.push({ legId: sib.id, dateFrom: sib.dateFrom, done: !!p.done });
      else row.inWishlist = true;
    }
  }
  for (const row of map.values()) {
    row.visited = row.occurrences.some(o => o.done);
    row.missed = !row.visited && row.occurrences.length > 0;
  }
  return [...map.values()];
}

/**
 * Project the current sibling legs into a storable CityShared doc. This is the
 * single source of truth for how legs fold into the shared layer — the runtime
 * upserts it on every relevant edit, and the migration seeds the same shape.
 * De-dupes wishlist plans by title (accumulating visit footprints from
 * scheduled plans) and merges clips / categories / notes across the visits.
 */
export function buildSharedDoc(ctx: CityShareContext): CityShared & { id: string } {
  const plans = new Map<string, SharedPlanItem>();
  const clips: Clip[] = [];
  const clipKeys = new Set<string>();
  const noteCards: NoteCard[] = [];
  const noteKeys = new Set<string>();
  const catById = new Map<string, import('../../data/schema.ts').ClipCategory>();

  for (const sib of ctx.siblings) {
    for (const p of sib.plans ?? []) {
      const key = planKey(p.title);
      if (!key) continue;
      let row = plans.get(key);
      if (!row) {
        row = {
          id: key, title: p.title, category: p.category ?? '',
          note: p.note, address: p.address,
          duration: p.duration, cost: p.cost,
          order: plans.size, visits: [],
        };
        plans.set(key, row);
      }
      if (!row.note && p.note) row.note = p.note;
      if (!row.address && p.address) row.address = p.address;
      if (p.dayId) row.visits.push({ legId: sib.id, dateFrom: sib.dateFrom, done: !!p.done });
    }
    for (const c of sib.clips ?? []) {
      const key = slugId(c.url || c.title || c.id);
      if (key && clipKeys.has(key)) continue;
      if (key) clipKeys.add(key);
      clips.push(c);
    }
    for (const cat of sib.clipCategories ?? []) {
      if (!catById.has(cat.id)) catById.set(cat.id, cat);
    }
    for (const nc of legNoteCardsOf(sib)) {
      const key = slugId((nc.title || '') + '|' + (nc.body || ''));
      if (key && noteKeys.has(key)) continue;
      if (key) noteKeys.add(key);
      noteCards.push(nc);
    }
  }

  return {
    id: ctx.slug,
    tripId: ctx.siblings[0].tripId ?? null,
    city: ctx.siblings[0].city,
    plans: [...plans.values()],
    clips,
    clipCategories: [...catById.values()],
    noteCards,
  } as CityShared & { id: string };
}

/** Bucket aggregated plans into the three history groups the sidebar renders. */
export function groupSharedPlans(plans: SharedPlan[]) {
  return {
    fresh:   plans.filter(p => !p.visited && p.occurrences.length === 0),
    missed:  plans.filter(p => p.missed),
    visited: plans.filter(p => p.visited),
  };
}

/** A clip merged across visits, tagged with the leg it physically lives in so
 *  in-place edits/deletes patch the right leg (all within the same trip). */
export interface SharedClip { clip: Clip; srcLegId: string; }
/** A note card merged across visits, tagged with its source leg. */
export interface SharedNoteCard { card: NoteCard; srcLegId: string; }

/**
 * Clips merged live across the sibling legs (deduped by url|title|id), each
 * tagged with the leg it belongs to. We read from the legs (not the stored
 * projection) so the source legId is exact — editing writes back to that leg,
 * and syncCityShared re-projects the shared doc afterwards.
 */
export function sharedClips(ctx: CityShareContext): SharedClip[] {
  const seen = new Set<string>();
  const out: SharedClip[] = [];
  for (const sib of ctx.siblings) {
    for (const c of sib.clips ?? []) {
      const key = slugId(c.url || c.title || c.id);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      out.push({ clip: c, srcLegId: sib.id });
    }
  }
  return out.sort((a, b) => (a.clip.order ?? 0) - (b.clip.order ?? 0));
}

/** Note cards merged live across siblings, each tagged with its source leg. */
export function sharedNoteCards(ctx: CityShareContext): SharedNoteCard[] {
  const seen = new Set<string>();
  const out: SharedNoteCard[] = [];
  for (const sib of ctx.siblings) {
    for (const c of legNoteCardsOf(sib)) {
      const key = slugId((c.title || '') + '|' + (c.body || ''));
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      out.push({ card: c, srcLegId: sib.id });
    }
  }
  return out;
}
