/* ==========================================================================
   On the Road · Compare — universal multi-criteria comparison
   --------------------------------------------------------------------------
   Three-level UI:
     1. Group list  — all compare groups for the trip, filterable by type
     2. Matrix      — candidates as columns, dimensions as rows, star/toggle cells
     3. (inline)    — add-candidate form slides in below the matrix

   Each group has a `compareType` which determines:
   - The type-specific add-form fields (e.g. airline/route for flights)
   - The default dimensions seeded on creation
   - The column header sub-info display
   ========================================================================== */

import './compare.css';
import {
  compareStore, scoreGroup, fieldPrice, PRICE_DIM_ID,
  type StoredGroup,
} from '../../data/stores/compare-store.ts';
import type { CompareCandidate, CompareDimension, CompareType } from '../../data/schema.ts';
import { COMPARE_TYPES } from '../../data/schema.ts';

/* ── Constants ───────────────────────────────────────────────────────────── */

const TYPE_META: Record<CompareType, { icon: string; label: string; hint: string }> = {
  accommodation: { icon: '🏨', label: 'Accommodation', hint: 'Hotels, Airbnbs, hostels' },
  flight:        { icon: '✈️', label: 'Flight',        hint: 'Compare routes & airlines' },
  train:         { icon: '🚄', label: 'Train',         hint: 'Rail & intercity coaches' },
  shopping:      { icon: '🛍️', label: 'Shopping',      hint: 'Products & souvenirs' },
  other:         { icon: '⚖️', label: 'Other',         hint: 'Anything else to decide' },
};

// Type-specific field definitions for the add-candidate form and column headers.
// `key` must match keys used in candidate.fields.
const TYPE_FIELDS: Record<CompareType, Array<{ key: string; label: string; placeholder: string; wide?: boolean }>> = {
  accommodation: [
    { key: 'price',    label: 'Total price',   placeholder: 'e.g. 360',          wide: false },
    { key: 'nights',   label: 'Nights',        placeholder: 'e.g. 3',            wide: false },
    { key: 'fees',     label: 'Extra fees',    placeholder: 'cleaning etc.',      wide: false },
    { key: 'address',  label: 'Address',       placeholder: 'Neighbourhood / address', wide: true },
  ],
  flight: [
    { key: 'price',    label: 'Price',         placeholder: 'e.g. 89',           wide: false },
    { key: 'airline',  label: 'Airline',       placeholder: 'e.g. Ryanair',      wide: false },
    { key: 'dep',      label: 'Departs',       placeholder: 'e.g. 06:30',        wide: false },
    { key: 'arr',      label: 'Arrives',       placeholder: 'e.g. 09:15',        wide: false },
    { key: 'duration', label: 'Duration',      placeholder: 'e.g. 2h45m',        wide: false },
    { key: 'route',    label: 'Route',         placeholder: 'e.g. LHR → FCO',   wide: true  },
  ],
  train: [
    { key: 'price',    label: 'Price',         placeholder: 'e.g. 45',           wide: false },
    { key: 'operator', label: 'Operator',      placeholder: 'e.g. Trenitalia',   wide: false },
    { key: 'dep',      label: 'Departs',       placeholder: 'e.g. 08:00',        wide: false },
    { key: 'arr',      label: 'Arrives',       placeholder: 'e.g. 11:30',        wide: false },
    { key: 'duration', label: 'Duration',      placeholder: 'e.g. 3h30m',        wide: false },
    { key: 'route',    label: 'Route',         placeholder: 'e.g. Paris → Lyon', wide: true  },
  ],
  shopping: [
    { key: 'price',    label: 'Price',         placeholder: 'e.g. 25',           wide: false },
    { key: 'store',    label: 'Store / source',placeholder: 'e.g. Marché St-P',  wide: true  },
  ],
  other: [
    { key: 'price',    label: 'Price / cost',  placeholder: 'e.g. 50',           wide: false },
    { key: 'location', label: 'Location',      placeholder: 'optional',           wide: true  },
  ],
};

/* ── State ───────────────────────────────────────────────────────────────── */

let groups: StoredGroup[] = [];
let loaded = false;
let _unsub: (() => void) | null = null;

let selectedGroupId: string | null = null;
let addFormGroupId: string | null = null;
let filterType: CompareType | 'all' = 'all';
// When set, a "new group" form is shown on the list page.
let newGroupForm = false;

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

function currentGroup(): StoredGroup | undefined {
  return groups.find((g) => g.id === selectedGroupId);
}

function pricePerNight(c: CompareCandidate): number | null {
  const p = fieldPrice(c);
  if (p == null) return null;
  const nights = parseFloat(c.fields['nights'] ?? '1') || 1;
  const fees = parseFloat(c.fields['fees'] ?? '0') || 0;
  return (p + fees) / nights;
}

/* ── Column sub-info per type ────────────────────────────────────────────── */

function candidateSubInfo(type: CompareType, c: CompareCandidate): string {
  const f = c.fields;
  switch (type) {
    case 'accommodation': {
      const pn = pricePerNight(c);
      const nights = f['nights'];
      return pn != null
        ? `€${Math.round(pn)}/night${nights ? ` · ${nights}n` : ''}`
        : f['price'] ? `€${f['price']} total` : '';
    }
    case 'flight':
    case 'train': {
      const parts = [f['dep'] && f['arr'] ? `${f['dep']} → ${f['arr']}` : '', f['duration']].filter(Boolean);
      return parts.join(' · ');
    }
    case 'shopping':
      return f['store'] ? esc(f['store']) : '';
    default:
      return f['location'] ? esc(f['location']) : '';
  }
}

/* ── Render: group list ──────────────────────────────────────────────────── */

function renderGroupList(): string {
  const visible = filterType === 'all'
    ? groups
    : groups.filter((g) => g.compareType === filterType);

  const typeTabs = ['all', ...COMPARE_TYPES].map((t) => {
    const isAll = t === 'all';
    const active = filterType === t;
    const label = isAll ? 'All' : TYPE_META[t as CompareType].label;
    return `<button class="cmp-tab ${active ? 'active' : ''}" data-tab="${t}">${label}</button>`;
  }).join('');

  const cards = visible.map((g) => {
    const m = TYPE_META[g.compareType];
    const count = g.candidates.length;
    return `
      <div class="cmp-group-card" data-group="${g.id}" role="button" tabindex="0">
        <div class="cmp-group-icon">${m.icon}</div>
        <div class="cmp-group-info">
          <div class="cmp-group-title">${esc(g.title || m.label)}</div>
          <div class="cmp-group-meta">${m.label} · ${count} option${count !== 1 ? 's' : ''}</div>
        </div>
        <div class="cmp-group-actions">
          <button class="cmp-group-del" data-act="del-group" data-group="${g.id}">Delete</button>
          <div class="cmp-group-arrow">›</div>
        </div>
      </div>`;
  }).join('');

  const emptyState = visible.length === 0 && !newGroupForm ? `
    <div class="cmp-empty">
      <div class="cmp-empty-icon">⚖️</div>
      <div class="cmp-empty-title">Nothing to compare yet</div>
      <div class="cmp-empty-text">Create a comparison group to start weighing your options — flights, accommodation, shopping, or anything else.</div>
    </div>` : '';

  return `
    <div class="cmp-list-header">
      <div class="cmp-tabs">${typeTabs}</div>
      <button class="btn btn-primary cmp-new-btn" data-act="new-group">＋ New comparison</button>
    </div>
    ${newGroupForm ? renderNewGroupForm() : ''}
    <div class="cmp-group-list">${cards}${emptyState}</div>`;
}

function renderNewGroupForm(): string {
  const typePills = COMPARE_TYPES.map((t) => {
    const m = TYPE_META[t];
    return `
      <button class="cmp-type-pill" data-type="${t}">
        <span class="cmp-type-pill-icon">${m.icon}</span>
        <span class="cmp-type-pill-label">${m.label}</span>
        <span class="cmp-type-pill-hint">${m.hint}</span>
      </button>`;
  }).join('');

  return `
    <div class="cmp-new-form">
      <div class="cmp-new-form-title">New comparison</div>
      <div class="cmp-field">
        <label>What are you comparing?</label>
        <div class="cmp-type-grid" id="ng-type-grid">${typePills}</div>
      </div>
      <div class="cmp-field">
        <label>Label <span class="cmp-opt">(optional)</span></label>
        <input class="input" id="ng-title" placeholder="e.g. Flights to Rome, May 3">
      </div>
      <div class="cmp-new-form-btns">
        <button class="btn btn-ghost" data-act="ng-cancel">Cancel</button>
        <button class="btn btn-primary" data-act="ng-save">Create</button>
      </div>
    </div>`;
}

/* ── Render: matrix ──────────────────────────────────────────────────────── */

function ratingCell(groupId: string, c: CompareCandidate, dim: CompareDimension, isWinner: boolean): string {
  const v = c.scores[dim.id] ?? 0;
  const stars = [1, 2, 3, 4, 5].map((n) =>
    `<button class="cmp-star ${n <= v ? 'on' : ''}" data-act="rate"
      data-group="${groupId}" data-cand="${c.id}" data-dim="${dim.id}" data-val="${n}">★</button>`
  ).join('');
  return `<div class="cmp-cell ${isWinner ? 'winner' : ''}"><div class="cmp-stars">${stars}</div></div>`;
}

function booleanCell(groupId: string, c: CompareCandidate, dim: CompareDimension, isWinner: boolean): string {
  const on = (c.scores[dim.id] ?? 0) === 1;
  return `
    <div class="cmp-cell ${isWinner ? 'winner' : ''}">
      <button class="cmp-toggle ${on ? 'on' : ''}" data-act="toggle"
        data-group="${groupId}" data-cand="${c.id}" data-dim="${dim.id}">
        ${on ? 'Yes' : 'No'}
      </button>
    </div>`;
}

function priceCell(groupId: string, group: StoredGroup, c: CompareCandidate, isWinner: boolean): string {
  const p = c.fields['price'] ?? '';
  const type = group.compareType;
  const displayVal = type === 'accommodation'
    ? (() => { const pn = pricePerNight(c); return pn != null ? `€${Math.round(pn)}<span>/night</span>` : '—'; })()
    : (p ? `€${p}` : '—');

  const extraFields = type === 'accommodation'
    ? `<input class="cmp-mini-input" type="number" placeholder="total €"
         value="${esc(c.fields['price'] ?? '')}"
         data-act="field" data-group="${groupId}" data-cand="${c.id}" data-key="price">
       <input class="cmp-mini-input" type="number" placeholder="fees"
         value="${esc(c.fields['fees'] ?? '')}"
         data-act="field" data-group="${groupId}" data-cand="${c.id}" data-key="fees">
       <input class="cmp-mini-input" type="number" placeholder="nights"
         value="${esc(c.fields['nights'] ?? '1')}"
         data-act="field" data-group="${groupId}" data-cand="${c.id}" data-key="nights">`
    : `<input class="cmp-mini-input" type="number" placeholder="price"
         value="${esc(c.fields['price'] ?? '')}"
         data-act="field" data-group="${groupId}" data-cand="${c.id}" data-key="price">`;

  return `
    <div class="cmp-cell cmp-price-cell ${isWinner ? 'winner' : ''}">
      <div class="cmp-price-display">${displayVal}</div>
      <div class="cmp-price-edit">${extraFields}</div>
    </div>`;
}

function renderMatrix(group: StoredGroup): string {
  const result = scoreGroup(group);
  const cands = group.candidates;
  const m = TYPE_META[group.compareType];

  const toolbar = `
    <div class="cmp-toolbar">
      <button class="btn btn-ghost cmp-back" data-act="back">← All comparisons</button>
      <div class="cmp-toolbar-title">${m.icon} <span contenteditable="true" id="group-title-edit" data-group="${group.id}">${esc(group.title || m.label)}</span></div>
    </div>`;

  const formOpen = addFormGroupId === group.id;

  if (cands.length === 0) {
    return toolbar + (formOpen ? renderAddForm(group) : `
      <div class="cmp-empty">
        <div class="cmp-empty-icon">${m.icon}</div>
        <div class="cmp-empty-title">Add options to compare</div>
        <div class="cmp-empty-text">Enter two or more ${m.label.toLowerCase()} options, score each dimension, and the best pick surfaces automatically.</div>
        <button class="btn btn-primary" data-act="open-form" data-group="${group.id}">＋ Add first option</button>
      </div>`);
  }

  const colHeads = cands.map((c) => {
    const rank = result.ranking.indexOf(c.id) + 1;
    const total = Math.round(result.totals[c.id] * 100);
    const sub = candidateSubInfo(group.compareType, c);
    return `
      <th class="cmp-col ${rank === 1 ? 'is-top' : ''}">
        <div class="cmp-col-head">
          ${rank === 1 ? '<div class="cmp-rank-badge">🏆 Best</div>' : ''}
          <input class="cmp-name-input" value="${esc(c.name)}"
            data-act="name" data-group="${group.id}" data-cand="${c.id}">
          ${sub ? `<div class="cmp-col-sub">${sub}</div>` : ''}
          ${c.link ? `<a class="cmp-col-link" href="${esc(c.link)}" target="_blank" rel="noopener">↗ link</a>` : ''}
          <div class="cmp-col-score">${total}<span>/100</span></div>
          <button class="cmp-col-del" data-act="del-cand" data-group="${group.id}" data-cand="${c.id}" title="Remove">✕</button>
        </div>
      </th>`;
  }).join('');

  const rows = group.dimensions.map((dim) => {
    const cells = cands.map((c) => {
      const win = result.cells[c.id]?.[dim.id]?.isWinner ?? false;
      if (dim.id === PRICE_DIM_ID) return `<td>${priceCell(group.id, group, c, win)}</td>`;
      if (dim.type === 'rating')   return `<td>${ratingCell(group.id, c, dim, win)}</td>`;
      if (dim.type === 'boolean')  return `<td>${booleanCell(group.id, c, dim, win)}</td>`;
      return `<td><div class="cmp-cell ${win ? 'winner' : ''}">
        <input class="cmp-mini-input" type="number" value="${c.scores[dim.id] ?? ''}"
          data-act="num" data-group="${group.id}" data-cand="${c.id}" data-dim="${dim.id}"></div></td>`;
    }).join('');

    return `
      <tr>
        <th class="cmp-row-head">
          <div class="cmp-dim-label">
            <span>${esc(dim.label)}</span>
            ${!dim.builtin ? `<button class="cmp-dim-del" data-act="del-dim"
              data-group="${group.id}" data-dim="${dim.id}" title="Remove">✕</button>` : ''}
          </div>
          <div class="cmp-weight">
            <input type="range" min="0" max="5" step="1" value="${dim.weight}"
              data-act="weight" data-group="${group.id}" data-dim="${dim.id}">
            <span class="cmp-weight-val">${dim.weight === 0 ? 'off' : '×' + dim.weight}</span>
          </div>
        </th>
        ${cells}
      </tr>`;
  }).join('');

  return toolbar + `
    <div class="cmp-matrix-wrap">
      <table class="cmp-matrix">
        <thead><tr><th class="cmp-corner">Dimension</th>${colHeads}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${formOpen ? renderAddForm(group) : `
    <div class="cmp-actions">
      <button class="btn btn-ghost" data-act="open-form" data-group="${group.id}">＋ Add option</button>
      <button class="btn btn-ghost" data-act="add-dim" data-group="${group.id}">＋ Add dimension</button>
    </div>`}
    ${renderVerdict(group, result)}`;
}

function renderAddForm(group: StoredGroup): string {
  const fields = TYPE_FIELDS[group.compareType];
  const fieldHtml = fields.map((f) =>
    `<div class="cmp-field ${f.wide ? 'cmp-field-wide' : ''}">
      <label>${f.label}</label>
      <input class="input" id="af-${f.key}" type="${f.key === 'price' || f.key === 'nights' || f.key === 'fees' ? 'number' : 'text'}" placeholder="${esc(f.placeholder)}">
    </div>`
  ).join('');

  return `
    <div class="cmp-add-form" data-group="${group.id}">
      <div class="cmp-add-form-title">Add an option</div>
      <div class="cmp-form-grid">
        <div class="cmp-field cmp-field-wide">
          <label>Name</label>
          <input class="input" id="af-name" placeholder="${esc(TYPE_META[group.compareType].hint)}" autofocus>
        </div>
        <div class="cmp-field cmp-field-wide">
          <label>Link <span class="cmp-opt">(optional)</span></label>
          <input class="input" id="af-link" type="url" placeholder="booking.com, skyscanner, …">
        </div>
        ${fieldHtml}
      </div>
      <div class="cmp-form-btns">
        <button class="btn btn-ghost" data-act="form-cancel">Cancel</button>
        <button class="btn btn-primary" data-act="form-save" data-group="${group.id}">Add option</button>
      </div>
    </div>`;
}

function renderVerdict(group: StoredGroup, result: ReturnType<typeof scoreGroup>): string {
  const byId = (id: string) => group.candidates.find((c) => c.id === id);
  const champions = group.dimensions
    .map((dim) => {
      const winId = result.dimWinners[dim.id];
      const c = winId ? byId(winId) : null;
      return c ? `<li><span class="cmp-champ-dim">${esc(dim.label)}</span> → <strong>${esc(c.name)}</strong></li>` : '';
    })
    .filter(Boolean).join('');

  const top = byId(result.ranking[0]);
  const runnerUp = byId(result.ranking[1]);
  const gap = runnerUp
    ? Math.round((result.totals[result.ranking[0]] - result.totals[result.ranking[1]]) * 100)
    : null;

  return `
    <div class="cmp-verdict">
      <div class="cmp-verdict-main">
        <div class="cmp-verdict-label">By your current weights</div>
        <div class="cmp-verdict-pick">🏆 ${top ? esc(top.name) : '—'}</div>
        ${gap != null ? `<div class="cmp-verdict-gap">${gap === 0 ? 'Tied with' : `${gap} pts ahead of`} ${esc(runnerUp!.name)}</div>` : ''}
      </div>
      ${champions ? `
        <div class="cmp-verdict-champs">
          <div class="cmp-verdict-label">Best on each dimension</div>
          <ul>${champions}</ul>
        </div>` : ''}
      <div class="cmp-verdict-hint">Drag the weight sliders to reprioritize — the ranking updates live.</div>
    </div>`;
}

/* ── Event wiring ────────────────────────────────────────────────────────── */

function wire(root: HTMLElement) {
  // Group cards (div, not button — avoids nested-button layout break)
  root.querySelectorAll<HTMLElement>('.cmp-group-card').forEach((el) => {
    const open = () => {
      selectedGroupId = el.dataset.group!;
      addFormGroupId = null;
      render();
    };
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-act="del-group"]')) return;
      open();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  });

  // Editable title in matrix view
  const titleEdit = root.querySelector<HTMLElement>('#group-title-edit');
  if (titleEdit) {
    titleEdit.addEventListener('blur', () => {
      const groupId = titleEdit.dataset.group!;
      compareStore.updateTitle(groupId, titleEdit.textContent?.trim() || '');
    });
    titleEdit.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); titleEdit.blur(); }
    });
  }

  // Click actions (all delegated buttons)
  root.querySelectorAll<HTMLElement>('[data-act]').forEach((el) => {
    const act = el.dataset.act!;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      handleClick(act, el);
    });
  });

  // Tab filter
  root.querySelectorAll<HTMLElement>('.cmp-tab').forEach((el) => {
    el.addEventListener('click', () => {
      filterType = (el.dataset.tab as CompareType | 'all');
      render();
    });
  });

  // Type-picker pills in new-group form
  root.querySelectorAll<HTMLElement>('.cmp-type-pill').forEach((el) => {
    el.addEventListener('click', () => {
      root.querySelectorAll('.cmp-type-pill').forEach((p) => p.classList.remove('active'));
      el.classList.add('active');
    });
  });

  // Input handlers
  root.querySelectorAll<HTMLInputElement>('input[data-act]').forEach((el) => {
    const act = el.dataset.act!;
    if (act === 'weight') {
      el.addEventListener('input', () => {
        const label = el.parentElement?.querySelector('.cmp-weight-val');
        const w = Number(el.value);
        if (label) label.textContent = w === 0 ? 'off' : '×' + w;
      });
      el.addEventListener('change', () =>
        compareStore.setWeight(el.dataset.group!, el.dataset.dim!, Number(el.value)));
    } else if (act === 'field') {
      el.addEventListener('change', () =>
        compareStore.setField(el.dataset.group!, el.dataset.cand!, el.dataset.key!, el.value));
    } else if (act === 'name') {
      el.addEventListener('change', () =>
        compareStore.updateCandidate(el.dataset.group!, el.dataset.cand!, { name: el.value || 'Untitled' }));
    } else if (act === 'num') {
      el.addEventListener('change', () => {
        const v = el.value.trim() === '' ? null : Number(el.value);
        compareStore.setScore(el.dataset.group!, el.dataset.cand!, el.dataset.dim!, Number.isFinite(v as number) ? v : null);
      });
    }
  });
}

function handleClick(act: string, el: HTMLElement) {
  const groupId = el.dataset.group;
  switch (act) {
    case 'back':
      selectedGroupId = null;
      addFormGroupId = null;
      render();
      return;
    case 'new-group':
      newGroupForm = true;
      render();
      return;
    case 'ng-cancel':
      newGroupForm = false;
      render();
      return;
    case 'ng-save':
      saveNewGroup();
      return;
    case 'del-group': {
      if (el.classList.contains('is-confirming')) {
        compareStore.remove(groupId!);
      } else {
        el.classList.add('is-confirming');
        el.textContent = 'Confirm delete';
        // Auto-reset if user clicks away
        const reset = () => {
          el.classList.remove('is-confirming');
          el.textContent = 'Delete';
          document.removeEventListener('click', reset);
        };
        setTimeout(() => document.addEventListener('click', reset), 0);
      }
      return;
    }
    case 'rate':
      compareStore.setScore(groupId!, el.dataset.cand!, el.dataset.dim!, Number(el.dataset.val));
      return;
    case 'toggle': {
      const group = currentGroup();
      const c = group?.candidates.find((x) => x.id === el.dataset.cand);
      const cur = c?.scores[el.dataset.dim!] ?? 0;
      compareStore.setScore(groupId!, el.dataset.cand!, el.dataset.dim!, cur === 1 ? 0 : 1);
      return;
    }
    case 'del-cand':
      compareStore.removeCandidate(groupId!, el.dataset.cand!);
      return;
    case 'del-dim':
      compareStore.removeDimension(groupId!, el.dataset.dim!);
      return;
    case 'open-form':
      addFormGroupId = groupId!;
      render();
      requestAnimationFrame(() =>
        document.querySelector<HTMLInputElement>('#af-name')?.focus());
      return;
    case 'form-cancel':
      addFormGroupId = null;
      render();
      return;
    case 'form-save':
      saveAddForm(groupId!);
      return;
    case 'add-dim':
      promptAddDimension(groupId!);
      return;
  }
}

async function saveNewGroup() {
  const root = document.getElementById('view-budget');
  const activeTypePill = root?.querySelector<HTMLElement>('.cmp-type-pill.active');
  if (!activeTypePill) {
    // Highlight the type grid to prompt selection
    root?.querySelector('.cmp-type-grid')?.classList.add('cmp-type-grid--error');
    return;
  }
  const type = activeTypePill.dataset.type as CompareType;
  const title = (document.querySelector<HTMLInputElement>('#ng-title')?.value ?? '').trim();
  newGroupForm = false;
  await compareStore.create(type, title);
  // subscription re-renders; open the new group
  const latest = compareStore.peek();
  if (latest.length > 0) {
    selectedGroupId = latest[latest.length - 1].id;
    addFormGroupId = selectedGroupId;
    render();
    requestAnimationFrame(() =>
      document.querySelector<HTMLInputElement>('#af-name')?.focus());
  }
}

async function saveAddForm(groupId: string) {
  const group = currentGroup() ?? groups.find((g) => g.id === groupId);
  if (!group) return;

  const name = (document.querySelector<HTMLInputElement>('#af-name')?.value ?? '').trim() || 'Untitled';
  const link = (document.querySelector<HTMLInputElement>('#af-link')?.value ?? '').trim();

  const fields: Record<string, string> = {};
  for (const f of TYPE_FIELDS[group.compareType]) {
    const val = (document.querySelector<HTMLInputElement>(`#af-${f.key}`)?.value ?? '').trim();
    if (val) fields[f.key] = val;
  }

  addFormGroupId = null;
  await compareStore.addCandidate(groupId, {
    name,
    link: link || undefined,
    fields,
  });
}

function promptAddDimension(groupId: string) {
  const label = prompt('Dimension name (e.g. "Breakfast included", "View quality")');
  if (!label) return;
  const isRating = confirm('Score this 1–5 stars (OK) or Yes/No (Cancel)?');
  if (isRating) {
    compareStore.addDimension(groupId, label, 'rating', true);
  } else {
    const good = confirm(`For "${label}", is YES the better outcome? OK = yes, Cancel = no.`);
    compareStore.addDimension(groupId, label, 'boolean', good);
  }
}

/* ── Render dispatch ─────────────────────────────────────────────────────── */

function render() {
  const root = document.getElementById('view-budget');
  if (!root) return;
  const body = root.querySelector<HTMLElement>('.cmp-body');
  if (!body) return;

  if (!loaded) {
    body.innerHTML = `<div class="cmp-loading">Loading…</div>`;
    return;
  }

  const group = currentGroup();
  body.innerHTML = (selectedGroupId && group) ? renderMatrix(group) : renderGroupList();
  wire(body);
}

/* ── Init ────────────────────────────────────────────────────────────────── */

export function initCompare() {
  _unsub?.();
  groups = []; loaded = false;
  selectedGroupId = null; addFormGroupId = null; newGroupForm = false;

  _unsub = compareStore.subscribe((rows) => {
    groups = rows;
    loaded = true;
    // If the selected group was deleted, go back to the list.
    if (selectedGroupId && !groups.find((g) => g.id === selectedGroupId)) {
      selectedGroupId = null;
    }
    render();
  });
}
