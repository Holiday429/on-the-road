/* ==========================================================================
   On the Road · Wrap · chapters (HTML strings)
   --------------------------------------------------------------------------
   One function per chapter, all pure: a WrapModel plus a few formatters in,
   markup out. Paper things (receipts, tags, stamps, LED glass) come from the
   paper kit; nothing is redrawn here. The page (wrap.ts) owns data, events
   and the keyboard.
   ========================================================================== */

import { t } from '../../core/i18n.ts';
import { escHtml as esc, safeUrl } from '../../core/utils.ts';
import { paperReceipt, paperTag, type PaperRow } from '../../core/paper/paper.ts';
import { renderStamp } from '../../core/paper/stamp.ts';
import { transportIcon, bagIcon, GLYPH } from '../../core/icons.ts';
import type { WrapModel } from '../../data/trip-wrap.ts';
import { sketchRoute, sketchSvg } from './wrap-map.ts';

export interface WrapCtx {
  m: WrapModel;
  money: (n: number) => string;
  /** Grams in the user's chosen weight unit. */
  weight: (g: number) => string;
  km: (n: number) => string;
  cat: (id: string) => { label: string; icon: string };
  locale: string;
  /** The trip is not over yet. */
  ongoing: boolean;
}

export const CHAPTERS = ['cover', 'route', 'passport', 'stays', 'spend', 'pack', 'journal', 'end'] as const;
export type ChapterId = typeof CHAPTERS[number];

function section(id: ChapterId, body: string, title = ''): string {
  return `<section class="wrap-ch wrap-ch--${id}" id="wrap-ch-${id}" data-ch="${id}"${title ? ` aria-label="${esc(title)}"` : ''}>${body}</section>`;
}

const head = (icon: string, title: string) => `<h2 class="wrap-h"><span aria-hidden="true">${icon}</span> ${esc(title)}</h2>`;

function range(c: WrapCtx): string {
  const f = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(c.locale, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${f(c.m.cover.startDate)} – ${f(c.m.cover.endDate)}`;
}

/* ── 1 · Cover ───────────────────────────────────────────────────────────── */

export function coverChapter(c: WrapCtx): string {
  const { cover } = c.m;
  return section('cover', `
    <div class="wrap-cover">
      <div class="wrap-cover-emblem" aria-hidden="true">🛂</div>
      <div class="wrap-eyebrow">${esc(t('wrap.cover.eyebrow'))}</div>
      <h1 class="wrap-cover-name">${esc(cover.name)}</h1>
      <div class="wrap-cover-dates">${esc(range(c))}</div>
      <div class="wrap-cover-facts">
        <span>${esc(t('dash.hero.days', { n: cover.days }))}</span>
        <span>${esc(t('dash.hero.countries', { n: c.m.route.countries }))}</span>
        <span>${esc(t('passport.summary', { n: cover.stamps, c: cover.stampCountries }))}</span>
      </div>
      ${c.ongoing ? `<div class="wrap-note">${esc(t('wrap.ongoing'))}</div>` : ''}
    </div>`, t('wrap.ch.cover'));
}

/* ── 2 · Route ───────────────────────────────────────────────────────────── */

export function routeChapter(c: WrapCtx): string {
  const r = c.m.route;
  const sketch = sketchRoute(r.stops);
  const map = sketch.points.length >= 2
    ? `<div class="wrap-map-wrap">${sketchSvg(sketch, t('wrap.ch.route'))}<button type="button" class="btn btn-ghost wrap-replay" data-wrap-replay>${esc(t('wrap.route.replay'))}</button></div>`
    : `<div class="wrap-note">${esc(t('wrap.route.noMap'))}</div>`;
  const modes = r.modes.map((m) =>
    `<li class="wrap-chip"><span aria-hidden="true">${transportIcon(m.mode)}</span> ${esc(t('wrap.route.mode', { label: t(`agenda.transport.${m.mode}`), n: m.count }))}${m.km ? ` <span class="wrap-chip-sub">${esc(c.km(m.km))} km</span>` : ''}</li>`).join('');
  const lg = r.longest;
  return section('route', `
    ${head('🧭', t('wrap.route.title'))}
    ${r.distanceKm ? `<div class="wrap-big"><span class="wrap-big-num">${esc(c.km(r.distanceKm))}</span><span class="wrap-big-cap">${esc(t('wrap.route.distance'))}</span></div>` : ''}
    <div class="wrap-sub">${esc(t('dash.hero.stops', { n: r.stops.length }))} · ${esc(t('dash.hero.countries', { n: r.countries }))}</div>
    ${map}
    ${modes ? `<div class="wrap-label">${esc(t('wrap.route.modesTitle'))}</div><ul class="wrap-chips">${modes}</ul>` : ''}
    ${lg && lg.km ? `<div class="wrap-fact"><span aria-hidden="true">${transportIcon(lg.mode)}</span> ${esc(t('wrap.route.longest', { from: lg.from, to: lg.to, km: c.km(lg.km) }))}</div>` : ''}`, t('wrap.ch.route'));
}

/* ── 3 · Passport ────────────────────────────────────────────────────────── */

export function passportChapter(c: WrapCtx): string {
  const stamps = c.m.stamps;
  const body = stamps.length
    ? `<div class="wrap-stamps">${stamps.map((s) => `<div class="wrap-stamp">${renderStamp(s, { size: 112 })}</div>`).join('')}</div>`
    : `<div class="wrap-note">${esc(t('wrap.passport.none'))}</div>`;
  return section('passport', `
    ${head('🛂', t('wrap.passport.title'))}
    <div class="wrap-sub">${esc(t('passport.summary', { n: c.m.cover.stamps, c: c.m.cover.stampCountries }))}</div>
    ${body}
    ${stamps.length ? `<button type="button" class="btn btn-ghost" data-wrap-passport>${esc(t('passport.open'))}</button>` : ''}`, t('wrap.ch.passport'));
}

/* ── 4 · Stays ───────────────────────────────────────────────────────────── */

const nightsText = (n: number) => (n === 1 ? t('wrap.stays.night1') : t('wrap.stays.nights', { n }));

export function staysChapter(c: WrapCtx): string {
  const s = c.m.stays;
  if (!s.totalNights) return section('stays', `${head('🏨', t('wrap.stays.title'))}<div class="wrap-note">${esc(t('wrap.stays.none'))}</div>`, t('wrap.ch.stays'));
  const max = Math.max(...s.cities.map((x) => x.nights), 1);
  const bars = s.cities.map((x) => `
    <li class="wrap-bar${s.longest && x.city === s.longest.city ? ' is-top' : ''}">
      <span class="wrap-bar-name">${esc(x.flag)} ${esc(x.city)}${x.visits > 1 ? ` <span class="wrap-chip-sub">${esc(t('wrap.stays.visits', { n: x.visits }))}</span>` : ''}</span>
      <span class="wrap-bar-track"><span class="wrap-bar-fill" style="width:${Math.max(3, Math.round((x.nights / max) * 100))}%"></span></span>
      <span class="wrap-bar-val">${esc(nightsText(x.nights))}</span>
    </li>`).join('');
  const platforms = s.platforms.length
    ? `<div class="wrap-label">${esc(t('wrap.stays.platforms'))}</div><ul class="wrap-chips">${s.platforms.map((p) => `<li class="wrap-chip">${esc(p.name)} <span class="wrap-chip-sub">× ${p.count}</span></li>`).join('')}</ul>`
    : '';
  return section('stays', `
    ${head('🏨', t('wrap.stays.title'))}
    <div class="wrap-sub">${esc(t('wrap.stays.summary', { n: s.totalNights, c: s.cities.length }))}${s.stayCount ? ` · ${esc(t('wrap.stays.count', { n: s.stayCount }))}` : ''}</div>
    <ul class="wrap-bars">${bars}</ul>
    ${s.longest ? `<div class="wrap-fact">🏆 ${esc(t('wrap.stays.longest', { city: s.longest.city, n: s.longest.nights }))}</div>` : ''}
    ${platforms}`, t('wrap.ch.stays'));
}

/* ── 5 · Spend ───────────────────────────────────────────────────────────── */

export function spendChapter(c: WrapCtx): string {
  const s = c.m.spend;
  if (!s.count) return section('spend', `${head('🧾', t('wrap.spend.title'))}<div class="wrap-note">${esc(t('wrap.spend.none'))}</div>`, t('wrap.ch.spend'));
  const dayFmt = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(c.locale, { day: 'numeric', month: 'short' });

  const catRows: PaperRow[] = s.byCategory.map((x) => {
    const k = x.id ? c.cat(x.id) : { label: t('wrap.spend.unsorted'), icon: '🗂️' };
    return { label: k.label, icon: k.icon, value: c.money(x.amount), sub: `${Math.round(x.share * 100)}%` };
  });
  if (s.budget != null) catRows.push({ label: t('wrap.spend.budget'), value: c.money(s.budget), tone: 'neutral' });

  const facts: PaperRow[] = [
    ...s.byCountry.slice(0, 6).map((x) => ({
      label: x.country, icon: x.flag || undefined, value: c.money(x.amount),
      sub: x.nights ? t('wrap.spend.perDayShort', { v: c.money(x.perDay) }) : undefined,
    })),
    { label: t('wrap.spend.perDay'), value: c.money(s.perDay), strong: true },
  ];
  if (s.biggestDay) facts.push({ label: t('wrap.spend.biggestDay'), value: c.money(s.biggestDay.amount), sub: [dayFmt(s.biggestDay.date), s.biggestDay.city].filter(Boolean).join(' · ') });
  if (s.cheapestCountry) facts.push({ label: t('wrap.spend.cheapest'), value: s.cheapestCountry.country, sub: t('wrap.spend.perDayShort', { v: c.money(s.cheapestCountry.perDay) }), tone: 'good' });
  if (s.priciestCountry) facts.push({ label: t('wrap.spend.priciest'), value: s.priciestCountry.country, sub: t('wrap.spend.perDayShort', { v: c.money(s.priciestCountry.perDay) }), tone: 'warn' });

  const receipt = paperReceipt({
    title: c.m.cover.name, meta: `${range(c)} · ${t('wrap.spend.count', { n: s.count })}`,
    rows: catRows,
    total: { label: t('wrap.spend.total'), value: c.money(s.total) },
    stamp: s.overBy == null ? undefined : s.overBy > 0 ? { text: t('wrap.spend.over'), tone: 'bad' } : { text: t('wrap.spend.under'), tone: 'good' },
    barcode: true,
  });
  const byCountry = paperReceipt({ title: t('wrap.spend.byCountry'), rows: facts, zigzag: true });
  return section('spend', `
    ${head('🧾', t('wrap.spend.title'))}
    <div class="wrap-receipts">${receipt}${byCountry}</div>`, t('wrap.ch.spend'));
}

/* ── 6 · Pack ────────────────────────────────────────────────────────────── */

export function packChapter(c: WrapCtx): string | null {
  const p = c.m.pack;
  if (!p) return null;
  const diff = p.returnG - p.departG;
  const verdict = diff === 0
    ? { v: t('wrap.pack.same'), tone: 'neutral' as const }
    : diff < 0
      ? { v: t('wrap.pack.lighter', { w: c.weight(-diff) }), tone: 'good' as const }
      : { v: t('wrap.pack.heavier', { w: c.weight(diff) }), tone: 'warn' as const };
  const led = (label: string, g: number) => `<div class="paper-led wrap-led"><div class="paper-led-num">${esc(c.weight(g))}</div><div class="paper-led-aux">${esc(label)}</div></div>`;
  const list = (title: string, rows: Array<{ name: string; city: string }>) => rows.length
    ? `<div class="wrap-col"><div class="wrap-label">${esc(title)}</div><ul class="wrap-list">${rows.map((r) => `<li>${esc(r.name)}${r.city ? ` <span class="wrap-chip-sub">${esc(r.city)}</span>` : ''}</li>`).join('')}</ul></div>`
    : '';
  const changes = p.bought.length || p.lost.length
    ? `<div class="wrap-cols">${list(t('wrap.pack.bought', { n: p.bought.length }), p.bought)}${list(t('wrap.pack.lost', { n: p.lost.length }), p.lost)}</div>`
    : `<div class="wrap-note">${esc(t('wrap.pack.noChange'))}</div>`;
  return section('pack', `
    ${head(bagIcon('suitcase'), t('wrap.pack.title'))}
    <div class="wrap-leds">${led(t('wrap.pack.depart'), p.departG)}<span class="wrap-leds-arrow" aria-hidden="true">${GLYPH.arrow}</span>${led(t('wrap.pack.return'), p.returnG)}</div>
    <div class="wrap-tag">${paperTag({ verdict: verdict.v, tone: verdict.tone })}</div>
    ${changes}`, t('wrap.ch.pack'));
}

/* ── 7 · Journal ─────────────────────────────────────────────────────────── */

export function journalChapter(c: WrapCtx): string {
  const j = c.m.journal;
  if (!j.entries) {
    return section('journal', `${head('📔', t('wrap.journal.title'))}<div class="wrap-note">${esc(t('wrap.journal.none'))}</div>
      <button type="button" class="btn btn-ghost" data-wrap-journal="capture">${esc(t('wrap.journal.open'))}</button>`, t('wrap.ch.journal'));
  }
  const photos = j.featured.length
    ? `<div class="wrap-photos">${j.featured.map((u) => `<img class="wrap-photo" src="${esc(safeUrl(u))}" alt="" loading="lazy">`).join('')}</div>`
    : '';
  const ready = j.portraitShort === 0;
  return section('journal', `
    ${head('📔', t('wrap.journal.title'))}
    <div class="wrap-sub">${esc(t('wrap.journal.entries', { n: j.entries }))}${j.photos ? ` · ${esc(t('wrap.journal.photos', { n: j.photos }))}` : ''}</div>
    ${j.topCity ? `<div class="wrap-fact">✍️ ${esc(t('wrap.journal.topCity', { city: j.topCity.city, n: j.topCity.count }))}</div>` : ''}
    ${photos}
    <div class="wrap-actions">
      <button type="button" class="btn btn-ghost" data-wrap-journal="story">${esc(t('wrap.journal.story'))}</button>
      <button type="button" class="btn btn-ghost" data-wrap-journal="recap"${ready ? '' : ' disabled aria-describedby="wrap-portrait-why"'}>${esc(t('wrap.journal.portrait'))}</button>
      <button type="button" class="btn btn-ghost" data-wrap-journal="capture">${esc(t('wrap.journal.open'))}</button>
    </div>
    ${ready ? '' : `<div class="wrap-note" id="wrap-portrait-why">${esc(t('wrap.journal.portraitShort', { n: j.portraitShort }))}</div>`}`, t('wrap.ch.journal'));
}

/* ── 8 · End ─────────────────────────────────────────────────────────────── */

export function endChapter(c: WrapCtx): string {
  const { cover, route } = c.m;
  const vars = { days: cover.days, countries: route.countries, km: c.km(route.distanceKm), stamps: cover.stamps };
  return section('end', `
    <div class="wrap-end">
      <p class="wrap-end-line">${esc(t(route.distanceKm ? 'wrap.end.line' : 'wrap.end.lineNoKm', vars))}</p>
      <button type="button" class="btn btn-primary" data-wrap-home>${esc(t('wrap.end.back'))}</button>
    </div>`, t('wrap.ch.end'));
}

/* ── The page ────────────────────────────────────────────────────────────── */

export function wrapChapters(c: WrapCtx): string[] {
  return [
    coverChapter(c), routeChapter(c), passportChapter(c), staysChapter(c), spendChapter(c),
    packChapter(c) ?? '', journalChapter(c), endChapter(c),
  ].filter(Boolean);
}

/** The chapter ids actually present (the bag chapter is skipped without a pack list). */
export function presentChapters(c: WrapCtx): ChapterId[] {
  return CHAPTERS.filter((id) => id !== 'pack' || c.m.pack);
}
