/* ==========================================================================
   On the Road · Paywall
   --------------------------------------------------------------------------
   Central place to show the upgrade prompt and kick off a Lemon Squeezy
   checkout. At launch the paywall gates *trip creation* (a free account owns
   1 trip; more need a Trip Pass or Lifetime), not AI.

   Entry points:
     showTripQuotaPaywall() — "you're out of trip slots", shown by the New-trip
                              flow when canCreateTrip() is false.
     showPaywall()          — generic upgrade modal (kept for AI 402 catches that
                              stay dormant until AI ships).
     requireTripSlot()      — gate trip creation; shows paywall + returns false.
   ========================================================================== */

import { openModal } from './modal.ts';
import { QuotaError, AuthError, apiUrl } from './api.ts';
import { currentUser } from '../firebase/auth.ts';
import { quotaStore } from '../data/quota-store.ts';

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
    const res = await fetch(apiUrl('/api/create-checkout'), {
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

/** Render the two-plan upgrade modal and wire its checkout buttons. */
function renderPlansModal(desc: string): void {
  openModal({
    title: 'Plan your next trip',
    body: `
      <div class="paywall-body">
        <p class="paywall-desc">${desc}</p>
        <div class="paywall-plans">
          <div class="paywall-plan paywall-plan--featured">
            <div class="paywall-plan-name">Trip Pass</div>
            <div class="paywall-plan-price">$9<span class="paywall-plan-period"> once</span></div>
            <ul class="paywall-plan-perks">
              <li>✓ One more trip, yours to keep</li>
              <li>✓ Every feature — itinerary, expenses, packing, map &amp; more</li>
              <li>✓ Share it with travel companions</li>
            </ul>
            <button class="btn btn-primary paywall-btn" data-plan="trip_pass" data-label="Get Trip Pass">
              Get Trip Pass
            </button>
          </div>
          <div class="paywall-plan">
            <div class="paywall-plan-name">Lifetime</div>
            <div class="paywall-plan-price">$29<span class="paywall-plan-period"> once</span></div>
            <ul class="paywall-plan-perks">
              <li>✓ Unlimited trips, forever</li>
              <li>✓ Every current &amp; future feature</li>
              <li>✓ Support indie development</li>
            </ul>
            <button class="btn btn-primary paywall-btn" data-plan="lifetime" data-label="Get Lifetime">
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

/** Shown when a free user hits their owned-trip limit on "+ New trip". */
export function showTripQuotaPaywall(): void {
  renderPlansModal("You've used your free trip. Get a Trip Pass for one more, or go Lifetime for unlimited trips.");
}

/** Generic upgrade modal. Dormant until AI features ship. */
export function showPaywall(opts: { feature?: string } = {}): void {
  const desc = opts.feature
    ? `${opts.feature} need a Trip Pass or Lifetime.`
    : 'Unlock more with a Trip Pass or go Lifetime.';
  renderPlansModal(desc);
}

// ── Convenience: gate trip creation ───────────────────────────────────────────

/**
 * Returns true if the user can create another owned trip.
 * If not, shows the trip-quota paywall and returns false.
 * Use this to short-circuit "+ New trip" handlers.
 */
export function requireTripSlot(): boolean {
  if (quotaStore.canCreateTrip()) return true;
  showTripQuotaPaywall();
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
