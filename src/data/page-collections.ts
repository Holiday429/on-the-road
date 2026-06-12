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
  prep:     ['prepTasks', 'checklists'],
  pack:     ['packLists'],
  budget:   ['compares'],
  cities:   ['cityIntel'],
  safety:   ['citySafety'],
  expenses: ['expenses', 'expenseCategories'],
  journal:  ['journalEntries', 'journalStories', 'journalTemplates'],
  map:      ['legs'],           // Map renders from leg geo data (shares with route)
  nomad:    ['nomadSpots'],
  today:    [],                 // Dashboard aggregates other pages — not shareable alone
  calendar: [],                 // Calendar aggregates other pages — not shareable alone
};

/** The pages an owner can pick when creating a view link (those with data). */
export function shareablePages(): PageId[] {
  return Object.keys(PAGE_COLLECTIONS).filter((p) => PAGE_COLLECTIONS[p].length > 0);
}

/** Union of sub-collection names exposed by a set of pages. */
export function collectionsForPages(pages: PageId[]): string[] {
  return [...new Set(pages.flatMap((p) => PAGE_COLLECTIONS[p] ?? []))];
}
