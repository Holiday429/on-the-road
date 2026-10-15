/* ==========================================================================
   On the Road · Passport — editing the data page
   --------------------------------------------------------------------------
   A drawer over the book. Everything is optional and nothing has to be real:
   a nickname, a nationality, an occupation, a photo, a hand-drawn signature.
   Below, the document details (name, number, birth date, sex, dates) the
   traveller can use to look things up while filling forms; they live in their
   own document, stay masked until asked, and are checked against upcoming
   trips for expiry. Name, number and birth date each carry a switch: shown on
   the data page, or kept off it (the page then shows dots). Nothing here is
   exported, shared or sent anywhere.
   ========================================================================== */

import { openDrawer, closeDrawer } from '../../core/drawer.ts';
import { t } from '../../core/i18n.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { NATIONALITIES } from '../../data/nationalities.ts';
import { passportDocStore, passportStore } from '../../data/stores/passport-store.ts';
import { listTrips } from '../../data/trip-context.ts';
import { todayIso } from '../../data/trip-phase.ts';
import { docWarnings } from '../../data/passport-state.ts';
import { uploadPassportPhoto } from '../../firebase/storage.ts';
import { maskNumber } from './bio.ts';
import { toast } from '../journal/recap/export/ui.ts';
import { isSafePath, signaturePath, SIG_H, SIG_W, type Pt } from './signature.ts';

const input = (name: string, label: string, value: string, extra = '') =>
  `<label class="pp-edit-field"><span>${esc(label)}</span><input name="${name}" value="${esc(value)}" autocomplete="off" ${extra}></label>`;

/** A text field with the switch that puts its value on the data page (or leaves it as dots). */
const showSwitch = (name: string, on: boolean) =>
  `<label class="pp-show"><input type="checkbox" name="${name}"${on ? ' checked' : ''}><span>${esc(t('passport.edit.showOnPage'))}</span></label>`;

export interface BioDefaults {
  nickname: string;
  nationality: string;
}

export function openBioEditor(def: BioDefaults, onSaved: () => void): void {
  const p = passportStore.peek();
  const d = passportDocStore.peek();
  let photo = p?.photoURL ?? '';
  let signature = p?.signature && isSafePath(p.signature) ? p.signature : '';
  let strokes: Pt[][] = [];
  let sigChanged = false;

  const nat = p?.nationality ?? '';
  const natOptions = [`<option value="">${esc(t('passport.edit.natAuto'))}</option>`]
    .concat(NATIONALITIES.map((n) => `<option value="${n.code}"${n.code === nat ? ' selected' : ''}>${n.flag} ${esc(n.label)}</option>`)).join('');

  const body = `
    <form class="pp-edit" data-pp-form autocomplete="off">
      <div class="pp-edit-photo">
        <div class="pp-edit-photo-img" data-photo>${photo ? `<img src="${esc(photo)}" alt="" referrerpolicy="no-referrer">` : '<span>🙂</span>'}</div>
        <div class="pp-edit-photo-btns">
          <label class="btn btn-ghost">${esc(t('passport.edit.photoUpload'))}<input type="file" accept="image/*" hidden data-photo-file></label>
          <button type="button" class="btn btn-ghost" data-photo-clear>${esc(t('passport.edit.photoClear'))}</button>
        </div>
      </div>
      ${input('nickname', t('passport.bio.nickname'), p?.nickname ?? '', `placeholder="${esc(def.nickname)}" maxlength="24"`)}
      <label class="pp-edit-field"><span>${esc(t('passport.bio.nationality'))}</span><select name="nationality">${natOptions}</select></label>
      ${input('occupation', t('passport.bio.occupation'), p?.occupation ?? '', `placeholder="${esc(t('passport.bio.traveller'))}" maxlength="30"`)}
      <div class="pp-edit-field">
        <span>${esc(t('passport.bio.signature'))}</span>
        <div class="pp-sigpad"><canvas width="${SIG_W * 2}" height="${SIG_H * 2}" data-sig aria-label="${esc(t('passport.edit.sigHint'))}"></canvas>
          ${signature ? `<svg class="pp-sig-old" viewBox="0 0 ${SIG_W} ${SIG_H}" aria-hidden="true"><path d="${esc(signature)}"/></svg>` : ''}
        </div>
        <div class="pp-edit-row"><small>${esc(t('passport.edit.sigHint'))}</small><button type="button" class="btn btn-ghost" data-sig-clear>${esc(t('passport.edit.sigClear'))}</button></div>
      </div>

      <details class="pp-doc" open>
        <summary>${esc(t('passport.doc.title'))}</summary>
        <p class="pp-doc-hint">${esc(t('passport.doc.hint'))}</p>
        <div class="pp-edit-field">
          <span>${esc(t('passport.doc.fullName'))}</span>
          <div class="pp-edit-row"><input name="fullName" value="${esc(d?.fullName ?? '')}" autocomplete="off">${showSwitch('showFullName', !!d?.showFullName)}</div>
        </div>
        <div class="pp-edit-field pp-doc-number">
          <span>${esc(t('passport.doc.number'))}</span>
          <div class="pp-edit-row">
            <input name="number" value="${esc(d?.number ?? '')}" autocomplete="off" data-masked data-real="${esc(d?.number ?? '')}">
            <button type="button" class="btn btn-ghost" data-doc-show>${esc(t(d?.number ? 'passport.doc.show' : 'passport.doc.hide'))}</button>
            <button type="button" class="btn btn-ghost" data-doc-copy>${esc(t('passport.doc.copy'))}</button>
          </div>
          ${showSwitch('showNumber', !!d?.showNumber)}
        </div>
        <div class="pp-edit-field">
          <span>${esc(t('passport.doc.birth'))}</span>
          <div class="pp-edit-row"><input name="birthDate" type="date" value="${esc(d?.birthDate ?? '')}">${showSwitch('showBirth', !!d?.showBirth)}</div>
        </div>
        <label class="pp-edit-field"><span>${esc(t('passport.bio.sex'))}</span>
          <select name="gender">${(['', 'F', 'M', 'X'] as const).map((g) => `<option value="${g}"${g === (d?.gender ?? '') ? ' selected' : ''}>${esc(g ? t(`passport.doc.sex.${g}`) : '—')}</option>`).join('')}</select>
        </label>
        <div class="pp-edit-grid is-two">
          ${input('issued', t('passport.doc.issued'), d?.issued ?? '', 'type="date"')}
          ${input('expires', t('passport.doc.expires'), d?.expires ?? '', 'type="date"')}
        </div>
        ${input('issuingCountry', t('passport.doc.issuingCountry'), d?.issuingCountry ?? '')}
        <div class="pp-doc-warn" data-doc-warn></div>
      </details>
    </form>`;

  const dr = openDrawer({
    title: t('passport.edit.title'),
    body,
    footer: `<button type="button" class="btn btn-primary" data-pp-save>${esc(t('common.save'))}</button>
      <button type="button" class="btn btn-ghost" data-pp-cancel>${esc(t('common.cancel'))}</button>`,
    className: 'pp-edit-drawer',
  });
  const root = dr.root;
  const q = <E extends HTMLElement>(s: string) => root.querySelector<E>(s)!;
  const field = (name: string) => root.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!;

  /* Photo */
  q('[data-photo-file]').addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const box = q('[data-photo]');
    box.classList.add('is-busy');
    try {
      photo = await uploadPassportPhoto(f);
      // eslint-disable-next-line no-restricted-syntax -- audited: url escaped
      box.innerHTML = `<img src="${esc(photo)}" alt="" referrerpolicy="no-referrer">`;
    } catch { box.classList.add('is-error'); } finally { box.classList.remove('is-busy'); }
  });
  q('[data-photo-clear]').addEventListener('click', () => {
    photo = '';
    q('[data-photo]').replaceChildren(Object.assign(document.createElement('span'), { textContent: '🙂' }));
  });

  /* Signature pad */
  const cv = q<HTMLCanvasElement>('[data-sig]');
  const g = cv.getContext('2d');
  const ink = () => getComputedStyle(root).getPropertyValue('--ink').trim() || '#222';
  const at = (e: PointerEvent): Pt => {
    const r = cv.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * SIG_W, ((e.clientY - r.top) / r.height) * SIG_H];
  };
  let cur: Pt[] | null = null;
  cv.addEventListener('pointerdown', (e) => {
    cur = [at(e)]; strokes.push(cur); cv.setPointerCapture(e.pointerId); sigChanged = true;
    root.querySelector('.pp-sig-old')?.remove();
    if (g) { g.strokeStyle = ink(); g.lineWidth = 3.4; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(cur[0][0] * 2, cur[0][1] * 2); }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!cur) return;
    const pt = at(e); cur.push(pt);
    if (g) { g.lineTo(pt[0] * 2, pt[1] * 2); g.stroke(); }
  });
  const end = () => { cur = null; };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  q('[data-sig-clear]').addEventListener('click', () => {
    strokes = []; sigChanged = true; signature = '';
    g?.clearRect(0, 0, cv.width, cv.height);
    root.querySelector('.pp-sig-old')?.remove();
  });

  /* Document number: masked until asked */
  const num = field('number') as HTMLInputElement;
  let shown = !(d?.number);                      // nothing saved yet: type straight away
  const paintNum = () => { num.value = shown ? num.dataset.real ?? '' : maskNumber(num.dataset.real ?? ''); num.readOnly = !shown; };
  paintNum();
  num.addEventListener('input', () => { if (shown) num.dataset.real = num.value; });
  q('[data-doc-show]').addEventListener('click', (e) => {
    shown = !shown; paintNum();
    (e.currentTarget as HTMLElement).textContent = t(shown ? 'passport.doc.hide' : 'passport.doc.show');
  });
  q('[data-doc-copy]').addEventListener('click', async (e) => {
    const b = e.currentTarget as HTMLElement;
    try { await navigator.clipboard.writeText(num.dataset.real ?? ''); b.textContent = t('passport.doc.copied'); } catch { /* clipboard blocked: nothing to say */ }
    window.setTimeout(() => { b.textContent = t('passport.doc.copy'); }, 1500);
  });

  /* Expiry check against trips */
  const warn = q('[data-doc-warn]');
  const checkExpiry = async () => {
    const expires = (field('expires') as HTMLInputElement).value;
    let trips: Awaited<ReturnType<typeof listTrips>> = [];
    try { trips = await listTrips(); } catch { /* no trips to check */ }
    const w = docWarnings(expires, trips, todayIso());
    // eslint-disable-next-line no-restricted-syntax -- audited: trip names and dates escaped
    warn.innerHTML = w.map((x) => `<div>⚠ ${esc(t(`passport.doc.warn.${x.kind}`, { trip: x.tripName, date: x.expires }))}</div>`).join('');
  };
  field('expires').addEventListener('change', () => { void checkExpiry(); });
  void checkExpiry();

  /* Save */
  q('[data-pp-cancel]').addEventListener('click', () => closeDrawer());
  q('[data-pp-save]').addEventListener('click', async () => {
    const val = (n: string) => (field(n).value ?? '').trim();
    const btn = q<HTMLButtonElement>('[data-pp-save]');
    btn.disabled = true;
    // Firestore resolves a write only once the server has it, so "saved" below means "in the account". A dead
    // connection would wait forever; give it a way out (the write stays queued and goes through when back online).
    const reached = <T,>(p: Promise<T>): Promise<T> => Promise.race([p, new Promise<never>((_, no) => window.setTimeout(() => no(new Error('timeout')), 15000))]);
    try {
      await reached(passportStore.save({
        nickname: val('nickname'), nationality: val('nationality'), occupation: val('occupation'), photoURL: photo,
        signature: sigChanged ? signaturePath(strokes) : signature,
      }));
      const hasDoc = ['fullName', 'issuingCountry', 'issued', 'expires', 'birthDate', 'gender'].some((n) => val(n)) || !!num.dataset.real;
      if (hasDoc || passportDocStore.peek()) {
        const on = (n: string) => (field(n) as HTMLInputElement).checked;
        const gender = val('gender');
        await reached(passportDocStore.save({
          fullName: val('fullName'), number: (num.dataset.real ?? '').trim(), issuingCountry: val('issuingCountry'),
          issued: val('issued'), expires: val('expires'), birthDate: val('birthDate'),
          gender: gender === 'F' || gender === 'M' || gender === 'X' ? gender : '',
          showFullName: on('showFullName'), showNumber: on('showNumber'), showBirth: on('showBirth'),
        }));
      }
      closeDrawer();
      onSaved();
      toast(t('passport.edit.saved'));
    } catch (err) {
      // A write that did not reach the account must say so: the drawer stays open with everything typed in it.
      console.error('Passport save failed:', err);
      toast(t('passport.edit.saveFailed'));
      btn.disabled = false;
    }
  });
}
