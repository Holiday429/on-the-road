/* ==========================================================================
   On the Road · Trip modals — rename / delete / leave / create trip
   ========================================================================== */

import {
  currentTripId, listTrips, createTrip, switchTrip,
  updateTrip, removeTrip, leaveTrip as leaveTripCtx,
  TripQuotaError,
  type StoredTrip, type NewTripInput,
} from '../data/trip-context.ts';
import { requireTripSlot, showTripQuotaPaywall } from './paywall.ts';
import { TRAVEL_STYLES, type TravelStyle } from '../data/schema.ts';
import { createDestinationInput, type DestinationInputInstance } from './destination-input.ts';
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

/* ── New-trip modal (shared builder) ────────────────────────────────────── */

const STYLE_LABELS: Record<TravelStyle, string> = {
  solo: 'Solo',
  couple: 'Couple',
  family: 'Family',
  friends: 'Friends',
  group: 'Group',
};

const COVER_COLORS = ['#f9b830', '#e07b54', '#5b9bd5', '#6abf69', '#9b7dd4', '#e05c7a'];

/**
 * Build and mount the full trip-creation form. Used both by the sidebar
 * "+ New trip" action and the first-run onboarding flow.
 *
 * @param opts.onCreated     Called with the new trip id after creation.
 * @param opts.onCancel      Called when user dismisses (only shown when !isOnboarding).
 */
function openTripForm(opts: {
  onCreated: (id: string) => void;
  onCancel?: () => void;
}) {

  // State
  let selectedStyle: TravelStyle | null = null;
  let selectedColor = COVER_COLORS[0];
  let destPicker: DestinationInputInstance | null = null;

  const backdrop = document.createElement('div');
  backdrop.className = 'trip-modal-backdrop';

  function renderStylePills(): string {
    return TRAVEL_STYLES.map(s => `
      <button type="button" class="trip-style-btn${selectedStyle === s ? ' is-active' : ''}" data-style="${s}">
        ${STYLE_LABELS[s]}
      </button>
    `).join('');
  }

  function renderColorSwatches(): string {
    return COVER_COLORS.map(c => `
      <button type="button" class="trip-color-swatch${c === selectedColor ? ' is-active' : ''}"
        data-color="${c}" style="background:${c}" title="${c}"></button>
    `).join('');
  }

  function buildHtml(): string {
    return `
      <div class="trip-modal" role="dialog" aria-modal="true" aria-label="${t('app.newTripTitle')}">
        <h3 class="trip-modal-title">${t('app.newTripTitle')}</h3>

        <label class="trip-modal-field">
          <span>${t('app.labelTripName')}</span>
          <input id="nt-name" class="input" placeholder="${t('onboarding.namePh')}" autocomplete="off">
        </label>

        <div class="trip-modal-row">
          <label class="trip-modal-field">
            <span>${t('onboarding.labelStartDate')}</span>
            <input id="nt-start" class="input" type="date">
          </label>
          <label class="trip-modal-field">
            <span>${t('onboarding.labelEndDate')}</span>
            <input id="nt-end" class="input" type="date">
          </label>
        </div>

        <label class="trip-modal-field">
          <span>${t('onboarding.labelDests')} <span style="font-weight:400;color:var(--ink-faint)">(optional)</span></span>
          <div id="nt-dest-mount"></div>
        </label>

        <label class="trip-modal-field">
          <span>${t('onboarding.labelStyle')} <span style="font-weight:400;color:var(--ink-faint)">(optional)</span></span>
          <div class="trip-style-group" id="nt-style-group">
            ${renderStylePills()}
          </div>
        </label>

        <div class="trip-modal-row">
          <label class="trip-modal-field">
            <span>Base currency</span>
            <input id="nt-currency" class="input" value="EUR" maxlength="3" style="text-transform:uppercase">
          </label>
          <label class="trip-modal-field">
            <span>${t('onboarding.labelCoverColor')}</span>
            <div class="trip-color-swatches" id="nt-colors">
              ${renderColorSwatches()}
            </div>
          </label>
        </div>

        <label class="trip-modal-field">
          <span>Notes <span style="font-weight:400;color:var(--ink-faint)">(optional)</span></span>
          <input id="nt-notes" class="input" placeholder="${t('onboarding.notesPh')}">
        </label>

        <div class="trip-modal-actions">
          <button class="btn" id="nt-cancel">${t('common.cancel')}</button>
          <button class="btn btn-primary" id="nt-create">${t('app.btnCreateTrip')}</button>
        </div>
        <div class="trip-modal-error" id="nt-error"></div>
      </div>
    `;
  }

  function mount() {
    // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N5)
    backdrop.innerHTML = buildHtml();
    document.body.appendChild(backdrop);
    // Mount destination picker into its slot
    const destMount = backdrop.querySelector<HTMLElement>('#nt-dest-mount');
    if (destMount) {
      destPicker = createDestinationInput({ container: destMount, placeholder: 'Search countries or cities…' });
    }
    backdrop.querySelector<HTMLInputElement>('#nt-name')?.focus();
    wireEvents();
  }

  function rerenderPart(selector: string, html: string) {
    const el = backdrop.querySelector<HTMLElement>(selector);
    // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N5)
    if (el) el.innerHTML = html;
  }

  function wireEvents() {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) { backdrop.remove(); opts.onCancel?.(); }
    });
    backdrop.querySelector('#nt-cancel')?.addEventListener('click', () => {
      backdrop.remove(); opts.onCancel?.();
    });

    // Travel style pills — event delegation on the static wrapper; pills re-render inside it
    backdrop.querySelector('#nt-style-group')?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.trip-style-btn');
      if (!btn) return;
      const s = btn.dataset.style as TravelStyle;
      selectedStyle = selectedStyle === s ? null : s;
      rerenderPart('#nt-style-group', renderStylePills());
    });

    // Color swatches
    backdrop.querySelector('#nt-colors')?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-color]');
      if (!btn) return;
      selectedColor = btn.dataset.color!;
      rerenderPart('#nt-colors', renderColorSwatches());
    });

    // Create
    const errorEl = backdrop.querySelector<HTMLElement>('#nt-error')!;
    backdrop.querySelector('#nt-create')?.addEventListener('click', async () => {
      const name = backdrop.querySelector<HTMLInputElement>('#nt-name')!.value.trim();
      const startDate = backdrop.querySelector<HTMLInputElement>('#nt-start')!.value;
      const endDate = backdrop.querySelector<HTMLInputElement>('#nt-end')!.value;
      const baseCurrency = backdrop.querySelector<HTMLInputElement>('#nt-currency')!.value.trim().toUpperCase() || 'EUR';
      const notes = backdrop.querySelector<HTMLInputElement>('#nt-notes')!.value.trim() || undefined;

      if (!name || !startDate || !endDate) {
        errorEl.textContent = t('onboarding.errorDates');
        return;
      }
      if (endDate < startDate) {
        errorEl.textContent = t('onboarding.errorEndDate');
        return;
      }

      const dests = destPicker?.getValues() ?? [];
      const input: NewTripInput = {
        name, startDate, endDate, baseCurrency,
        coverColor: selectedColor,
        travelStyle: selectedStyle ?? undefined,
        destinations: dests.length > 0 ? dests : undefined,
        notes,
      };

      const btn = backdrop.querySelector<HTMLButtonElement>('#nt-create')!;
      btn.disabled = true;
      btn.textContent = t('onboarding.creating');
      try {
        const id = await createTrip(input);
        host!.setTripList(await listTrips());
        destPicker?.destroy();
        backdrop.remove();
        await switchTrip(id);
        opts.onCreated(id);
      } catch (e) {
        // Safety net: if the quota gate fired (e.g. a slot was used in another
        // tab after this form opened), close the form and show the paywall
        // instead of a dead-end error inside the create dialog.
        if (e instanceof TripQuotaError) {
          destPicker?.destroy();
          backdrop.remove();
          showTripQuotaPaywall();
          return;
        }
        btn.disabled = false;
        btn.textContent = t('app.btnCreateTrip');
        errorEl.textContent = e instanceof Error ? e.message : 'Could not create trip.';
      }
    });

    // Destroy picker on cancel too
    backdrop.querySelector('#nt-cancel')?.addEventListener('click', () => {
      destPicker?.destroy();
    }, { once: true });
  }

  mount();
}

export function openNewTripModal() {
  host!.buildSidebar(); // close the menu first
  // Pre-gate: out of owned-trip slots → show the paywall, not the form.
  if (!requireTripSlot()) return;
  openTripForm({
    onCreated: () => { /* sidebar already rebuilt by switchTrip → onTripChange */ },
  });
}
