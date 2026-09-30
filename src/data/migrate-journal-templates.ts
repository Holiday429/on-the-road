/* ==========================================================================
   On the Road · custom journal templates → tags migration
   --------------------------------------------------------------------------
   The journal composer no longer asks the user to pick a category before
   writing, so user-built templates (trips/{tripId}/journalTemplates) are gone
   from the UI. An entry written under one carries that template's id in
   `template`, which now resolves to nothing — the label the user chose would
   silently disappear from their entry.

   So: fold each custom template's label into the `tags` of every entry that
   used it, and reset those entries to the template's base `kind`, which IS a
   builtin and still renders. Nothing is deleted — the template docs are left
   in place so this stays reversible.

   Idempotent via a localStorage done-flag, like the other migrations.
   ========================================================================== */

import { collection, getDocs, updateDoc, doc as fbDoc, getFirestore } from 'firebase/firestore';
import { currentUser } from '../firebase/auth.ts';
import { currentTripId } from './trip-context.ts';

const FLAG_KEY = 'otr:migrated:journal-templates-to-tags';

const BUILTIN_IDS = new Set(['moment', 'note', 'interesting', 'place', 'spark']);

/** Fold custom journal templates into entry tags. Safe to call on every boot. */
export async function migrateJournalTemplatesToTags(): Promise<number> {
  if (localStorage.getItem(FLAG_KEY)) return 0;

  const user = currentUser();
  if (!user) return 0;

  const tripId = currentTripId();
  if (!tripId) return 0;

  const db = getFirestore();
  const base = `users/${user.uid}/trips/${tripId}`;

  const templatesSnap = await getDocs(collection(db, `${base}/journalTemplates`));
  if (templatesSnap.empty) {
    localStorage.setItem(FLAG_KEY, String(Date.now()));
    return 0;
  }

  // templateId -> { label, kind } for the custom ones only.
  const custom = new Map<string, { label: string; kind: string }>();
  for (const d of templatesSnap.docs) {
    const row = d.data() as { label?: string; kind?: string };
    if (BUILTIN_IDS.has(d.id)) continue;
    custom.set(d.id, {
      label: (row.label ?? '').trim(),
      kind: row.kind ?? 'moment',
    });
  }
  if (custom.size === 0) {
    localStorage.setItem(FLAG_KEY, String(Date.now()));
    return 0;
  }

  const entriesSnap = await getDocs(collection(db, `${base}/journalEntries`));
  let count = 0;

  for (const entryDoc of entriesSnap.docs) {
    const entry = entryDoc.data() as { template?: string; tags?: string[] };
    const match = entry.template ? custom.get(entry.template) : undefined;
    if (!match) continue;

    const tags = Array.isArray(entry.tags) ? entry.tags : [];
    // Skip the tag when it's already there — a partial earlier run, or the user
    // having tagged it by hand, shouldn't produce a duplicate.
    const nextTags = match.label && !tags.includes(match.label) ? [...tags, match.label] : tags;

    await updateDoc(fbDoc(db, `${base}/journalEntries/${entryDoc.id}`), {
      template: match.kind,
      tags: nextTags,
      updatedAt: Date.now(),
    });
    count++;
  }

  localStorage.setItem(FLAG_KEY, String(Date.now()));
  return count;
}
