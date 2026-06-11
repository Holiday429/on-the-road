/* ==========================================================================
   On the Road · Paywall
   --------------------------------------------------------------------------
   Central place to show the upgrade prompt and kick off a Lemon Squeezy
   checkout. Two entry points:

     showPaywall()         — show the upgrade modal (e.g. from a 402 catch)
     requireEntitlement()  — gate a feature, show paywall if missing, return bool

   Usage in AI call sites:
     try {
       await someAiCall();
     } catch (e) {
       if (e instanceof QuotaError) { showPaywall(); return; }
       throw e;
     }
   ========================================================================== */

import { openModal } from './modal.ts';
import { QuotaError, AuthError } from './api.ts';
import { currentUser } from '../firebase/auth.ts';
import { entitlementsStore } from '../data/entitlements-store.ts';
import type { Entitlement } from '../data/schema.ts';

// ── Checkout ──────────────────────────────────────────────────────────────────

type CheckoutPlan = 'trip_pass' | 'lifetime';

async function openCheckout(plan: CheckoutPlan, errEl: HTMLElement): Promise<void> {
  const user = currentUser();
  if (!user) {
    errEl.textContent = 'Please sign in first.';
    errEl.hidden = false;
    return;
  }

  errEl.textContent = '';
  errEl.hidden = true;

  let token: string;
  try {
    token = await user.getIdToken();
  } catch {
    errEl.textContent = 'Session expired. Please sign in again.';
    errEl.hidden = false;
    return;
  }

  const btn = errEl.closest('.otr-modal')?.querySelector<HTMLButtonElement>(`[data-plan="${plan}"]`);
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }

  try {
    const res = await fetch('/api/create-checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ plan }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(data.error ?? `Checkout error ${res.status}`);
    }

    const { url } = await res.json() as { url: string };
    if (!url) throw new Error('No checkout URL returned');
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch (e) {
    errEl.textContent = e instanceof Error ? e.message : 'Failed to open checkout. Try again.';
    errEl.hidden = false;
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label ?? 'Buy'; }
  }
}

// ── Paywall modal ─────────────────────────────────────────────────────────────

export function showPaywall(opts: { feature?: string } = {}): void {
  const feature = opts.feature ?? 'AI features';
  openModal({
    title: 'Upgrade to unlock',
    body: `
      <div class="paywall-body">
        <p class="paywall-desc">${feature} require a Trip Pass.</p>
        <div class="paywall-plans">
          <div class="paywall-plan paywall-plan--featured">
            <div class="paywall-plan-name">Trip Pass</div>
            <div class="paywall-plan-price">$9<span class="paywall-plan-period"> once</span></div>
            <ul class="paywall-plan-perks">
              <li>✓ All AI features for this trip</li>
              <li>✓ City guide, safety, story &amp; checklist AI</li>
              <li>✓ Unlimited use during your trip</li>
            </ul>
            <button class="btn btn-primary paywall-btn" data-plan="trip_pass" data-label="Get Trip Pass">
              Get Trip Pass
            </button>
          </div>
          <div class="paywall-plan">
            <div class="paywall-plan-name">Lifetime</div>
            <div class="paywall-plan-price">$29<span class="paywall-plan-period"> once</span></div>
            <ul class="paywall-plan-perks">
              <li>✓ All AI features, all trips, forever</li>
              <li>✓ PDF export + future features</li>
              <li>✓ Support indie development</li>
            </ul>
            <button class="btn btn-secondary paywall-btn" data-plan="lifetime" data-label="Get Lifetime">
              Get Lifetime
            </button>
          </div>
        </div>
        <p class="paywall-error" hidden></p>
      </div>
    `,
    className: 'paywall-modal',
  });

  // Wire checkout buttons after DOM insertion.
  const backdrop = document.querySelector('.otr-modal-backdrop:last-child') as HTMLElement;
  if (!backdrop) return;
  const errEl = backdrop.querySelector<HTMLElement>('.paywall-error')!;

  backdrop.querySelectorAll<HTMLButtonElement>('.paywall-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const plan = btn.dataset.plan as CheckoutPlan;
      openCheckout(plan, errEl);
    });
  });
}

// ── Convenience: gate a feature ───────────────────────────────────────────────

/**
 * Returns true if the user has the given entitlement.
 * If not, shows the upgrade modal and returns false.
 * Use this to short-circuit AI button click handlers.
 */
export function requireEntitlement(id: Entitlement, featureLabel?: string): boolean {
  if (entitlementsStore.has(id)) return true;
  showPaywall({ feature: featureLabel });
  return false;
}

// ── Handle QuotaError / AuthError from postJson ───────────────────────────────

/**
 * Call in catch blocks around postJson. Returns true if the error was handled
 * (caller should stop), false if it's a different error (caller should re-throw).
 */
export function handleAiError(err: unknown): boolean {
  if (err instanceof QuotaError) {
    showPaywall();
    return true;
  }
  if (err instanceof AuthError) {
    // Let the global sign-in flow handle this.
    alert(err.message);
    return true;
  }
  return false;
}
