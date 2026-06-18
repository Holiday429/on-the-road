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
import { t } from './i18n.ts';

// ── Checkout ──────────────────────────────────────────────────────────────────

type CheckoutPlan = 'trip_pass' | 'lifetime' | 'ai_topup';

async function openCheckout(plan: CheckoutPlan, errEl: HTMLElement): Promise<void> {
  const user = currentUser();
  if (!user) {
    errEl.textContent = t('paywall.errorSignIn');
    errEl.hidden = false;
    return;
  }

  errEl.textContent = '';
  errEl.hidden = true;

  let token: string;
  try {
    token = await user.getIdToken();
  } catch {
    errEl.textContent = t('paywall.errorSession');
    errEl.hidden = false;
    return;
  }

  const btn = errEl.closest('.otr-modal')?.querySelector<HTMLButtonElement>(`[data-plan="${plan}"]`);
  if (btn) { btn.disabled = true; btn.textContent = t('common.loading'); }

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
    errEl.textContent = e instanceof Error ? e.message : t('paywall.errorCheckout');
    errEl.hidden = false;
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label ?? 'Buy'; }
  }
}

// ── Paywall modal ─────────────────────────────────────────────────────────────

/** Render the two-plan upgrade modal and wire its checkout buttons. */
function renderPlansModal(desc: string): void {
  openModal({
    title: t('paywall.title'),
    body: `
      <div class="paywall-body">
        <p class="paywall-desc">${desc}</p>
        <div class="paywall-plans">
          <div class="paywall-plan paywall-plan--featured">
            <div class="paywall-plan-badge">${t('paywall.badgePopular')}</div>
            <div class="paywall-plan-name">${t('paywall.planTrip')}</div>
            <div class="paywall-plan-price">$8.8<span class="paywall-plan-period"> / ${t('paywall.planTripPeriod')}</span></div>
            <ul class="paywall-plan-perks">
              <li>🗺️ ${t('paywall.perkOneTrip')}</li>
              <li>✨ ${t('paywall.perkAiGuides')}</li>
              <li>📦 ${t('paywall.perkAllFeatures')}</li>
              <li>🤝 ${t('paywall.perkShare')}</li>
            </ul>
            <button class="btn btn-primary paywall-btn" data-plan="trip_pass" data-label="${t('paywall.btnTripPass')}">
              ${t('paywall.btnTripPass')}
            </button>
          </div>
          <div class="paywall-plan">
            <div class="paywall-plan-badge paywall-plan-badge--alt">${t('paywall.badgeBestValue')}</div>
            <div class="paywall-plan-name">${t('paywall.planLifetime')}</div>
            <div class="paywall-plan-price">$68.8<span class="paywall-plan-period"> ${t('paywall.planLifetimePeriod')}</span></div>
            <ul class="paywall-plan-perks">
              <li>♾️ ${t('paywall.perkUnlimited')}</li>
              <li>✨ ${t('paywall.perkGuidesEvery')}</li>
              <li>🚀 ${t('paywall.perkFuture')}</li>
              <li>💛 ${t('paywall.perkSupport')}</li>
            </ul>
            <button class="btn btn-secondary paywall-btn" data-plan="lifetime" data-label="${t('paywall.btnLifetime')}">
              ${t('paywall.btnLifetime')}
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
  renderPlansModal(t('paywall.quotaMsg'));
}

/** Generic upgrade modal — for users who haven't paid (e.g. free user out of
 *  their one trial AI generation). Surfaces the plan options. */
export function showPaywall(opts: { feature?: string } = {}): void {
  const desc = opts.feature
    ? `${opts.feature} ${t('paywall.featureSuffix')}`
    : t('paywall.defaultMsg');
  renderPlansModal(desc);
}

/** Shown when a PAID user runs out of AI credits — offers the AI top-up booster
 *  (no plan change, just more credits) with the plan options as a fallback. */
export function showAiTopupPaywall(desc?: string): void {
  openModal({
    title: t('paywall.aiTitle'),
    body: `
      <div class="paywall-body">
        <p class="paywall-desc">${desc ?? t('paywall.aiDefaultMsg')}</p>
        <div class="paywall-plans paywall-plans--single">
          <div class="paywall-plan paywall-plan--featured paywall-plan--topup">
            <div class="paywall-topup-icon">✨</div>
            <div class="paywall-plan-name">${t('paywall.planAiTopup')}</div>
            <div class="paywall-plan-price">$2.9<span class="paywall-plan-period"> ${t('paywall.planAiTopupPeriod')}</span></div>
            <ul class="paywall-plan-perks">
              <li>✨ ${t('paywall.perkMoreGuides')}</li>
              <li>🌍 ${t('paywall.perkAcrossTrips')}</li>
              <li>♾️ ${t('paywall.perkNeverExpires')}</li>
            </ul>
            <button class="btn btn-primary paywall-btn" data-plan="ai_topup" data-label="${t('paywall.btnAiTopup')}">
              ${t('paywall.btnAiTopup')}
            </button>
          </div>
        </div>
        <p class="paywall-error" hidden></p>
      </div>
    `,
    className: 'paywall-modal',
  });

  const backdrop = document.querySelector('.otr-modal-backdrop:last-child') as HTMLElement;
  if (!backdrop) return;
  const errEl = backdrop.querySelector<HTMLElement>('.paywall-error')!;
  backdrop.querySelectorAll<HTMLButtonElement>('.paywall-btn').forEach((btn) => {
    btn.addEventListener('click', () => openCheckout(btn.dataset.plan as CheckoutPlan, errEl));
  });
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

// ── AI credit pill ────────────────────────────────────────────────────────────

/**
 * Render an AI credit indicator pill HTML string.
 * Unlimited (lifetime) → subtle "∞ AI" label.
 * Paid with credits left → "✦ N left", amber when ≤ 3.
 * Empty → red clickable "No AI credits — top up".
 */
export function renderAiCreditPill(): string {
  const credits = quotaStore.estimatedAiCredits();
  if (credits === null) {
    return `<span class="ai-credit-pill ai-credit-pill--unlimited">∞ AI</span>`;
  }
  if (credits === 0) {
    return `<button class="ai-credit-pill ai-credit-pill--empty" data-paywall="topup">
      <span class="ai-credit-dot"></span>${t('paywall.aiCreditsNone')}
    </button>`;
  }
  const low = credits <= 3;
  const label = credits === 1
    ? (quotaStore.plan === 'free' ? t('paywall.aiCreditsFree') : t('paywall.aiCreditLow'))
    : t('paywall.aiCreditsLeft', { n: String(credits) });
  return `<span class="ai-credit-pill ${low ? 'ai-credit-pill--low' : ''}">
    <span class="ai-credit-dot"></span>${label}
  </span>`;
}

/** Wire data-paywall="topup" click on a container to open the topup modal. */
export function wireAiCreditPill(container: HTMLElement): void {
  container.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-paywall="topup"]');
    if (btn) showAiTopupPaywall();
  });
}

// ── Handle QuotaError / AuthError from postJson ───────────────────────────────

/**
 * Call in catch blocks around postJson. Returns true if the error was handled
 * (caller should stop), false if it's a different error (caller should re-throw).
 */
export function handleAiError(err: unknown): boolean {
  if (err instanceof QuotaError) {
    // Out-of-credits on a PAID account → offer a top-up booster. A free user
    // who's used their trial (no payment yet) sees the full plan options.
    if (err.needTopup && err.plan !== 'free') showAiTopupPaywall(err.message);
    else showPaywall();
    return true;
  }
  if (err instanceof AuthError) {
    // Let the global sign-in flow handle this.
    alert(err.message);
    return true;
  }
  return false;
}
