/* ==========================================================================
   On the Road · Expenses — per-item editor
   --------------------------------------------------------------------------
   The overlay behind a record tag in "All records" (mirrors the route plan-item
   editors). Split out of expenses.ts, which has a line cap; everything it needs
   from that module's state is passed in.
   ========================================================================== */

import { escHtml } from '../../core/utils.ts';
import { openModal } from '../../core/modal.ts';
import { expenseStore, type StoredExpense } from '../../data/stores/expense-store.ts';
import { baseCurrency } from '../../data/trip-context.ts';
import type { RateTable } from '../../data/rates.ts';
import { convert } from './expense-defaults.ts';
import type { Category } from './expense-helpers.ts';

export interface EditorDeps {
  expenses: StoredExpense[];
  rates: RateTable;
  categories(): Category[];
  currencyOptions(selected: string): string;
  countryOptions(selected: string): string;
  cityOptions(country: string, selected: string): string;
  deleteExpense(id: string): void;
  WHOLE_TRIP: string;
  CUSTOM_PLACE: string;
}

export function openExpenseEditor(id: string, d: EditorDeps): void {
  const { expenses, rates, categories, currencyOptions, countryOptions, cityOptions, deleteExpense, WHOLE_TRIP, CUSTOM_PLACE } = d;
  const e = expenses.find((x) => x.id === id);
  if (!e) return;

  const editorCountry = e.country || WHOLE_TRIP;
  const editorCityOpts = cityOptions(e.country, e.city);

  const m = openModal({
    title: 'Edit expense',
    className: 'exp-editor-modal',
    body: `
      <div class="exp-cat-chips exp-editor-cats" id="exp-edit-cats">
        ${categories().map((c) => `
          <button class="exp-cat-chip ${c.id === e.category ? 'selected' : ''}" data-cat="${escHtml(c.id)}">${escHtml(c.icon)} ${escHtml(c.label)}</button>
        `).join('')}
      </div>
      <div class="exp-editor-grid">
        <div>
          <label class="field-label">Amount</label>
          <input class="input" type="number" id="ee-amount" min="0" step="0.01" value="${e.amount}">
        </div>
        <div>
          <label class="field-label">Currency</label>
          <select class="input select" id="ee-currency">${currencyOptions(e.currency)}</select>
        </div>
        <div class="field-full">
          <label class="field-label">What for?</label>
          <input class="input" id="ee-desc" value="${escHtml(e.description)}">
        </div>
        <div class="field-full">
          <label class="field-label">Tags <span style="font-weight:400;color:var(--ink-faint)">(comma-separated, e.g. #ramen, souvenir)</span></label>
          <input class="input" id="ee-tags" placeholder="e.g. #ramen, business" value="${escHtml((e.tags ?? []).join(', '))}">
        </div>
        <div>
          <label class="field-label">Country</label>
          <select class="input select" id="ee-country">${countryOptions(editorCountry)}</select>
        </div>
        <div id="ee-city-wrap">${editorCityOpts ? `
          <label class="field-label">City</label>
          <select class="input select" id="ee-city">${editorCityOpts}</select>` : ''}
        </div>
        <div class="field-full">
          <label class="field-label">Date</label>
          <input class="input" type="date" id="ee-date" value="${e.date}">
        </div>
      </div>`,
    footer: `
      <button class="btn btn-danger" data-act="delete">Delete</button>
      <button class="btn btn-primary" data-act="save">Save</button>`,
  });

  let editCat = e.category;
  m.root.querySelectorAll<HTMLElement>('#exp-edit-cats .exp-cat-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      editCat = btn.dataset.cat!;
      m.root.querySelectorAll('#exp-edit-cats .exp-cat-chip').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  const countrySel = m.root.querySelector('#ee-country') as HTMLSelectElement;
  const cityWrap = m.root.querySelector('#ee-city-wrap') as HTMLElement;
  let editCountry = e.country;
  let editCity = e.city;

  function refreshEditorCity() {
    const opts = cityOptions(editCountry, editCity);
    // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N5)
    cityWrap.innerHTML = opts ? `
      <label class="field-label">City</label>
      <select class="input select" id="ee-city">${opts}</select>` : '';
    cityWrap.querySelector('#ee-city')?.addEventListener('change', (ev) => {
      const val = (ev.target as HTMLSelectElement).value;
      if (val === CUSTOM_PLACE) {
        editCity = prompt('City name?')?.trim() || '';
        refreshEditorCity();
      } else {
        editCity = val;
      }
    });
  }

  countrySel.addEventListener('change', () => {
    if (countrySel.value === CUSTOM_PLACE) {
      editCountry = prompt('Country name?')?.trim() || '';
    } else if (countrySel.value === WHOLE_TRIP) {
      editCountry = '';
    } else {
      editCountry = countrySel.value;
    }
    editCity = '';
    refreshEditorCity();
  });

  // Wire initial city select if present
  cityWrap.querySelector('#ee-city')?.addEventListener('change', (ev) => {
    const val = (ev.target as HTMLSelectElement).value;
    if (val === CUSTOM_PLACE) {
      editCity = prompt('City name?')?.trim() || '';
      refreshEditorCity();
    } else {
      editCity = val;
    }
  });

  m.root.querySelector('[data-act="save"]')?.addEventListener('click', async () => {
    const amount = parseFloat((m.root.querySelector('#ee-amount') as HTMLInputElement).value);
    const currency = (m.root.querySelector('#ee-currency') as HTMLSelectElement).value;
    const desc = (m.root.querySelector('#ee-desc') as HTMLInputElement).value.trim();
    const date = (m.root.querySelector('#ee-date') as HTMLInputElement).value;
    const tagsRaw = (m.root.querySelector('#ee-tags') as HTMLInputElement).value;
    const tags = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean);
    if (!amount || !desc) return;
    const { rate, baseAmount } = convert(rates, amount, currency);
    await expenseStore.update(id, {
      amount, currency, rate, baseAmount, baseCurrency: baseCurrency(),
      description: desc, category: editCat, country: editCountry, city: editCity, date, tags,
    });
    m.close();
  });

  m.root.querySelector('[data-act="delete"]')?.addEventListener('click', () => {
    deleteExpense(id);
    m.close();
  });
}
