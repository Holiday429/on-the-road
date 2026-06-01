/* ==========================================================================
   On the Road · Stay — multi-criteria accommodation comparison
   --------------------------------------------------------------------------
   One comparison group per leg. The page lists legs; picking one opens its
   matrix: candidates are columns, dimensions are rows. Weight sliders re-rank
   live; the recommendation block names the overall pick AND per-dimension
   champions, so the user sees *why* — not just a single static winner.
   ========================================================================== */

import './stay.css';
import { routeStore, type StoredLeg } from '../../data/stores/route-store.ts';
import {
  stayStore, scoreStay, perNight, PRICE_DIM_ID,
  type StoredStay,
} from '../../data/stores/stay-store.ts';
import type { StayCandidate, StayDimension } from '../../data/schema.ts';

const KIND_ICONS: Record<StayCandidate['kind'], string> = {
  hotel: '🏨', airbnb: '🏠', hostel: '🛏️', other: '📍',
};

let legs: StoredLeg[] = [];
let stays: StoredStay[] = [];
let selectedLegId: string | null = null;
let legsLoaded = false;
let staysLoaded = false;
// When set, an "add option" form panel is shown for this stay (before any
// candidate is committed). Cleared on save/cancel.
let addFormStayId: string | null = null;

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function nightsForLeg(leg: StoredLeg): number {
  const n = Math.round((new Date(leg.dateTo).getTime() - new Date(leg.dateFrom).getTime()) / 86400000);
  return n > 0 ? n : 1;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

/* ── Mutations ───────────────────────────────────────────────────────────── */

async function openLeg(legId: string) {
  selectedLegId = legId;
  addFormStayId = null;
  let stay = stays.find((s) => s.legId === legId);
  if (!stay) {
    const leg = legs.find((l) => l.id === legId);
    await stayStore.create(legId, leg?.city ?? '');
    // subscription re-renders once the new doc lands
  } else {
    render();
  }
}

function currentStay(): StoredStay | undefined {
  return stays.find((s) => s.legId === selectedLegId);
}

/* ── Render: leg list ────────────────────────────────────────────────────── */

function renderLegList(): string {
  if (legs.length === 0) {
    return `
      <div class="stay-empty">
        <div class="stay-empty-icon">🏨</div>
        <div class="stay-empty-title">No stops yet</div>
        <div class="stay-empty-text">Add cities to your itinerary first, then come back to compare where to stay in each one.</div>
      </div>`;
  }
  return `
    <div class="stay-leg-grid">
      ${legs.map((leg) => {
        const stay = stays.find((s) => s.legId === leg.id);
        const count = stay?.candidates.length ?? 0;
        return `
          <button class="stay-leg-card" data-leg="${leg.id}">
            <div class="stay-leg-flag">${leg.flag || '🗺️'}</div>
            <div class="stay-leg-info">
              <div class="stay-leg-city">${esc(leg.city)}</div>
              <div class="stay-leg-dates">${fmtDate(leg.dateFrom)} → ${fmtDate(leg.dateTo)}</div>
            </div>
            <div class="stay-leg-badge ${count ? 'has' : ''}">
              ${count ? `${count} option${count !== 1 ? 's' : ''}` : 'Compare'}
            </div>
          </button>`;
      }).join('')}
    </div>`;
}

/* ── Render: matrix ──────────────────────────────────────────────────────── */

function ratingCell(stayId: string, c: StayCandidate, dim: StayDimension, isWinner: boolean): string {
  const v = c.scores[dim.id] ?? 0;
  const stars = [1, 2, 3, 4, 5].map((n) =>
    `<button class="stay-star ${n <= v ? 'on' : ''}" data-act="rate" data-stay="${stayId}" data-cand="${c.id}" data-dim="${dim.id}" data-val="${n}">★</button>`
  ).join('');
  return `<div class="stay-cell ${isWinner ? 'winner' : ''}"><div class="stay-stars">${stars}</div></div>`;
}

function booleanCell(stayId: string, c: StayCandidate, dim: StayDimension, isWinner: boolean): string {
  const on = (c.scores[dim.id] ?? 0) === 1;
  return `
    <div class="stay-cell ${isWinner ? 'winner' : ''}">
      <button class="stay-toggle ${on ? 'on' : ''}" data-act="toggle" data-stay="${stayId}" data-cand="${c.id}" data-dim="${dim.id}">
        ${on ? 'Yes' : 'No'}
      </button>
    </div>`;
}

function priceCell(stayId: string, c: StayCandidate, isWinner: boolean): string {
  const pn = perNight(c);
  return `
    <div class="stay-cell stay-price-cell ${isWinner ? 'winner' : ''}">
      <div class="stay-price-pn">${pn != null ? `€${Math.round(pn)}<span>/night</span>` : '—'}</div>
      <div class="stay-price-edit">
        <input class="stay-mini-input" type="number" placeholder="total €" value="${c.totalPrice ?? ''}"
               data-act="price-total" data-stay="${stayId}" data-cand="${c.id}">
        <input class="stay-mini-input" type="number" placeholder="fees" value="${c.extraFees || ''}"
               data-act="price-fees" data-stay="${stayId}" data-cand="${c.id}">
        <input class="stay-mini-input" type="number" placeholder="nights" value="${c.nights ?? 1}"
               data-act="price-nights" data-stay="${stayId}" data-cand="${c.id}">
      </div>
    </div>`;
}

function renderMatrix(stay: StoredStay): string {
  const result = scoreStay(stay);
  const leg = legs.find((l) => l.id === stay.legId);
  const cands = stay.candidates;

  const header = `
    <div class="stay-toolbar">
      <button class="btn btn-ghost stay-back" data-act="back">← All stops</button>
      <div class="stay-toolbar-title">${leg?.flag || ''} ${esc(stay.city || leg?.city || 'Stay')}</div>
    </div>`;

  const formOpen = addFormStayId === stay.id;

  if (cands.length === 0) {
    return header + (formOpen ? renderAddForm(stay) : `
      <div class="stay-empty">
        <div class="stay-empty-icon">⚖️</div>
        <div class="stay-empty-title">Add options to compare</div>
        <div class="stay-empty-text">Enter two or more places — a hotel, an Airbnb, a hostel — and score each on the dimensions that matter.</div>
        <button class="btn btn-primary" data-act="open-form" data-stay="${stay.id}">＋ Add first option</button>
      </div>`);
  }

  // Column headers (candidate names + meta + rank badge)
  const colHeads = cands.map((c) => {
    const rank = result.ranking.indexOf(c.id) + 1;
    const total = Math.round(result.totals[c.id] * 100);
    return `
      <th class="stay-col ${rank === 1 ? 'is-top' : ''}">
        <div class="stay-col-head">
          ${rank === 1 ? '<div class="stay-rank-badge">🏆 Best overall</div>' : ''}
          <div class="stay-col-kind">${KIND_ICONS[c.kind]}</div>
          <input class="stay-name-input" value="${esc(c.name)}" data-act="name" data-stay="${stay.id}" data-cand="${c.id}">
          <div class="stay-col-score">${total}<span>/100</span></div>
          <button class="stay-col-del" data-act="del-cand" data-stay="${stay.id}" data-cand="${c.id}" title="Remove">✕</button>
        </div>
      </th>`;
  }).join('');

  // Dimension rows
  const rows = stay.dimensions.map((dim) => {
    const cells = cands.map((c) => {
      const win = result.cells[c.id]?.[dim.id]?.isWinner ?? false;
      if (dim.id === PRICE_DIM_ID) return `<td>${priceCell(stay.id, c, win)}</td>`;
      if (dim.type === 'rating')   return `<td>${ratingCell(stay.id, c, dim, win)}</td>`;
      if (dim.type === 'boolean')  return `<td>${booleanCell(stay.id, c, dim, win)}</td>`;
      // number (custom): plain input
      return `<td><div class="stay-cell ${win ? 'winner' : ''}">
        <input class="stay-mini-input" type="number" value="${c.scores[dim.id] ?? ''}"
               data-act="num" data-stay="${stay.id}" data-cand="${c.id}" data-dim="${dim.id}"></div></td>`;
    }).join('');

    return `
      <tr>
        <th class="stay-row-head">
          <div class="stay-dim-label">
            <span>${esc(dim.label)}</span>
            ${!dim.builtin ? `<button class="stay-dim-del" data-act="del-dim" data-stay="${stay.id}" data-dim="${dim.id}" title="Remove dimension">✕</button>` : ''}
          </div>
          <div class="stay-weight">
            <input type="range" min="0" max="5" step="1" value="${dim.weight}"
                   data-act="weight" data-stay="${stay.id}" data-dim="${dim.id}">
            <span class="stay-weight-val">${dim.weight === 0 ? 'off' : '×' + dim.weight}</span>
          </div>
        </th>
        ${cells}
      </tr>`;
  }).join('');

  return header + `
    <div class="stay-matrix-wrap">
      <table class="stay-matrix">
        <thead><tr><th class="stay-corner">Dimension</th>${colHeads}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${formOpen ? renderAddForm(stay) : `
    <div class="stay-actions">
      <button class="btn btn-ghost" data-act="open-form" data-stay="${stay.id}">＋ Add option</button>
      <button class="btn btn-ghost" data-act="add-dim" data-stay="${stay.id}">＋ Add dimension</button>
    </div>`}
    ${renderVerdict(stay, result)}`;
}

/** Inline form to enter a new candidate before it joins the matrix. */
function renderAddForm(stay: StoredStay): string {
  const leg = legs.find((l) => l.id === stay.legId);
  const defNights = leg ? nightsForLeg(leg) : 1;
  return `
    <div class="stay-form" data-stay="${stay.id}">
      <div class="stay-form-title">Add an option</div>
      <div class="stay-form-grid">
        <div class="stay-field stay-field-wide">
          <label>Name</label>
          <input class="input" id="sf-name" placeholder="e.g. Hotel Artemide" autofocus>
        </div>
        <div class="stay-field">
          <label>Type</label>
          <select class="input select" id="sf-kind">
            <option value="hotel">🏨 Hotel</option>
            <option value="airbnb">🏠 Airbnb</option>
            <option value="hostel">🛏️ Hostel</option>
            <option value="other">📍 Other</option>
          </select>
        </div>
        <div class="stay-field stay-field-wide">
          <label>Link <span class="stay-opt">(optional)</span></label>
          <input class="input" id="sf-link" placeholder="booking.com / airbnb.com URL">
        </div>
        <div class="stay-field">
          <label>Total price €</label>
          <input class="input" id="sf-total" type="number" placeholder="e.g. 360">
        </div>
        <div class="stay-field">
          <label>Extra fees €</label>
          <input class="input" id="sf-fees" type="number" placeholder="cleaning etc.">
        </div>
        <div class="stay-field">
          <label>Nights</label>
          <input class="input" id="sf-nights" type="number" value="${defNights}" min="1">
        </div>
      </div>
      <div class="stay-form-btns">
        <button class="btn btn-ghost" data-act="form-cancel">Cancel</button>
        <button class="btn btn-primary" data-act="form-save" data-stay="${stay.id}">Add option</button>
      </div>
    </div>`;
}

function renderVerdict(stay: StoredStay, result: ReturnType<typeof scoreStay>): string {
  const byId = (id: string) => stay.candidates.find((c) => c.id === id);
  const champions = stay.dimensions
    .map((dim) => {
      const winId = result.dimWinners[dim.id];
      const c = winId ? byId(winId) : null;
      return c ? `<li><span class="stay-champ-dim">${esc(dim.label)}</span> → <strong>${esc(c.name)}</strong></li>` : '';
    })
    .filter(Boolean).join('');

  const top = byId(result.ranking[0]);
  const runnerUp = byId(result.ranking[1]);
  const gap = runnerUp
    ? Math.round((result.totals[result.ranking[0]] - result.totals[result.ranking[1]]) * 100)
    : null;

  return `
    <div class="stay-verdict">
      <div class="stay-verdict-main">
        <div class="stay-verdict-label">By your current weights</div>
        <div class="stay-verdict-pick">🏆 ${top ? esc(top.name) : '—'}</div>
        ${gap != null ? `<div class="stay-verdict-gap">${gap === 0 ? 'Tied with' : `${gap} pts ahead of`} ${esc(runnerUp!.name)}</div>` : ''}
      </div>
      ${champions ? `
        <div class="stay-verdict-champs">
          <div class="stay-verdict-label">Best on each dimension</div>
          <ul>${champions}</ul>
        </div>` : ''}
      <div class="stay-verdict-hint">Drag the weight sliders to match your priorities — the ranking updates live.</div>
    </div>`;
}

/* ── Event wiring ────────────────────────────────────────────────────────── */

function num(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function wire(root: HTMLElement) {
  // Leg cards
  root.querySelectorAll<HTMLElement>('.stay-leg-card').forEach((el) => {
    el.addEventListener('click', () => openLeg(el.dataset.leg!));
  });

  // Click actions
  root.querySelectorAll<HTMLElement>('[data-act]').forEach((el) => {
    const act = el.dataset.act!;
    if (['rate', 'toggle', 'del-cand', 'del-dim', 'add-dim', 'back',
         'open-form', 'form-cancel', 'form-save'].includes(act)) {
      el.addEventListener('click', () => handleClick(act, el));
    }
  });

  // Input changes (debounce-free; Firestore + subscription handle re-render)
  root.querySelectorAll<HTMLInputElement>('input[data-act]').forEach((el) => {
    const act = el.dataset.act!;
    if (act === 'weight') {
      // live label + commit on input
      el.addEventListener('input', () => {
        const label = el.parentElement?.querySelector('.stay-weight-val');
        const w = Number(el.value);
        if (label) label.textContent = w === 0 ? 'off' : '×' + w;
      });
      el.addEventListener('change', () =>
        stayStore.setWeight(el.dataset.stay!, el.dataset.dim!, Number(el.value)));
    } else if (['price-total', 'price-fees', 'price-nights'].includes(act)) {
      el.addEventListener('change', () => {
        const patch =
          act === 'price-total'  ? { totalPrice: num(el.value) ?? undefined } :
          act === 'price-fees'   ? { extraFees: num(el.value) ?? 0 } :
                                   { nights: num(el.value) ?? 1 };
        stayStore.updateCandidate(el.dataset.stay!, el.dataset.cand!, patch);
      });
    } else if (act === 'name') {
      el.addEventListener('change', () =>
        stayStore.updateCandidate(el.dataset.stay!, el.dataset.cand!, { name: el.value || 'Untitled' }));
    } else if (act === 'num') {
      el.addEventListener('change', () =>
        stayStore.setScore(el.dataset.stay!, el.dataset.cand!, el.dataset.dim!, num(el.value)));
    }
  });
}

function handleClick(act: string, el: HTMLElement) {
  const stayId = el.dataset.stay;
  switch (act) {
    case 'back':
      selectedLegId = null;
      addFormStayId = null;
      render();
      return;
    case 'rate':
      stayStore.setScore(stayId!, el.dataset.cand!, el.dataset.dim!, Number(el.dataset.val));
      return;
    case 'toggle': {
      const stay = currentStay();
      const c = stay?.candidates.find((x) => x.id === el.dataset.cand);
      const cur = c?.scores[el.dataset.dim!] ?? 0;
      stayStore.setScore(stayId!, el.dataset.cand!, el.dataset.dim!, cur === 1 ? 0 : 1);
      return;
    }
    case 'del-cand':
      stayStore.removeCandidate(stayId!, el.dataset.cand!);
      return;
    case 'del-dim':
      stayStore.removeDimension(stayId!, el.dataset.dim!);
      return;
    case 'open-form':
      addFormStayId = stayId!;
      render();
      // focus the name field once it's in the DOM
      requestAnimationFrame(() =>
        document.querySelector<HTMLInputElement>('#sf-name')?.focus());
      return;
    case 'form-cancel':
      addFormStayId = null;
      render();
      return;
    case 'form-save':
      saveForm(stayId!);
      return;
    case 'add-dim':
      promptAddDimension(stayId!);
      return;
  }
}

function fieldVal(id: string): string {
  return document.querySelector<HTMLInputElement>('#' + id)?.value.trim() ?? '';
}

async function saveForm(stayId: string) {
  const name = fieldVal('sf-name') || 'Untitled';
  const kind = (document.querySelector<HTMLSelectElement>('#sf-kind')?.value
    ?? 'hotel') as StayCandidate['kind'];
  const link = fieldVal('sf-link');
  const total = num(fieldVal('sf-total'));
  const fees = num(fieldVal('sf-fees'));
  const nights = num(fieldVal('sf-nights'));
  addFormStayId = null;
  await stayStore.addCandidate(stayId, {
    name, kind,
    link: link || undefined,
    totalPrice: total ?? undefined,
    extraFees: fees ?? 0,
    nights: nights ?? 1,
  });
  // subscription re-renders with the new column
}

function promptAddDimension(stayId: string) {
  const label = prompt('Dimension name (e.g. "Breakfast included", "Quietness")');
  if (!label) return;
  const isRating = confirm('Score this 1–5 (OK) or Yes/No (Cancel)?');
  if (isRating) {
    stayStore.addDimension(stayId, label, 'rating', true);
  } else {
    const good = confirm(`For "${label}", is YES the good outcome? OK = yes is good, Cancel = yes is bad.`);
    stayStore.addDimension(stayId, label, 'boolean', good);
  }
}

/* ── Render dispatch ─────────────────────────────────────────────────────── */

function render() {
  const root = document.getElementById('view-budget');
  if (!root) return;
  const body = root.querySelector<HTMLElement>('.stay-body');
  if (!body) return;

  if (!legsLoaded || !staysLoaded) {
    body.innerHTML = `<div class="stay-loading">Loading…</div>`;
    return;
  }

  const stay = currentStay();
  body.innerHTML = (selectedLegId && stay) ? renderMatrix(stay) : renderLegList();
  wire(body);
}

export function initStay() {
  routeStore.subscribe((rows) => {
    legs = [...rows].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
    legsLoaded = true;
    render();
  });
  stayStore.subscribe((rows) => {
    stays = rows;
    staysLoaded = true;
    render();
  });
}
