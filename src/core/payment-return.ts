/* ==========================================================================
   On the Road · Post-payment return handler
   --------------------------------------------------------------------------
   Lemon Squeezy (and the future Alipay/WeChat flow) redirect back with
   ?payment=success after checkout. The entitlement itself is granted by the
   webhook → users/{uid} → quota-store onSnapshot, so all we do here is:
     - confirm to the user that the purchase went through,
     - nudge the quota-store to recount,
     - strip the query param so a refresh doesn't re-toast.
   ========================================================================== */

import { quotaStore } from '../data/quota-store.ts';

export function handlePaymentReturn(): void {
  const params = new URLSearchParams(window.location.search);
  if (params.get('payment') !== 'success') return;

  // Clean the URL (keep the hash route) so reloads don't repeat the toast.
  params.delete('payment');
  const qs = params.toString();
  history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);

  // The webhook may land slightly after the redirect; recount now and again
  // shortly so the new slot/plan reflects without a manual refresh.
  void quotaStore.refresh();
  setTimeout(() => void quotaStore.refresh(), 3000);

  showThanksToast();
}

function showThanksToast(): void {
  const el = document.createElement('div');
  el.className = 'otr-pay-toast';
  el.textContent = '🎉 Payment received — thank you! Your new trip is unlocked.';
  el.style.cssText =
    'position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);' +
    'background:#16a34a;color:#fff;padding:.7rem 1.4rem;border-radius:9999px;' +
    'font-size:.9rem;font-weight:600;z-index:10000;box-shadow:0 6px 20px rgba(0,0,0,.25)';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}
