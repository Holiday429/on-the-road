/* ==========================================================================
   On the Road · Custom currency manager
   --------------------------------------------------------------------------
   Lets a traveller add a currency the app doesn't ship (an obscure
   destination) with a manual rate, and remove ones they added. The live feed
   (frankfurter.app) only covers ~30 currencies, so a manual "1 XXX = N base"
   is the only way to price the rest. Entry point lives on the Expenses page.
   ========================================================================== */

import { openModal } from '../../core/modal.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { t } from '../../core/i18n.ts';
import { baseCurrency, customCurrencies, setCustomCurrency } from '../../data/trip-context.ts';
import { allCurrencies, currencyFlag } from '../../data/rates.ts';

/** Open the manager. `onChange` fires after any add/remove so the caller can
 *  re-render its currency pickers and rate-dependent numbers. */
export function openCurrencyManager(onChange: () => void): void {
  const base = baseCurrency();

  const listHtml = () => {
    const rows = Object.entries(customCurrencies()).map(([code, c]) => `
      <div class="cm-row">
        <span class="cm-flag">${esc(c.flag || '💱')}</span>
        <span class="cm-code">${esc(code)}</span>
        <span class="cm-sym">${esc(c.symbol)}</span>
        <span class="cm-rate">${c.manualRate ? `1 = ${c.manualRate} ${esc(c.rateBase ?? base)}` : '—'}</span>
        <button class="cm-del" type="button" data-cm-del="${esc(code)}" title="${esc(t('currency.remove'))}">✕</button>
      </div>`).join('');
    return rows || `<div class="cm-empty">${esc(t('currency.noneYet'))}</div>`;
  };

  const handle = openModal({
    title: t('currency.addTitle'),
    body: `
      <div class="cm-body">
        <p class="cm-hint">${esc(t('currency.hint'))}</p>
        <div class="cm-grid">
          <label class="cm-field"><span>${esc(t('currency.code'))}</span>
            <input class="input" id="cm-code" maxlength="5" placeholder="MNT" autocapitalize="characters"></label>
          <label class="cm-field"><span>${esc(t('currency.symbol'))}</span>
            <input class="input" id="cm-symbol" maxlength="5" placeholder="₮"></label>
          <label class="cm-field"><span>${esc(t('currency.flag'))}</span>
            <input class="input" id="cm-flag" maxlength="4" placeholder="🇲🇳"></label>
        </div>
        <label class="cm-field cm-rate-field">
          <span>${esc(t('currency.rateLabel'))}</span>
          <div class="cm-rate-row">1 <b id="cm-rate-code">…</b> =
            <input class="input" id="cm-rate" type="number" min="0" step="any" placeholder="0.0003">
            <b>${esc(base)}</b></div>
        </label>
        <div class="cm-error" id="cm-error" hidden></div>
        <div class="cm-list" id="cm-list">${listHtml()}</div>
      </div>`,
    footer: `<button class="btn btn-ghost" data-act="close">${esc(t('currency.close'))}</button>
             <button class="btn btn-primary" data-act="add">${esc(t('currency.add'))}</button>`,
  });
  const root = handle.root;
  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;

  const refreshList = () => { q('#cm-list').innerHTML = listHtml(); wireDeletes(); };
  const fail = (msg: string) => { const e = q('#cm-error'); e.textContent = msg; e.hidden = false; };

  q<HTMLInputElement>('#cm-code').addEventListener('input', (ev) => {
    const el = ev.target as HTMLInputElement;
    el.value = el.value.toUpperCase().replace(/[^A-Z]/g, '');
    q('#cm-rate-code').textContent = el.value || '…';
  });

  function wireDeletes() {
    root.querySelectorAll<HTMLButtonElement>('[data-cm-del]').forEach((b) => {
      b.addEventListener('click', async () => {
        await setCustomCurrency(b.dataset.cmDel!, null);
        refreshList();
        onChange();
      });
    });
  }
  wireDeletes();

  root.querySelector('[data-act="close"]')?.addEventListener('click', () => handle.close());
  root.querySelector('[data-act="add"]')?.addEventListener('click', async () => {
    const code = q<HTMLInputElement>('#cm-code').value.trim().toUpperCase();
    const symbol = q<HTMLInputElement>('#cm-symbol').value.trim() || code;
    const flag = q<HTMLInputElement>('#cm-flag').value.trim();
    const rate = parseFloat(q<HTMLInputElement>('#cm-rate').value);
    if (!/^[A-Z]{3,5}$/.test(code)) return fail(t('currency.errCode'));
    if (allCurrencies().some((c) => c.code === code) && !customCurrencies()[code]) {
      return fail(t('currency.errExists', { code }));
    }
    if (!Number.isFinite(rate) || rate <= 0) return fail(t('currency.errRate'));
    await setCustomCurrency(code, { symbol, flag: flag || currencyFlag(code) || undefined, manualRate: rate, rateBase: base });
    ['#cm-code', '#cm-symbol', '#cm-flag', '#cm-rate'].forEach((s) => { q<HTMLInputElement>(s).value = ''; });
    q('#cm-rate-code').textContent = '…';
    q('#cm-error').hidden = true;
    refreshList();
    onChange();
  });
}
