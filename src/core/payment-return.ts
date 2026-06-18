/* ==========================================================================
   On the Road · Post-payment return handler
   --------------------------------------------------------------------------
   Lemon Squeezy redirects back with ?payment=success after checkout.
   The entitlement is granted by the webhook → users/{uid} → quota-store
   onSnapshot, so all we do here is confirm to the user and nudge the store.
   ========================================================================== */

import { quotaStore } from '../data/quota-store.ts';
import { t } from './i18n.ts';

export function handlePaymentReturn(): void {
  const params = new URLSearchParams(window.location.search);
  if (params.get('payment') !== 'success') return;

  // Strip the param so reloads don't re-toast.
  params.delete('payment');
  const qs = params.toString();
  history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);

  // Webhook may land slightly after the redirect; recount now and again shortly.
  void quotaStore.refresh();
  setTimeout(() => void quotaStore.refresh(), 3000);

  showThanksToast();
}

function showThanksToast(): void {
  const el = document.createElement('div');
  el.className = 'otr-pay-toast';
  el.textContent = t('paywall.payThanks');
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}
