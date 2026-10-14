/* ==========================================================================
   On the Road · Passport — dress the booklet
   --------------------------------------------------------------------------
   A panel that slides in from the left while the book moves over: a live
   miniature of the cover, then colour, material, foil, emblem and a title
   line. Every change is reported at once (the book repaints under it) and the
   caller decides when to save. The choices are neutral by design — real
   booklets differ in colour from country to country, so no colour is "the"
   passport, and no national emblem is on offer.
   ========================================================================== */

import { t } from '../../core/i18n.ts';
import { escHtml as esc } from '../../core/utils.ts';
import {
  COVER_EMBLEMS, COVER_FOILS, COVER_MATERIALS, COVER_SWATCHES, DEFAULT_COVER, FOIL_COLOR, TITLE_MAX, coverStyle, normalizeCover,
} from '../../data/passport-cover.ts';
import type { PassportCover } from '../../data/schema.ts';
import { emblemSvg } from './pages.ts';

export interface PanelActions {
  /** Called with the new cover after every change. */
  onChange: (c: PassportCover) => void;
  onClose: () => void;
}

export interface PanelHandle {
  el: HTMLElement;
  scrim: HTMLElement;
  close(): void;
}

function html(c: PassportCover): string {
  const on = (cond: boolean) => (cond ? ' is-on' : '');
  const chip = (attr: string, value: string, label: string, active: boolean, extra = '') =>
    `<button type="button" class="pp-chip${on(active)}" data-${attr}="${esc(value)}" aria-pressed="${active}"${extra}>${esc(label)}</button>`;
  return `<header class="pp-drawer-head">
      <h2 class="pp-drawer-title">${esc(t('passport.cover.panel'))}</h2>
      <div class="pp-drawer-btns"><button type="button" class="pp-round is-close" data-pp-panel-close aria-label="${esc(t('common.close'))}">✕</button></div>
    </header>
    <div class="pp-drawer-body">
      <div class="pp-mini-wrap"><div class="pp-mini-cover" data-pp-mini style="${esc(coverStyle(c))}">${miniHtml(c)}</div></div>

      <section class="pp-opt"><h3 class="pp-drawer-h">${esc(t('passport.cover.colour'))}</h3>
        <div class="pp-swatches">${COVER_SWATCHES.map((s) =>
    `<button type="button" class="pp-swatch${on(c.color === s.color)}" data-pp-color="${s.color}" style="--sw:${s.color}" aria-label="${esc(t(`passport.cover.swatch.${s.id}`))}" aria-pressed="${c.color === s.color}"></button>`).join('')}</div>
        <label class="pp-custom"><input type="color" value="${esc(c.color)}" data-pp-color-input aria-label="${esc(t('passport.cover.custom'))}"><span>${esc(t('passport.cover.custom'))}</span></label>
      </section>

      <section class="pp-opt"><h3 class="pp-drawer-h">${esc(t('passport.cover.material'))}</h3>
        <div class="pp-chips">${COVER_MATERIALS.map((m) => chip('pp-material', m, t(`passport.cover.material.${m}`), c.material === m)).join('')}</div></section>

      <section class="pp-opt"><h3 class="pp-drawer-h">${esc(t('passport.cover.foil'))}</h3>
        <div class="pp-chips">${COVER_FOILS.map((f) => chip('pp-foil', f, t(`passport.cover.foil.${f}`), c.foil === f,
    ` style="--dot:${FOIL_COLOR[f]}"`)).join('')}</div></section>

      <section class="pp-opt"><h3 class="pp-drawer-h">${esc(t('passport.cover.emblem'))}</h3>
        <div class="pp-chips">${COVER_EMBLEMS.map((e) => chip('pp-emblem-pick', e, t(`passport.cover.emblem.${e}`), c.emblem === e)).join('')}</div>
        <p class="pp-opt-note">${esc(t('passport.cover.emblemNote'))}</p></section>

      <section class="pp-opt"><h3 class="pp-drawer-h">${esc(t('passport.cover.titleLine'))}</h3>
        <input type="text" class="pp-title-input" maxlength="${TITLE_MAX}" value="${esc(c.title)}" placeholder="${esc(t('passport.cover.title'))}" data-pp-title aria-label="${esc(t('passport.cover.titleLine'))}"></section>

      <button type="button" class="btn btn-ghost pp-panel-reset" data-pp-reset>${esc(t('passport.cover.reset'))}</button>
    </div>`;
}

function miniHtml(c: PassportCover): string {
  return `<div class="pp-mini-frame">${emblemSvg(c.emblem)}<span class="pp-mini-title">${esc(c.title || t('passport.cover.title'))}</span></div>`;
}

/** Opens the panel inside `host` (the desk). */
export function openCoverPanel(host: HTMLElement, start: PassportCover, a: PanelActions): PanelHandle {
  let cover = normalizeCover(start);
  const scrim = document.createElement('div');
  scrim.className = 'pp-drawer-scrim is-left';
  scrim.setAttribute('data-no-turn', '');
  const el = document.createElement('aside');
  el.className = 'pp-drawer pp-panel is-left';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', t('passport.cover.panel'));
  el.setAttribute('data-no-turn', '');
  // eslint-disable-next-line no-restricted-syntax -- audited: html() escapes every interpolation
  el.innerHTML = html(cover);
  host.append(scrim, el);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    el.classList.add('is-leaving');
    scrim.classList.add('is-leaving');
    window.setTimeout(() => { el.remove(); scrim.remove(); }, 260);
    a.onClose();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    // Typing a title must not turn the book's pages.
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') e.stopPropagation();
  };
  document.addEventListener('keydown', onKey, true);

  /** Repaints the miniature and the pressed states without rebuilding the panel (the title input keeps focus). */
  const sync = () => {
    const mini = el.querySelector<HTMLElement>('[data-pp-mini]');
    if (mini) { mini.setAttribute('style', coverStyle(cover)); mini.innerHTML = miniHtml(cover); }   // eslint-disable-line no-restricted-syntax -- audited: miniHtml escapes
    const mark = (sel: string, attr: string, value: string) => el.querySelectorAll<HTMLElement>(sel).forEach((b) => {
      const onNow = b.getAttribute(attr) === value;
      b.classList.toggle('is-on', onNow);
      b.setAttribute('aria-pressed', String(onNow));
    });
    mark('[data-pp-color]', 'data-pp-color', cover.color);
    mark('[data-pp-material]', 'data-pp-material', cover.material);
    mark('[data-pp-foil]', 'data-pp-foil', cover.foil);
    mark('[data-pp-emblem-pick]', 'data-pp-emblem-pick', cover.emblem);
    const input = el.querySelector<HTMLInputElement>('[data-pp-color-input]');
    if (input && input.value !== cover.color) input.value = cover.color;
  };
  const set = (patch: Partial<PassportCover>) => {
    cover = normalizeCover({ ...cover, ...patch });
    sync();
    a.onChange(cover);
  };

  el.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-pp-panel-close]')) { close(); return; }
    const pick = (attr: string) => target.closest<HTMLElement>(`[${attr}]`)?.getAttribute(attr);
    const color = pick('data-pp-color'); if (color) { set({ color }); return; }
    const material = pick('data-pp-material'); if (material) { set({ material: material as PassportCover['material'] }); return; }
    const foil = pick('data-pp-foil'); if (foil) { set({ foil: foil as PassportCover['foil'] }); return; }
    const emblem = pick('data-pp-emblem-pick'); if (emblem) { set({ emblem: emblem as PassportCover['emblem'] }); return; }
    if (target.closest('[data-pp-reset]')) { cover = { ...DEFAULT_COVER }; sync(); const ti = el.querySelector<HTMLInputElement>('[data-pp-title]'); if (ti) ti.value = ''; a.onChange(cover); }
  });
  el.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.matches('[data-pp-color-input]')) set({ color: target.value });
    else if (target.matches('[data-pp-title]')) set({ title: target.value });
  });
  scrim.addEventListener('click', close);

  return { el, scrim, close };
}
