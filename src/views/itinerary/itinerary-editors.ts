/* ==========================================================================
   On the Road · Itinerary — editor overlays
   --------------------------------------------------------------------------
   Self-contained dialog factories for inline editing of dates, transport,
   stays, and expense-sync. Each function receives patchLeg / persistStays
   as callback parameters so there is no circular dependency on itinerary.ts.
   ========================================================================== */

import { escHtml as esc } from '../../core/utils.ts';
import { CURRENCIES, currencySymbol, getRateTable, peekRateTable, type RateTable } from '../../data/rates.ts';
import { COUNTRY_CURRENCY, convert } from '../expenses/expense-defaults.ts';
import { expenseStore } from '../../data/stores/expense-store.ts';
import { baseCurrency } from '../../data/trip-context.ts';
import type { Leg as SchemaLeg } from '../../data/schema.ts';
import { TRANSPORT_ICONS, uid, clean, daysBetween, legStays } from './itinerary-utils.ts';

type Transport = NonNullable<SchemaLeg['arrivalTransport']>;
type Accommodation = NonNullable<SchemaLeg['accommodations']>[number];
type Leg = SchemaLeg & { id: string };
type PatchFn = (id: string, patch: Partial<SchemaLeg>) => Promise<void> | void;
type PersistStaysFn = (leg: Leg, stays: Accommodation[]) => Promise<void> | void;

/* ── Shared helpers ─────────────────────────────────────────────────────── */

export function fieldVal(scope: HTMLElement, id: string): string {
  return (scope.querySelector('#' + id) as HTMLInputElement | HTMLSelectElement)?.value.trim() ?? '';
}

const STAY_PLATFORMS = [
  'Airbnb', 'Booking.com', 'Agoda', 'Expedia', 'Hotels.com',
  'Trip.com', 'Hostelworld', 'Vrbo', 'Direct',
];

function stayCurrencyOptions(selected: string): string {
  const known = CURRENCIES.some((c) => c.code === selected);
  return CURRENCIES.map((c) =>
    `<option value="${c.code}" ${c.code === selected ? 'selected' : ''}>${c.flag} ${c.code} ${c.symbol}</option>`,
  ).join('') + (known ? '' : `<option value="${esc(selected)}" selected>${esc(selected)}</option>`);
}

/* ── Editor functions ───────────────────────────────────────────────────── */

export function openDatesEditor(timeline: HTMLElement, leg: Leg, patchLeg: PatchFn): void {
  const host = timeline.querySelector<HTMLElement>('.rd-shell')!;
  const dlg = document.createElement('div');
  dlg.className = 'rd-editor-overlay';
  dlg.innerHTML = `
    <div class="rd-editor" style="max-width:400px">
      <div class="rd-editor-title">Edit dates · ${esc(leg.city)}</div>
      <div class="rd-editor-grid">
        <div>
          <label class="field-label">Arrival date</label>
          <input class="input" type="date" id="de-from" value="${esc(leg.dateFrom)}">
        </div>
        <div>
          <label class="field-label">Departure date</label>
          <input class="input" type="date" id="de-to" value="${esc(leg.dateTo)}">
        </div>
      </div>
      <div class="rd-editor-btns">
        <button class="btn btn-ghost" data-ed="cancel">Cancel</button>
        <button class="btn btn-primary" data-ed="save">Save</button>
      </div>
    </div>`;
  host.appendChild(dlg);

  const close = () => dlg.remove();
  dlg.querySelector('[data-ed="cancel"]')!.addEventListener('click', close);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  dlg.querySelector('[data-ed="save"]')!.addEventListener('click', () => {
    const from = (dlg.querySelector('#de-from') as HTMLInputElement).value;
    const to = (dlg.querySelector('#de-to') as HTMLInputElement).value;
    if (!from || !to) { alert('Both dates are required.'); return; }
    if (from > to) { alert('Arrival must be before departure.'); return; }
    patchLeg(leg.id, { dateFrom: from, dateTo: to });
    close();
  });
}

export function openTransportEditor(
  timeline: HTMLElement,
  leg: Leg,
  patchLeg: PatchFn,
  onSyncNeeded: (timeline: HTMLElement, leg: Leg) => void,
): void {
  const t = leg.arrivalTransport;
  const defaultCur = t?.priceCurrency ?? COUNTRY_CURRENCY[leg.country] ?? baseCurrency();
  const kg = (g?: number) => (g ? g / 1000 : '');
  const host = timeline.querySelector<HTMLElement>('.rd-shell')!;
  const dlg = document.createElement('div');
  dlg.className = 'rd-editor-overlay';
  dlg.innerHTML = `
    <div class="rd-editor rd-editor--wide">
      <div class="rd-editor-title">Transportation to ${esc(leg.city)}</div>
      <div class="rd-editor-grid">
        <div>
          <label class="field-label">Mode</label>
          <select class="input select" id="te-type">
            ${['train', 'flight', 'bus', 'ferry'].map((m) => `<option value="${m}" ${t?.type === m ? 'selected' : ''}>${TRANSPORT_ICONS[m]} ${m[0].toUpperCase() + m.slice(1)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="field-label">Coming from</label>
          <input class="input" id="te-from" value="${esc(t?.from)}" placeholder="e.g. Vienna">
        </div>
        <div>
          <label class="field-label">Via (stopovers)</label>
          <input class="input" id="te-via" value="${esc((t?.via ?? []).join(', '))}" placeholder="e.g. Beijing (联程)">
        </div>
        <div>
          <label class="field-label">Service / number</label>
          <input class="input" id="te-service" value="${esc(t?.service)}" placeholder="e.g. EC 79 / LH 234">
        </div>
        <div>
          <label class="field-label">Price</label>
          <input class="input" id="te-price" type="number" min="0" step="0.01" inputmode="decimal"
                 value="${t?.priceAmount ?? ''}" placeholder="e.g. 89">
        </div>
        <div>
          <label class="field-label">Currency</label>
          <select class="input select" id="te-currency">${stayCurrencyOptions(defaultCur)}</select>
        </div>
        <div>
          <label class="field-label">Depart</label>
          <input class="input" id="te-time" value="${esc(t?.time)}" placeholder="e.g. 09:15">
        </div>
        <div>
          <label class="field-label">Arrive</label>
          <input class="input" id="te-arr-time" value="${esc(t?.arrivalTime)}" placeholder="e.g. 14:30">
        </div>
        <div>
          <label class="field-label">Duration</label>
          <input class="input" id="te-duration" value="${esc(t?.duration)}" placeholder="e.g. ~5h">
        </div>
        <div class="rd-field-row is-trio">
          <div>
            <label class="field-label">Personal (kg)</label>
            <input class="input" id="te-bag-personal" type="number" min="0" step="0.1"
              value="${kg(t?.baggagePersonalG)}" placeholder="e.g. 5">
          </div>
          <div>
            <label class="field-label">Carry-on (kg)</label>
            <input class="input" id="te-bag-carry" type="number" min="0" step="0.1"
              value="${kg(t?.baggageCarryOnG ?? t?.baggageAllowanceG)}" placeholder="e.g. 10">
          </div>
          <div>
            <label class="field-label">Checked (kg)</label>
            <input class="input" id="te-bag-checked" type="number" min="0" step="0.1"
              value="${kg(t?.baggageCheckedG)}" placeholder="e.g. 23">
          </div>
        </div>
        <div class="field-full">
          <label class="field-label">Notes</label>
          <input class="input" id="te-notes" value="${esc(t?.notes)}" placeholder="optional">
        </div>
      </div>
      <div class="rd-editor-btns">
        <button class="btn btn-ghost" data-ed="cancel">Cancel</button>
        <button class="btn btn-primary" data-ed="save">Save</button>
      </div>
    </div>`;
  host.appendChild(dlg);

  const close = () => dlg.remove();
  dlg.querySelector('[data-ed="cancel"]')!.addEventListener('click', close);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  dlg.querySelector('[data-ed="save"]')!.addEventListener('click', () => {
    const from = fieldVal(dlg, 'te-from');
    if (!from) { alert('Add where you\'re coming from.'); return; }
    const via = fieldVal(dlg, 'te-via').split(',').map((s) => s.trim()).filter(Boolean);
    const toG = (id: string) => { const v = parseFloat(fieldVal(dlg, id)); return v > 0 ? v * 1000 : undefined; };
    const priceNum = parseFloat(fieldVal(dlg, 'te-price'));
    const priceAmount = Number.isFinite(priceNum) && priceNum > 0 ? priceNum : undefined;
    const currency = fieldVal(dlg, 'te-currency') || defaultCur;
    const next: Transport = {
      type: fieldVal(dlg, 'te-type') as Transport['type'],
      from, to: leg.city, date: leg.dateFrom,
      ...(via.length ? { via } : {}),
      service: fieldVal(dlg, 'te-service') || undefined,
      bookingRef: t?.bookingRef,                 // preserved; no longer edited here
      time: fieldVal(dlg, 'te-time') || undefined,
      arrivalTime: fieldVal(dlg, 'te-arr-time') || undefined,
      depPlace: t?.depPlace,                     // preserved; no longer edited here
      arrPlace: t?.arrPlace,
      duration: fieldVal(dlg, 'te-duration') || undefined,
      priceAmount,
      priceCurrency: priceAmount != null ? currency : undefined,
      // Keep legacy text price in sync so older views still render something.
      price: priceAmount != null ? `${currencySymbol(currency)}${priceAmount}` : undefined,
      notes: fieldVal(dlg, 'te-notes') || undefined,
      confirmed: t?.confirmed ?? false,
      baggagePersonalG: toG('te-bag-personal'),
      baggageCarryOnG: toG('te-bag-carry'),
      baggageCheckedG: toG('te-bag-checked'),
      // Preserve the expense link across edits so re-syncing updates, not duplicates.
      expenseId: t?.expenseId,
    };
    const priceNewlyAdded = priceAmount != null && t?.priceAmount == null && !t?.expenseId;
    patchLeg(leg.id, { arrivalTransport: clean(next) });
    close();
    // If price was just entered for the first time (no prior priceAmount, no linked expense),
    // auto-open the sync dialog so the spend lands in Expenses without a separate click.
    if (priceNewlyAdded) {
      const syntheticLeg = { ...leg, arrivalTransport: next };
      onSyncNeeded(timeline, syntheticLeg as Leg);
    }
  });
}

export function openStayEditor(
  timeline: HTMLElement,
  leg: Leg,
  stayKey: string | null,
  _patchLeg: PatchFn,
  persistStaysFn: PersistStaysFn,
): void {
  const stays = legStays(leg);
  const existing = stayKey != null ? stays.find((s, i) => (s.id ?? String(i)) === stayKey) : undefined;
  // Currency defaults from the existing value, else the leg's country, else trip base.
  const defaultCur = existing?.priceCurrency ?? COUNTRY_CURRENCY[leg.country] ?? baseCurrency();
  const host = timeline.querySelector<HTMLElement>('.rd-shell')!;
  const dlg = document.createElement('div');
  dlg.className = 'rd-editor-overlay';
  dlg.innerHTML = `
    <div class="rd-editor">
      <div class="rd-editor-title">${existing ? 'Edit stay' : 'Add stay'} · ${esc(leg.city)}</div>
      <div class="rd-editor-grid">
        <div class="field-full">
          <label class="field-label">Name</label>
          <input class="input" id="se-name" value="${esc(existing?.name)}" placeholder="e.g. Generator Hostel">
        </div>
        <div>
          <label class="field-label">Check-in</label>
          <input class="input" type="date" id="se-in" value="${esc(existing?.checkIn)}">
        </div>
        <div>
          <label class="field-label">Check-out</label>
          <input class="input" type="date" id="se-out" value="${esc(existing?.checkOut)}">
        </div>
        <div>
          <label class="field-label">Price / night</label>
          <input class="input" id="se-price" type="number" min="0" step="0.01" inputmode="decimal"
                 value="${existing?.priceAmount ?? ''}" placeholder="e.g. 40">
        </div>
        <div>
          <label class="field-label">Currency</label>
          <select class="input select" id="se-currency">${stayCurrencyOptions(defaultCur)}</select>
        </div>
        <div>
          <label class="field-label">Booked on</label>
          <input class="input" id="se-platform" list="se-platform-list" value="${esc(existing?.platform)}" placeholder="e.g. Airbnb, Booking.com">
          <datalist id="se-platform-list">${STAY_PLATFORMS.map(p => `<option value="${esc(p)}">`).join('')}</datalist>
        </div>
        <div>
          <label class="field-label">Order link</label>
          <input class="input" id="se-booking" value="${esc(existing?.bookingUrl)}" placeholder="Jump back to the booking">
        </div>
        <div class="field-full">
          <label class="field-label">Google Maps link</label>
          <input class="input" id="se-map" value="${esc(existing?.mapUrl)}" placeholder="Paste a Maps link — or leave blank to search by name">
        </div>
        <div class="field-full">
          <label class="rd-check">
            <input type="checkbox" id="se-confirmed" ${existing?.confirmed ? 'checked' : ''}>
            Confirmed / booked
          </label>
        </div>
      </div>
      <div class="rd-editor-btns">
        <button class="btn btn-ghost" data-ed="cancel">Cancel</button>
        <button class="btn btn-primary" data-ed="save">Save</button>
      </div>
    </div>`;
  host.appendChild(dlg);

  const close = () => dlg.remove();
  dlg.querySelector('[data-ed="cancel"]')!.addEventListener('click', close);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  dlg.querySelector('[data-ed="save"]')!.addEventListener('click', () => {
    const name = fieldVal(dlg, 'se-name');
    if (!name) { alert('Add a name for the stay.'); return; }
    const priceNum = parseFloat(fieldVal(dlg, 'se-price'));
    const priceAmount = Number.isFinite(priceNum) && priceNum > 0 ? priceNum : undefined;
    const currency = fieldVal(dlg, 'se-currency') || defaultCur;
    const next: Accommodation = {
      id: existing?.id && existing.id !== 'legacy' ? existing.id : uid(),
      name,
      checkIn: fieldVal(dlg, 'se-in') || undefined,
      checkOut: fieldVal(dlg, 'se-out') || undefined,
      priceAmount,
      priceCurrency: priceAmount != null ? currency : undefined,
      // Keep the legacy text price in sync so older views still render something.
      price: priceAmount != null ? `${currencySymbol(currency)}${priceAmount}` : undefined,
      platform: fieldVal(dlg, 'se-platform') || undefined,
      bookingUrl: fieldVal(dlg, 'se-booking') || undefined,
      phone: existing?.phone,                    // preserved; no longer edited here
      mapUrl: fieldVal(dlg, 'se-map') || undefined,
      confirmed: (dlg.querySelector('#se-confirmed') as HTMLInputElement).checked,
      // Preserve the expense link across edits so re-syncing still updates, not duplicates.
      expenseId: existing?.expenseId,
    };
    const list = existing
      ? stays.map((s, i) => (s.id ?? String(i)) === stayKey ? next : s)
      : [...stays, next];
    persistStaysFn(leg, list);
    close();
  });
}

/**
 * Push a stay's cost into Expenses. The stay is keyed by check-in date but an
 * expense records when the money was spent — so we don't reuse check-in; the
 * dialog defaults the expense date to today (the typical "I just paid" moment)
 * and lets the user set the real payment date. Total defaults to per-night ×
 * nights. First sync creates the expense and stamps its id on the stay; later
 * syncs update that same expense so the books never double-count.
 */
export function openStaySyncDialog(
  timeline: HTMLElement,
  leg: Leg,
  stayKey: string,
  stay: Accommodation,
  _patchLeg: PatchFn,
  persistStaysFn: PersistStaysFn,
): void {
  const nights = stay.checkIn && stay.checkOut
    ? Math.max(1, daysBetween(stay.checkIn, stay.checkOut))
    : 1;
  const perNight = stay.priceAmount ?? 0;
  const total = +(perNight * nights).toFixed(2);
  const currency = stay.priceCurrency ?? COUNTRY_CURRENCY[leg.country] ?? baseCurrency();
  const today = new Date().toISOString().slice(0, 10);
  const synced = !!stay.expenseId;

  const host = timeline.querySelector<HTMLElement>('.rd-shell')!;
  const dlg = document.createElement('div');
  dlg.className = 'rd-editor-overlay';
  dlg.innerHTML = `
    <div class="rd-editor">
      <div class="rd-editor-title">${synced ? 'Update expense' : 'Log to Expenses'} · ${esc(stay.name)}</div>
      <p class="field-hint" style="margin:0 0 12px;color:var(--ink-faint);font-size:13px">
        ${esc(perNight.toString())} ${esc(currency)} / night × ${nights} night${nights > 1 ? 's' : ''} in ${esc(leg.city)}.
        ${synced ? 'This stay is already linked to an expense — saving updates it.' : 'Set the date you actually paid.'}
      </p>
      <div class="rd-editor-grid">
        <div>
          <label class="field-label">Total</label>
          <input class="input" id="sy-amount" type="number" min="0" step="0.01" inputmode="decimal" value="${total}">
        </div>
        <div>
          <label class="field-label">Currency</label>
          <select class="input select" id="sy-currency">${stayCurrencyOptions(currency)}</select>
        </div>
        <div class="field-full">
          <label class="field-label">Payment date</label>
          <input class="input" type="date" id="sy-date" value="${today}">
        </div>
      </div>
      <div class="rd-editor-btns">
        <button class="btn btn-ghost" data-ed="cancel">Cancel</button>
        <button class="btn btn-primary" data-ed="save">${synced ? 'Update' : 'Log expense'}</button>
      </div>
    </div>`;
  host.appendChild(dlg);

  const close = () => dlg.remove();
  dlg.querySelector('[data-ed="cancel"]')!.addEventListener('click', close);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  dlg.querySelector('[data-ed="save"]')!.addEventListener('click', async () => {
    const amount = parseFloat(fieldVal(dlg, 'sy-amount'));
    if (!Number.isFinite(amount) || amount <= 0) { alert('Enter a valid amount.'); return; }
    const cur = fieldVal(dlg, 'sy-currency') || currency;
    const date = fieldVal(dlg, 'sy-date') || today;
    // Live rates for an accurate snapshot; fall back to the cached table offline.
    let rates: RateTable = peekRateTable(baseCurrency());
    try { rates = await getRateTable(baseCurrency()); } catch { /* keep cached */ }
    const { rate, baseAmount } = convert(rates, amount, cur);
    const payload = {
      amount, currency: cur, rate, baseAmount,
      baseCurrency: baseCurrency(),
      description: stay.name,
      category: 'accommodation',
      tags: [],
      city: leg.city,
      country: leg.country,
      date,
    };

    // Update the linked expense if it still exists, else (re)create one.
    const linked = stay.expenseId && expenseStore.peek().some((e) => e.id === stay.expenseId);
    let expenseId = stay.expenseId;
    if (linked && expenseId) {
      await expenseStore.update(expenseId, payload);
    } else {
      expenseId = await expenseStore.add(payload);
    }

    // Stamp the expense id back on the stay so the next sync updates, not duplicates.
    const stays = legStays(leg);
    const list = stays.map((s, i) =>
      (s.id ?? String(i)) === stayKey ? { ...s, expenseId } : s);
    await persistStaysFn(leg, list);
    close();
  });
}

/**
 * Push a transport leg's fare into Expenses. Same model as the stay sync: the
 * expense date defaults to today (when you paid), not the travel date; first
 * sync stamps the expense id onto the transport so later syncs update rather
 * than duplicate. Category = transport.
 */
export function openTransportSyncDialog(
  timeline: HTMLElement,
  leg: Leg,
  patchLeg: PatchFn,
): void {
  const t = leg.arrivalTransport!;
  const amount0 = t.priceAmount ?? 0;
  const currency = t.priceCurrency ?? COUNTRY_CURRENCY[leg.country] ?? baseCurrency();
  const today = new Date().toISOString().slice(0, 10);
  const synced = !!t.expenseId;
  const desc = `${t.from} → ${t.to}${t.service ? ` (${t.service})` : ''}`;

  const host = timeline.querySelector<HTMLElement>('.rd-shell')!;
  const dlg = document.createElement('div');
  dlg.className = 'rd-editor-overlay';
  dlg.innerHTML = `
    <div class="rd-editor">
      <div class="rd-editor-title">${synced ? 'Update expense' : 'Log to Expenses'} · ${esc(desc)}</div>
      <p class="field-hint" style="margin:0 0 12px;color:var(--ink-faint);font-size:13px">
        ${esc(amount0.toString())} ${esc(currency)} for transport to ${esc(leg.city)}.
        ${synced ? 'Already linked to an expense — saving updates it.' : 'Set the date you actually paid.'}
      </p>
      <div class="rd-editor-grid">
        <div>
          <label class="field-label">Amount</label>
          <input class="input" id="ty-amount" type="number" min="0" step="0.01" inputmode="decimal" value="${amount0}">
        </div>
        <div>
          <label class="field-label">Currency</label>
          <select class="input select" id="ty-currency">${stayCurrencyOptions(currency)}</select>
        </div>
        <div class="field-full">
          <label class="field-label">Payment date</label>
          <input class="input" type="date" id="ty-date" value="${today}">
        </div>
      </div>
      <div class="rd-editor-btns">
        <button class="btn btn-ghost" data-ed="cancel">Cancel</button>
        <button class="btn btn-primary" data-ed="save">${synced ? 'Update' : 'Log expense'}</button>
      </div>
    </div>`;
  host.appendChild(dlg);

  const close = () => dlg.remove();
  dlg.querySelector('[data-ed="cancel"]')!.addEventListener('click', close);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  dlg.querySelector('[data-ed="save"]')!.addEventListener('click', async () => {
    const amount = parseFloat(fieldVal(dlg, 'ty-amount'));
    if (!Number.isFinite(amount) || amount <= 0) { alert('Enter a valid amount.'); return; }
    const cur = fieldVal(dlg, 'ty-currency') || currency;
    const date = fieldVal(dlg, 'ty-date') || today;
    let rates: RateTable = peekRateTable(baseCurrency());
    try { rates = await getRateTable(baseCurrency()); } catch { /* keep cached */ }
    const { rate, baseAmount } = convert(rates, amount, cur);
    const payload = {
      amount, currency: cur, rate, baseAmount,
      baseCurrency: baseCurrency(),
      description: desc,
      category: 'transport',
      tags: [],
      city: leg.city,
      country: leg.country,
      date,
    };

    const linked = t.expenseId && expenseStore.peek().some((e) => e.id === t.expenseId);
    let expenseId = t.expenseId;
    if (linked && expenseId) {
      await expenseStore.update(expenseId, payload);
    } else {
      expenseId = await expenseStore.add(payload);
    }
    patchLeg(leg.id, { arrivalTransport: clean({ ...t, expenseId }) });
    close();
  });
}
