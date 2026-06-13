/* ==========================================================================
   On the Road · Account & billing modal
   --------------------------------------------------------------------------
   Shows the signed-in user their plan, trip-slot usage, and purchase history,
   plus an entry to buy more slots. Opened from the sidebar profile.

   Plan/quota come from quota-store (live). Purchase records are read from
   users/{uid}/purchases (written by api/_billing.grantQuota).
   ========================================================================== */

import { openModal } from './modal.ts';
import { currentUser } from '../firebase/auth.ts';
import { quotaStore } from '../data/quota-store.ts';
import { showPaywall } from './paywall.ts';
import { escHtml } from './utils.ts';
import { LIFETIME_QUOTA } from '../data/schema.ts';

interface PurchaseRow { id: string; plan?: string; amount?: number | null; at?: number }

async function loadPurchases(uid: string): Promise<PurchaseRow[]> {
  try {
    const { collection, getDocs, query, orderBy } = await import('firebase/firestore');
    const { db } = await import('../firebase/config.ts');
    const snap = await getDocs(query(collection(db, `users/${uid}/purchases`), orderBy('at', 'desc')));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PurchaseRow, 'id'>) }));
  } catch {
    return [];
  }
}

function planLabel(): string {
  switch (quotaStore.tripQuota >= LIFETIME_QUOTA ? 'lifetime' : (quotaStore.tripQuota > 1 ? 'trip_pass' : 'free')) {
    case 'lifetime':  return 'Lifetime — unlimited trips';
    case 'trip_pass': return `Trip Pass — ${quotaStore.tripQuota} trips`;
    default:          return 'Free — 1 trip';
  }
}

function fmtDate(ms?: number): string {
  if (!ms) return '';
  try { return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return ''; }
}

export function openAccountModal(): void {
  const user = currentUser();
  if (!user) return;

  const unlimited = quotaStore.tripQuota >= LIFETIME_QUOTA;
  const used = quotaStore.usedSlots;
  const total = unlimited ? '∞' : String(quotaStore.tripQuota);

  const m = openModal({
    title: 'Account',
    className: 'account-modal',
    body: `
      <div class="account-body">
        <div class="account-row">
          <span class="account-label">Signed in as</span>
          <span class="account-value">${escHtml(user.email ?? user.displayName ?? 'Traveler')}</span>
        </div>
        <div class="account-row">
          <span class="account-label">Plan</span>
          <span class="account-value">${escHtml(planLabel())}</span>
        </div>
        <div class="account-row">
          <span class="account-label">Trips</span>
          <span class="account-value">${used} / ${total} used</span>
        </div>

        ${unlimited ? '' : `
          <button class="btn btn-primary account-upgrade" id="account-upgrade">Get more trips</button>
        `}

        <div class="account-section-head">Purchase history</div>
        <div class="account-purchases" id="account-purchases">
          <div class="account-loading">Loading…</div>
        </div>

        <p class="account-support">
          Billing questions or a refund? Email
          <a href="mailto:support@easy-on-the-road.app">support@easy-on-the-road.app</a>.
        </p>
      </div>
    `,
    footer: `<button class="btn" data-otr-close>Close</button>`,
  });

  m.root.querySelector('#account-upgrade')?.addEventListener('click', () => {
    m.close();
    showPaywall();
  });

  // Fill purchase history asynchronously.
  void loadPurchases(user.uid).then((rows) => {
    const el = m.root.querySelector<HTMLElement>('#account-purchases');
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = `<div class="account-empty">No purchases yet.</div>`;
      return;
    }
    el.innerHTML = rows.map((r) => {
      const label = r.plan === 'lifetime' ? 'Lifetime' : r.plan === 'trip_pass' ? 'Trip Pass' : escHtml(r.plan ?? '—');
      const amount = typeof r.amount === 'number' ? `$${(r.amount / 100).toFixed(2)}` : '';
      return `<div class="account-purchase-row">
        <span>${label}</span>
        <span class="account-purchase-meta">${fmtDate(r.at)}${amount ? ` · ${amount}` : ''}</span>
      </div>`;
    }).join('');
  });
}
