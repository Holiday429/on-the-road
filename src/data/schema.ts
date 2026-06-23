/* ==========================================================================
   On the Road · Data schemas (zod) — barrel
   --------------------------------------------------------------------------
   Single source of truth for the shape of every stored document, now split by
   domain under ./schema/. This barrel re-exports everything so the historical
   `import { … } from '../data/schema.ts'` paths keep working unchanged.

   Firestore layout (collaboration-ready — trips are top-level so they can be
   shared across users):

   users/{uid}                      profile + settings (private to that user)
   tripInvites/{token}              active share links

   trips/{tripId}                   a single trip (members[] grants access)
     legs/{legId}                   itinerary stops      (route)
     prepTasks/{taskId}             pre-departure tasks  (prep)
     expenses/{expenseId}           spend log            (expenses)
     cityIntel/{cityId}             AI city briefings    (cities)
     journalEntries/{entryId}       travel notes         (journal)
     journalStories/{storyId}       AI trip recaps       (journal)

   Every document carries meta (createdAt/updatedAt/schemaVersion) so we can
   migrate shapes later without guessing a document's age or version.
   ========================================================================== */

export * from './schema/base.ts';
export * from './schema/user-trip.ts';
export * from './schema/checklist.ts';
export * from './schema/pack.ts';
export * from './schema/itinerary.ts';
export * from './schema/compare.ts';
export * from './schema/expense.ts';
export * from './schema/guide.ts';
export * from './schema/safety.ts';
export * from './schema/journal.ts';
export * from './schema/nomad-todo.ts';
