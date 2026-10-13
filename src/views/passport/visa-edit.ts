/* ==========================================================================
   On the Road · Passport — adding and editing a visa
   --------------------------------------------------------------------------
   A drawer over the book. A visa can be for any country, or for the whole
   Schengen Area; nothing is looked up or required beyond where it is for.
   ========================================================================== */

import { openDrawer, closeDrawer } from '../../core/drawer.ts';
import { t, getLocale } from '../../core/i18n.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { KNOWN_ISOS } from '../../data/geo-index.ts';
import { SCHENGEN_REGION, regionFlag, regionLabel } from '../../data/visa.ts';
import { VISA_ENTRIES, type Visa } from '../../data/schema/visa.ts';
import { visaStore } from '../../data/stores/visa-store.ts';

/** Schengen first, then every country by its name in the reader's language. */
export function regionOptions(locale: string, schengenLabel: string): Array<{ value: string; label: string }> {
  const rest = KNOWN_ISOS.map((iso) => ({ value: iso, label: regionLabel(iso, locale, schengenLabel) }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
  return [{ value: SCHENGEN_REGION, label: schengenLabel }, ...rest];
}

const TYPES = ['tourist', 'business', 'work', 'student', 'transit', 'other'] as const;

export function openVisaEditor(existing: Visa | null): void {
  const schengen = t('passport.visa.schengen');
  const options = regionOptions(getLocale(), schengen).map((o) =>
    `<option value="${esc(o.value)}"${o.value === (existing?.region ?? SCHENGEN_REGION) ? ' selected' : ''}>${regionFlag(o.value)} ${esc(o.label)}</option>`).join('');
  const typeList = TYPES.map((k) => t(`passport.visa.type.${k}`));
  const field = (label: string, inner: string) => `<label class="pp-edit-field"><span>${esc(label)}</span>${inner}</label>`;
  const body = `<form class="pp-edit" data-visa-form autocomplete="off">
    ${field(t('passport.visa.region'), `<select name="region">${options}</select>`)}
    ${field(t('passport.visa.typeLabel'), `<input name="type" list="pp-visa-types" value="${esc(existing?.type ?? '')}" maxlength="30"><datalist id="pp-visa-types">${typeList.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>`)}
    <div class="pp-edit-grid">
      ${field(t('passport.visa.validFrom'), `<input name="validFrom" type="date" value="${esc(existing?.validFrom ?? '')}">`)}
      ${field(t('passport.visa.validTo'), `<input name="validTo" type="date" value="${esc(existing?.validTo ?? '')}">`)}
      ${field(t('passport.visa.stayDays'), `<input name="stayDays" type="number" min="1" max="3650" value="${existing?.stayDays ?? ''}">`)}
    </div>
    ${field(t('passport.visa.entries'), `<select name="entries"><option value=""></option>${VISA_ENTRIES.map((e) => `<option value="${e}"${existing?.entries === e ? ' selected' : ''}>${esc(t(`passport.visa.entries.${e}`))}</option>`).join('')}</select>`)}
    ${field(t('passport.visa.number'), `<input name="number" value="${esc(existing?.number ?? '')}" maxlength="40">`)}
    ${field(t('passport.visa.notes'), `<input name="notes" value="${esc(existing?.notes ?? '')}" maxlength="200">`)}
    <p class="pp-doc-hint">${esc(t('passport.visa.hint'))}</p>
  </form>`;
  const dr = openDrawer({
    title: t(existing ? 'passport.visa.edit' : 'passport.visa.add'),
    body,
    footer: `<button type="button" class="btn btn-primary" data-visa-save>${esc(t('common.save'))}</button>
      <button type="button" class="btn btn-ghost" data-visa-cancel>${esc(t('common.cancel'))}</button>
      ${existing ? `<button type="button" class="btn btn-ghost pp-danger" data-visa-delete>${esc(t('common.delete'))}</button>` : ''}`,
    className: 'pp-edit-drawer',
  });
  const root = dr.root;
  const val = (n: string) => (root.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${n}"]`)?.value ?? '').trim();
  root.querySelector('[data-visa-cancel]')!.addEventListener('click', () => closeDrawer());
  root.querySelector('[data-visa-delete]')?.addEventListener('click', async () => {
    if (!existing) return;
    await visaStore.remove(existing.id);
    closeDrawer();
  });
  root.querySelector<HTMLButtonElement>('[data-visa-save]')!.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const from = val('validFrom');
    const to = val('validTo');
    // A visa that ends before it starts is a typo, not a visa.
    if (from && to && to < from) { root.querySelector<HTMLInputElement>('[name="validTo"]')?.focus(); return; }
    btn.disabled = true;
    try {
      const days = Number(val('stayDays'));
      await visaStore.set({
        ...(existing ? { id: existing.id } : {}),
        region: val('region') || SCHENGEN_REGION, type: val('type'), number: val('number'), notes: val('notes'),
        validFrom: from, validTo: to, entries: (val('entries') || undefined) as Visa['entries'],
        stayDays: Number.isFinite(days) && days >= 1 ? Math.round(days) : undefined,
      });
      closeDrawer();
    } catch { btn.disabled = false; }
  });
}
