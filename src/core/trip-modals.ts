/* ==========================================================================
   On the Road · Trip modals — rename / delete / leave / create trip
   ========================================================================== */

import {
  currentTripId, listTrips, switchTrip,
  updateTrip, removeTrip, leaveTrip as leaveTripCtx,
  type StoredTrip,
} from '../data/trip-context.ts';
import { requireTripSlot } from './paywall.ts';
import { escHtml as escapeHtml } from './utils.ts';
import { openModal } from './modal.ts';
import { t } from './i18n.ts';

// Injected by app.ts to avoid a circular import (trip-modals needs to refresh
// the sidebar / tripList / trigger onboarding, which app.ts owns).
export interface TripModalsHost {
  setTripList(trips: StoredTrip[]): void;
  buildSidebar(): void;
  openOnboarding(): void;
}
let host: TripModalsHost | null = null;
export function initTripModals(h: TripModalsHost): void {
  host = h;
}

/* ── Rename / Delete / Leave trip modals ────────────────────────────────── */

export function openRenameTripModal(trip: StoredTrip) {
  const m = openModal({
    title: t('app.editTripTitle'),
    className: 'trip-edit-modal',
    body: `
      <label class="trip-modal-field">
        <span>${t('app.labelTripName')}</span>
        <input id="rt-name" class="input" value="${escapeHtml(trip.name)}" autocomplete="off">
      </label>
      <div class="trip-modal-row">
        <label class="trip-modal-field">
          <span>${t('app.labelHomeCity')} <span class="trip-modal-opt">(flying from)</span></span>
          <input id="rt-home" class="input" value="${escapeHtml(trip.homeCity ?? '')}" placeholder="${t('onboarding.homeCityPh')}" autocomplete="off">
        </label>
        <label class="trip-modal-field">
          <span>${t('app.labelReturnCity')} <span class="trip-modal-opt">(flying back to)</span></span>
          <input id="rt-return" class="input" value="${escapeHtml(trip.returnCity ?? '')}" placeholder="${t('onboarding.returnCityPh')}" autocomplete="off">
        </label>
      </div>
      <span class="trip-modal-hint">${t('app.homeReturnHint')}</span>
      <div class="trip-modal-error" id="rt-error"></div>`,
    footer: `
      <button class="btn" data-otr-close>${t('common.cancel')}</button>
      <button class="btn btn-primary" id="rt-save">${t('common.save')}</button>`,
  });

  const nameInput = m.root.querySelector<HTMLInputElement>('#rt-name')!;
  const homeInput = m.root.querySelector<HTMLInputElement>('#rt-home')!;
  const returnInput = m.root.querySelector<HTMLInputElement>('#rt-return')!;
  const errorEl = m.root.querySelector<HTMLElement>('#rt-error')!;

  nameInput.focus();
  nameInput.select();
  m.root.querySelectorAll('input').forEach((el) =>
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); }));

  async function save() {
    const name = nameInput.value.trim();
    if (!name) { errorEl.textContent = t('app.errorNameEmpty'); return; }
    // Empty string (not undefined) so clearing a field overwrites the stored
    // value — stripUndefined would otherwise drop the key and keep the old one.
    const homeCity = homeInput.value.trim();
    const returnCity = returnInput.value.trim();
    const btn = m.root.querySelector<HTMLButtonElement>('#rt-save')!;
    btn.disabled = true; btn.textContent = t('common.saving');
    try {
      await updateTrip(trip.id, { name, homeCity, returnCity });
      host!.setTripList(await listTrips());
      m.close();
      host!.buildSidebar();
    } catch (e) {
      btn.disabled = false; btn.textContent = t('common.save');
      errorEl.textContent = e instanceof Error ? e.message : 'Could not save trip.';
    }
  }

  m.root.querySelector('#rt-save')!.addEventListener('click', save);
}

export function openDeleteTripModal(trip: StoredTrip) {
  const m = openModal({
    title: t('app.deleteTripTitle'),
    className: 'trip-edit-modal',
    body: `
      <p style="font-size:var(--fs-sm);color:var(--ink-muted);margin:0">
        ${t('app.deleteTripWarning', { name: escapeHtml(trip.name) })}
      </p>
      <div class="trip-modal-error" id="dt-error"></div>`,
    footer: `
      <button class="btn" data-otr-close>${t('common.cancel')}</button>
      <button class="btn btn-danger" id="dt-confirm">${t('common.delete')}</button>`,
  });

  m.root.querySelector('#dt-confirm')!.addEventListener('click', async () => {
    const btn = m.root.querySelector<HTMLButtonElement>('#dt-confirm')!;
    const errorEl = m.root.querySelector<HTMLElement>('#dt-error')!;
    btn.disabled = true; btn.textContent = t('app.deleting');
    try {
      await removeTrip(trip.id);
      const tripList = await listTrips();
      host!.setTripList(tripList);
      m.close();
      // If we just deleted the active trip, switch to the first remaining one
      // (or show onboarding if none left).
      if (currentTripId() === trip.id) {
        if (tripList.length > 0) {
          await switchTrip(tripList[0].id);
        } else {
          host!.buildSidebar();
          host!.openOnboarding();
        }
      } else {
        host!.buildSidebar();
      }
    } catch (e) {
      btn.disabled = false; btn.textContent = t('common.delete');
      errorEl.textContent = e instanceof Error ? e.message : 'Could not delete trip.';
    }
  });
}

export function openLeaveTripModal(trip: StoredTrip) {
  const m = openModal({
    title: t('app.leaveTripTitle'),
    className: 'trip-edit-modal',
    body: `
      <p style="font-size:var(--fs-sm);color:var(--ink-muted);margin:0">
        ${t('app.leaveTripWarning', { name: escapeHtml(trip.name) })}
      </p>
      <div class="trip-modal-error" id="lt-error"></div>`,
    footer: `
      <button class="btn" data-otr-close>${t('common.cancel')}</button>
      <button class="btn btn-danger" id="lt-confirm">${t('app.btnLeave')}</button>`,
  });

  m.root.querySelector('#lt-confirm')!.addEventListener('click', async () => {
    const btn = m.root.querySelector<HTMLButtonElement>('#lt-confirm')!;
    const errorEl = m.root.querySelector<HTMLElement>('#lt-error')!;
    btn.disabled = true; btn.textContent = t('app.leaving');
    try {
      const wasActive = currentTripId() === trip.id;
      await leaveTripCtx(trip.id);
      const tripList = await listTrips();
      host!.setTripList(tripList);
      m.close();
      if (wasActive) {
        if (tripList.length > 0) {
          await switchTrip(tripList[0].id);
        } else {
          host!.buildSidebar();
          host!.openOnboarding();
        }
      } else {
        host!.buildSidebar();
      }
    } catch (e) {
      btn.disabled = false; btn.textContent = t('app.btnLeave');
      errorEl.textContent = e instanceof Error ? e.message : 'Could not leave trip.';
    }
  });
}

/* ── New trip ───────────────────────────────────────────────────────────── */

/** "+ New trip": the same wide full-page form a new user sees first (views/onboarding). */
export function openNewTripModal() {
  host!.buildSidebar(); // close the menu first
  // Pre-gate: anonymous visitor → sign-in prompt (then reopen); registered but
  // out of owned-trip slots → paywall. Either way, don't show the form.
  if (!requireTripSlot(openNewTripModal)) return;
  void import('../views/onboarding/onboarding.ts').then(({ showOnboarding }) => {
    showOnboarding(() => { /* sidebar already rebuilt by switchTrip → onTripChange */ }, {
      mode: 'new',
      beforeSwitch: async () => { host!.setTripList(await listTrips()); },
    });
  });
}
