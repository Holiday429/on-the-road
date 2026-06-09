/* ==========================================================================
   On the Road · Safety content store — remote-controlled essentials
   --------------------------------------------------------------------------
   App-global (not trip-scoped, not user-scoped). Lives at:
     safetyContent/{groupId}
   Allows editing checklist content via Firestore without a code redeploy.
   Falls back to SEED_ESSENTIALS on first load / offline.
   ========================================================================== */

import {
  collection, onSnapshot, getDocs, query, setDoc, doc as firestoreDoc,
} from 'firebase/firestore';
import { db as firestore } from '../../firebase/config.ts';
import { EssentialGroupSchema, type EssentialGroup } from '../schema.ts';
import { ESSENTIALS as LOCAL_SEED } from '../../views/safety/essentials.ts';

const COL = 'safetyContent';

export type StoredEssentialGroup = EssentialGroup & { id: string };

/* ── seed from static essentials.ts ────────────────────────────────────────── */
function seedGroups(): StoredEssentialGroup[] {
  return LOCAL_SEED.map((g, i) => {
    const id = g.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return {
      id,
      icon: g.icon,
      title: g.title,
      sortOrder: i,
      items: g.items.map((text, j) => ({ id: `${id}-${j}`, text, sortOrder: j })),
      createdAt: 0,
      updatedAt: 0,
      schemaVersion: 1,
    };
  });
}

export const safetyContentStore = {
  /**
   * Subscribe to essentials groups. Emits immediately from seed, then updates
   * when Firestore data arrives.
   */
  subscribe(cb: (groups: StoredEssentialGroup[]) => void): () => void {
    // Emit seed immediately so UI isn't empty on first render
    cb(seedGroups());

    const col = collection(firestore, COL);
    const unsub = onSnapshot(query(col), (snap) => {
      if (snap.empty) {
        // First time — write seeds to Firestore so they're editable remotely
        void this.seedToFirestore();
        return; // will re-emit via the snapshot when writes land
      }
      const groups: StoredEssentialGroup[] = snap.docs
        .map((d) => {
          const raw = d.data();
          const parsed = EssentialGroupSchema.safeParse({ ...raw, id: d.id });
          if (!parsed.success) return null;
          return { ...parsed.data, id: d.id } as StoredEssentialGroup;
        })
        .filter((g): g is StoredEssentialGroup => g !== null)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      cb(groups);
    });

    return unsub;
  },

  /** Write seed groups to Firestore (called once when collection is empty). */
  async seedToFirestore(): Promise<void> {
    const groups = seedGroups();
    await Promise.all(
      groups.map((g) => {
        const { id, ...data } = g;
        return setDoc(firestoreDoc(firestore, COL, id), {
          ...data,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          schemaVersion: 1,
        });
      }),
    );
  },

  /** Fetch once (for offline/initial). */
  async list(): Promise<StoredEssentialGroup[]> {
    try {
      const snap = await getDocs(query(collection(firestore, COL)));
      if (snap.empty) return seedGroups();
      return snap.docs
        .map((d) => {
          const parsed = EssentialGroupSchema.safeParse({ ...d.data(), id: d.id });
          return parsed.success ? ({ ...parsed.data, id: d.id } as StoredEssentialGroup) : null;
        })
        .filter((g): g is StoredEssentialGroup => g !== null)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    } catch {
      return seedGroups();
    }
  },
};

/* ── Checklist check-state store (user-scoped) ──────────────────────────────
   Stores { [itemId]: boolean } for each user so ticks persist across sessions.
   Kept simple: one Firestore doc per user at users/{uid}/safetyChecks/me      */

import { createUserCollectionStore } from '../../firebase/db.ts';
import { z } from 'zod';

const CheckStateSchema = z.object({
  id: z.string(),
  checks: z.record(z.string(), z.boolean()).default({}),
});

function store() {
  return createUserCollectionStore('safetyChecks', CheckStateSchema);
}

const CHECK_DOC = 'me';

export const checklistStateStore = {
  subscribe(cb: (checks: Record<string, boolean>) => void): () => void {
    return store().subscribe((rows) => {
      const row = rows.find((r) => r.id === CHECK_DOC);
      cb(row?.checks ?? {});
    });
  },

  async toggle(itemId: string, checked: boolean): Promise<void> {
    const current = store().peek().find((r) => r.id === CHECK_DOC);
    const checks = { ...(current?.checks ?? {}), [itemId]: checked };
    await store().set({ id: CHECK_DOC, checks });
  },

  async clear(): Promise<void> {
    await store().set({ id: CHECK_DOC, checks: {} });
  },
};
