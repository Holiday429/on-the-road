/* ==========================================================================
   On the Road · Itinerary board — markup
   --------------------------------------------------------------------------
   The list page as an airport departures board: one split-flap row per stop,
   a "now boarding" card above it for where you are (or the next departure),
   and gap / overlap warnings between stops. Pure HTML builders — wiring
   (open, menu, hover preview) lives in itinerary.ts via the data-act
   attributes. State and numbers come from itinerary-board-model.ts.
   ========================================================================== */

import { t as tr } from '../../core/i18n.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { renderStamp } from '../../core/paper/stamp.ts';
import type { CardPostmarks } from '../../data/card-postmarks.ts';
import type { Leg } from './itinerary-shared.ts';
import { TRANSPORT_ICONS, daysBetween, fmtDate, legStays } from './itinerary-utils.ts';
import { legCoverArt, nightsLabel } from './itinerary-cards.ts';
import { ensurePlanDays } from './itinerary-plan-views.ts';
import {
  boardState, boardSummary, gapBetween, gateFor, tileText,
  type BoardState, type Gate,
} from './itinerary-board-model.ts';

export interface BoardCtx {
  legs: Leg[];
  today: string;
  marks: (leg: Leg) => CardPostmarks | undefined;
}

const STATE_KEY: Record<BoardState, string> = {
  done: 'board.status.done', now: 'board.status.now', booked: 'board.status.booked', tobook: 'board.status.tobook',
};

/** "05 JUL" — the board always prints dates the same way. */
function boardDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

/** Text as flap tiles. The real text is on the row's aria-label; tiles are decoration. */
function tiles(text: string): string {
  const cells = [...text].map((c, i) => c === ' '
    ? '<i class="rb-ch rb-sp"></i>'
    : `<i class="rb-ch" style="--i:${i}">${esc(c)}</i>`).join('');
  return `<span class="rb-chars" aria-hidden="true">${cells}</span>`;
}

function arriveBy(leg: Leg): { glyph: string; code: string; times: string } | null {
  const t = leg.arrivalTransport;
  if (!t) return null;
  return {
    glyph: TRANSPORT_ICONS[t.type] ?? '',
    code: t.service || t.from,
    times: t.time ? `${t.time}${t.arrivalTime ? `→${t.arrivalTime}` : ''}` : '',
  };
}

function firstStay(leg: Leg): string {
  const stays = legStays(leg);
  return stays.length ? stays[0].name : '';
}

/* ── Rows ────────────────────────────────────────────────────────────────── */

/** A stop's most recent postmark: the one it left behind, else the one it arrived with. */
function rowStamp(leg: Leg, state: BoardState, ctx: BoardCtx): string {
  const m = ctx.marks(leg);
  const spec = state === 'done' ? (m?.depart ?? m?.arrive) : m?.arrive;
  return spec ? `<span class="rb-stamp" aria-hidden="true">${renderStamp(spec, { size: 34 })}</span>` : '';
}

function renderRow(leg: Leg, i: number, ctx: BoardCtx): string {
  const state = boardState(leg, ctx.today);
  const nights = Math.max(0, daysBetween(leg.dateFrom, leg.dateTo));
  const ar = arriveBy(leg);
  const stay = firstStay(leg);
  const status = tr(STATE_KEY[state]);
  const transportOk = !!leg.arrivalTransport;
  const missing = state === 'done' ? '' : `
    <span class="rb-miss">
      ${transportOk ? '' : `<span class="rb-chip">${esc(tr('board.noTransport'))}</span>`}
      ${stay ? '' : `<span class="rb-chip">${esc(tr('board.noStay'))}</span>`}
    </span>`;
  const sub = [boardDate(leg.dateFrom).toUpperCase(), ar ? `${ar.glyph} ${ar.code}` : '', stay, `${nights}n`].filter(Boolean).join('  ·  ');
  return `
    <div class="rb-rowwrap" data-id="${esc(leg.id)}" style="--row:${i}">
      <button type="button" class="rb-row is-${state}" data-act="open" data-id="${esc(leg.id)}"
        aria-label="${esc(tr('board.rowAria', { city: leg.city, from: fmtDate(leg.dateFrom), to: fmtDate(leg.dateTo), nights: nightsLabel(nights), status }))}">
        <span class="rb-marker" aria-hidden="true"></span>
        <span class="rb-date">${tiles(boardDate(leg.dateFrom))}</span>
        <span class="rb-city"><span class="rb-flag" aria-hidden="true">${leg.flag || ''}</span>${tiles(tileText(leg.city, 13))}</span>
        <span class="rb-arr">${ar ? `<span class="rb-arr-glyph" aria-hidden="true">${ar.glyph}</span><span class="rb-arr-code">${esc(ar.code)}</span><span class="rb-arr-times">${esc(ar.times)}</span>` : '<span class="rb-dim">—</span>'}</span>
        <span class="rb-stay">${stay ? esc(stay) : '<span class="rb-dim">—</span>'}</span>
        <span class="rb-n">${nights}</span>
        <span class="rb-status">${rowStamp(leg, state, ctx)}<span class="rb-dot" aria-hidden="true"></span><span class="rb-status-text">${esc(status)}</span></span>
        ${missing}
        <span class="rb-sub">${esc(sub)}</span>
      </button>
      <button type="button" class="rb-menu-btn" data-act="menu" data-id="${esc(leg.id)}" aria-haspopup="menu" aria-label="${esc(tr('board.menuAria', { city: leg.city }))}">⋯</button>
      <div class="rb-menu" role="menu" data-menu="${esc(leg.id)}" hidden>
        <button type="button" role="menuitem" data-act="edit-dates-from-list" data-id="${esc(leg.id)}">${esc(tr('board.menuEdit'))}</button>
        <button type="button" role="menuitem" class="is-danger" data-act="del" data-id="${esc(leg.id)}">${esc(tr('board.menuRemove'))}</button>
      </div>
    </div>`;
}

/** The warning line between two stops that don't join up. */
function renderGap(prev: Leg, next: Leg): string {
  const diff = gapBetween(prev, next);
  if (diff === 0) return '';
  const text = diff > 0 ? tr('board.gap', { n: diff }) : tr('board.overlap', { n: -diff });
  return `
    <button type="button" class="rb-gap" data-act="fix-gap" data-id="${esc(next.id)}">
      <span aria-hidden="true">⚠</span><span>${esc(text)}</span><span class="rb-gap-fix">${esc(tr('board.fix'))}</span>
    </button>`;
}

/* ── Gate card ───────────────────────────────────────────────────────────── */

function transportLine(leg: Leg): string {
  const ar = arriveBy(leg);
  if (!ar) return esc(tr('board.noTransport'));
  const when = `${fmtDate(leg.dateFrom)}${leg.arrivalTransport?.time ? ` ${leg.arrivalTransport.time}` : ''}`;
  return `${ar.glyph} ${esc(ar.code)} · ${esc(when)}`;
}

function countdown(n: number): string {
  if (n <= 0) return tr('board.gate.today');
  return n === 1 ? tr('board.gate.tomorrow') : tr('board.gate.inDays', { n });
}

function stayAt(leg: Leg, today: string) {
  const stays = legStays(leg);
  return stays.find((s) => s.checkIn && s.checkOut && s.checkIn <= today && today <= s.checkOut) ?? stays[0];
}

function stateChip(leg: Leg, today: string): string {
  const s = boardState(leg, today);
  return `<span class="rb-pill is-${s}">${esc(tr(STATE_KEY[s]))}</span>`;
}

/** One city on the gate card. `gate` carries the live state; `preview` shows any stop on hover. */
export function renderGate(gate: Gate, ctx: BoardCtx, opts: { preview?: Leg } = {}): string {
  if (opts.preview) {
    const leg = opts.preview;
    const nights = Math.max(0, daysBetween(leg.dateFrom, leg.dateTo));
    return gateCard({
      mode: 'preview', leg, ctx, label: tr('board.gate.preview'),
      stub: `<span class="rb-stub-big">${nights}</span><span class="rb-stub-sm">${esc(nightsLabel(nights).replace(/^\d+\s*/, ''))}</span>`,
      lines: [
        { icon: '🛏', html: esc(firstStay(leg) || tr('board.noStay')) },
        { icon: '🎫', html: transportLine(leg) + ' ' + stateChip(leg, ctx.today) },
      ],
    });
  }
  if (gate.kind === 'none') return '';
  if (gate.kind === 'over') {
    return `
      <section class="rb-gate rb-gate--over" aria-label="${esc(tr('board.gate.over'))}">
        <div class="rb-gate-main">
          <div class="rb-gate-kicker">${esc(tr('board.gate.over'))}</div>
          <p class="rb-gate-over-text">${esc(tr('board.gate.overText', { stops: gate.stops, nights: gate.nights }))}</p>
          <button type="button" class="btn btn-ghost rd-sm" data-open-passport="">${esc(tr('board.gate.passport'))}</button>
        </div>
      </section>`;
  }
  if (gate.kind === 'next') {
    const leg = gate.leg;
    return gateCard({
      mode: 'next', leg, ctx, label: tr('board.gate.next'),
      stub: gate.daysUntil <= 1
        ? `<span class="rb-stub-word">${esc(countdown(gate.daysUntil))}</span>`
        : `<span class="rb-stub-big">${gate.daysUntil}</span><span class="rb-stub-sm">${esc(tr('board.gate.daysToGo'))}</span>`,
      lines: [
        { icon: '🎫', html: transportLine(leg) + ' ' + stateChip(leg, ctx.today) },
        { icon: '🛏', html: esc(firstStay(leg) || tr('board.noStay')) },
      ],
    });
  }
  const { leg, next, dayNo, dayTotal } = gate;
  const stay = stayAt(leg, ctx.today);
  const days = ensurePlanDays(leg);
  const day = days[daysBetween(leg.dateFrom, ctx.today)];
  const planned = day ? (leg.plans ?? []).filter((p) => p.dayId === day.id) : [];
  const lines = [
    { icon: '🛏', html: stay ? `${esc(stay.name)}${stay.checkOut ? ` · ${esc(tr('board.gate.checkout', { date: fmtDate(stay.checkOut) }))}` : ''}` : esc(tr('board.noStay')) },
    { icon: '🎫', html: planned.length
        ? `${esc(tr('board.gate.todayN', { n: planned.length }))} — ${esc(planned.slice(0, 2).map((p) => p.title).join(' · '))}${planned.length > 2 ? ' …' : ''}`
        : esc(tr('board.gate.today0')) },
  ];
  if (next) lines.push({ icon: '➜', html: `${esc(tr('board.gate.then'))}: <strong>${esc(next.city)}</strong> · ${transportLine(next)} ${stateChip(next, ctx.today)}` });
  const ticks = Array.from({ length: dayTotal }, (_, i) => `<i class="${i < dayNo ? 'is-on' : ''}"></i>`).join('');
  return gateCard({
    mode: 'now', leg, ctx, label: tr('board.gate.now'),
    stub: `<span class="rb-stub-sm">${esc(tr('board.gate.day'))}</span><span class="rb-stub-big">${dayNo}</span><span class="rb-stub-sm">${esc(tr('board.gate.of', { n: dayTotal }))}</span><span class="rb-ticks" aria-hidden="true">${ticks}</span>`,
    lines,
  });
}

function gateCard(o: { mode: 'now' | 'next' | 'preview'; leg: Leg; ctx: BoardCtx; label: string; stub: string; lines: { icon: string; html: string }[] }): string {
  const { leg, ctx } = o;
  const nights = Math.max(0, daysBetween(leg.dateFrom, leg.dateTo));
  const m = ctx.marks(leg);
  const spec = m?.arrive;
  return `
    <section class="rb-gate rb-gate--${o.mode}" data-gate-leg="${esc(leg.id)}" aria-label="${esc(o.label)}">
      <div class="rb-gate-cover route-leg-cover" data-act="open" data-id="${esc(leg.id)}">
        ${legCoverArt(leg, 'route-leg-cover')}
        ${spec ? `<span class="rb-gate-stamp" aria-hidden="true">${renderStamp(spec, { size: 56 })}</span>` : ''}
      </div>
      <div class="rb-gate-main">
        <div class="rb-gate-kicker"><span class="rb-lamp" aria-hidden="true"></span>${esc(o.label)}</div>
        <h2 class="rb-gate-city"><span aria-hidden="true">${leg.flag || ''}</span> ${esc(leg.city)}</h2>
        <div class="rb-gate-dates">${esc(fmtDate(leg.dateFrom))} → ${esc(fmtDate(leg.dateTo))} · ${esc(nightsLabel(nights))}</div>
        <ul class="rb-gate-lines">${o.lines.map((l) => `<li><span class="rb-gate-ico" aria-hidden="true">${l.icon}</span><span>${l.html}</span></li>`).join('')}</ul>
        <div class="rb-gate-actions">
          <button type="button" class="btn btn-primary rd-sm" data-act="open" data-id="${esc(leg.id)}">${esc(tr('board.gate.open'))}</button>
          <button type="button" class="btn btn-ghost rd-sm" data-act="gate-map" data-id="${esc(leg.id)}">${esc(tr('route.btnOnMap'))}</button>
        </div>
      </div>
      <div class="rb-gate-stub">${o.stub}</div>
    </section>`;
}

/* ── Board ───────────────────────────────────────────────────────────────── */

function renderStrip(ctx: BoardCtx): string {
  const segs = ctx.legs.map((leg, i) => {
    const n = Math.max(1, daysBetween(leg.dateFrom, leg.dateTo));
    const state = boardState(leg, ctx.today);
    const tick = i < ctx.legs.length - 1 && ctx.legs[i + 1].country !== leg.country ? ' has-tick' : '';
    const title = `${leg.city} · ${nightsLabel(n)}`;
    return `<button type="button" class="rb-seg is-${state}${tick}" style="flex:${n} 1 0" data-act="strip" data-id="${esc(leg.id)}" title="${esc(title)}" aria-label="${esc(title)}"><i></i></button>`;
  }).join('');
  return `<div class="rb-strip">${segs}</div>`;
}

function summaryText(ctx: BoardCtx): string {
  const s = boardSummary(ctx.legs, ctx.today);
  return [
    s.stops === 1 ? tr('board.stopsOne') : tr('board.stopsMany', { n: s.stops }),
    s.countries === 1 ? tr('board.countriesOne') : tr('board.countriesMany', { n: s.countries }),
    tr('board.nightsMany', { n: s.nights }),
    s.toBook ? tr('board.toBook', { n: s.toBook }) : tr('board.allBooked'),
  ].join(' · ');
}

export function renderBoard(ctx: BoardCtx, opts: { shuffle: boolean }): string {
  const gate = gateFor(ctx.legs, ctx.today);
  const title = tr(gate.kind === 'now' ? 'board.title.during' : gate.kind === 'over' ? 'board.title.after' : 'board.title.before');
  const clock = new Date(ctx.today + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  const rows = ctx.legs.map((leg, i) => (i > 0 ? renderGap(ctx.legs[i - 1], leg) : '') + renderRow(leg, i, ctx)).join('');
  return `
    <div class="rb-wrap">
    <div data-rb-gate-host>${renderGate(gate, ctx)}</div>
    <div class="rb-meta">
      <p class="rb-summary">${esc(summaryText(ctx))}</p>
      <span class="rb-meta-tools">
        <span data-pp-icon></span>
        <button type="button" class="btn btn-primary rd-sm" data-act="add-stop">${esc(tr('route.addStop'))}</button>
      </span>
    </div>
    ${renderStrip(ctx)}
    <section class="rb${opts.shuffle ? ' is-shuffling' : ''}" aria-label="${esc(title)}">
      <header class="rb-bar">
        <span class="rb-lamp" aria-hidden="true"></span>
        <h2 class="rb-title">${esc(title)}</h2>
        <time class="rb-clock" datetime="${esc(ctx.today)}">${esc(clock)}</time>
      </header>
      <div class="rb-head" aria-hidden="true">
        <span></span><span>${esc(tr('board.colDate'))}</span><span>${esc(tr('board.colCity'))}</span>
        <span class="rb-c-arr">${esc(tr('board.colArrive'))}</span><span class="rb-c-stay">${esc(tr('board.colStay'))}</span>
        <span class="rb-c-n">${esc(tr('board.colNights'))}</span><span>${esc(tr('board.colStatus'))}</span>
      </div>
      <div class="rb-body">${rows}</div>
      <button type="button" class="rb-add" data-act="add-stop">${esc(tr('route.addStop'))}</button>
    </section>
    </div>`;
}

export { gateFor };
