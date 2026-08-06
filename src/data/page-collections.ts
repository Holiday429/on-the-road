/* ==========================================================================
   On the Road · Page → Firestore sub-collection map
   --------------------------------------------------------------------------
   Single source of truth mapping a shareable "page" (a ViewId from the app
   shell) to the Firestore sub-collections that page reads. Used by the
   sharing system: a viewer invite carries a list of pages, and the trip's
   publicView.collections is the union of the collections those pages need.
   Security rules then allow unauthenticated reads of exactly those
   sub-collections (by name).

   Keep PageId loosely typed as string to avoid a circular import with the
   app shell's ViewId — the keys here ARE the ViewIds, validated by usage.
   ========================================================================== */

export type PageId = string;

/** ViewId → the sub-collection names that page renders from. */
export const PAGE_COLLECTIONS: Record<PageId, string[]> = {
  route:    ['legs', 'stays', 'todos'],
  // Prepare now shows both the Checklist and Pack sections on one page (see
  // product-restructure P5), so a viewer sharing this page needs both
  // collections — pack no longer has its own routable page.
  prep:     ['prepTasks', 'checklists', 'packLists'],
  budget:   ['compares'],
  // Guide now also renders the Nomad cafe strip and the Safety tab (both
  // folded in — see product-restructure P3/P4), so it needs those too.
  cities:   ['cityIntel', 'nomadSpots', 'citySafety'],
  expenses: ['expenses', 'expenseCategories'],
  journal:  ['journalEntries', 'journalStories', 'journalTemplates'],
  map:      ['legs'],           // Map renders from leg geo data (shares with route)
  today:    [],                 // Dashboard aggregates other pages — not shareable alone
  calendar: [],                 // Calendar aggregates other pages — not shareable alone
  profile:  [],                 // User-level data (account/emergency card) — not trip-shareable
};

/** The pages an owner can pick when creating a view link (those with data). */
export function shareablePages(): PageId[] {
  return Object.keys(PAGE_COLLECTIONS).filter((p) => PAGE_COLLECTIONS[p].length > 0);
}

// Pre-P5 invites may still carry the old standalone 'pack' page id (Pack had
// its own route before it was folded into Prepare). Normalize it here so an
// existing viewer link doesn't silently lose packLists access on next
// recompute — this is the one chokepoint every stored `pages` array passes
// through before becoming a collections list.
const LEGACY_PAGE_MAP: Record<string, PageId> = { pack: 'prep' };

/** Union of sub-collection names exposed by a set of pages. */
export function collectionsForPages(pages: PageId[]): string[] {
  const normalised = pages.map((p) => LEGACY_PAGE_MAP[p] ?? p);
  return [...new Set(normalised.flatMap((p) => PAGE_COLLECTIONS[p] ?? []))];
}
