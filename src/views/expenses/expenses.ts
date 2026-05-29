/* ==========================================================================
   On the Road · Expenses tracker
   ========================================================================== */

import './expenses.css';

interface Expense {
  id: string;
  amount: number;
  currency: string;
  amountEur: number;
  description: string;
  category: string;
  city: string;
  date: string; // ISO date
}

interface Category { id: string; label: string; icon: string; color: string; }

const CATEGORIES: Category[] = [
  { id: 'accommodation', label: 'Stay',      icon: '🏠', color: '#fde68a' },
  { id: 'food',          label: 'Food',      icon: '🍜', color: '#bbf7d0' },
  { id: 'transport',     label: 'Transport', icon: '🚆', color: '#bae6fd' },
  { id: 'activities',    label: 'Activities',icon: '🎭', color: '#e9d5ff' },
  { id: 'shopping',      label: 'Shopping',  icon: '🛍️', color: '#fecaca' },
  { id: 'health',        label: 'Health',    icon: '💊', color: '#d1fae5' },
  { id: 'misc',          label: 'Misc',      icon: '📌', color: '#f3f4f6' },
];

const CURRENCIES = [
  { code: 'EUR', symbol: '€', rate: 1 },
  { code: 'DKK', symbol: 'kr', rate: 0.134 },
  { code: 'CHF', symbol: 'CHF', rate: 1.04 },
  { code: 'GBP', symbol: '£', rate: 1.17 },
  { code: 'CZK', symbol: 'Kč', rate: 0.040 },
  { code: 'NOK', symbol: 'kr', rate: 0.085 },
  { code: 'SEK', symbol: 'kr', rate: 0.086 },
];

const STORAGE_KEY = 'otr:expenses';
let expenses: Expense[] = [];
let selectedCategory = 'food';
let filterCategory = 'all';
let filterCity = 'all';

function uid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) expenses = JSON.parse(raw);
  } catch { expenses = []; }
}

function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(expenses)); }

function toEur(amount: number, currency: string): number {
  const cur = CURRENCIES.find(c => c.code === currency);
  return amount * (cur?.rate ?? 1);
}

function addExpense(amount: number, currency: string, description: string, city: string, date: string) {
  if (!amount || !description.trim()) return false;
  expenses.unshift({
    id: uid(), amount, currency,
    amountEur: toEur(amount, currency),
    description: description.trim(),
    category: selectedCategory,
    city: city.trim() || 'Unknown',
    date,
  });
  save();
  render();
  return true;
}

function deleteExpense(id: string) {
  expenses = expenses.filter(e => e.id !== id);
  save();
  render();
}

function getCities(): string[] {
  return [...new Set(expenses.map(e => e.city))];
}

function filteredExpenses(): Expense[] {
  return expenses.filter(e =>
    (filterCategory === 'all' || e.category === filterCategory) &&
    (filterCity === 'all' || e.city === filterCity)
  );
}

function totalEur(list: Expense[]): number {
  return list.reduce((s, e) => s + e.amountEur, 0);
}

function fmt(n: number): string {
  return `€${n.toFixed(0)}`;
}

function fmtFull(amount: number, currency: string): string {
  const cur = CURRENCIES.find(c => c.code === currency);
  const sym = cur?.symbol ?? currency;
  return `${sym}${amount.toFixed(2)}`;
}

function renderSummary(el: HTMLElement) {
  const total = totalEur(expenses);
  const days = new Set(expenses.map(e => e.date)).size || 1;
  const dailyAvg = total / days;

  el.innerHTML = `
    <div class="exp-stat-card accent">
      <div class="exp-stat-num">${fmt(total)}</div>
      <div class="exp-stat-label">Total spent</div>
    </div>
    <div class="exp-stat-card">
      <div class="exp-stat-num">${fmt(dailyAvg)}</div>
      <div class="exp-stat-label">Daily avg</div>
    </div>
    <div class="exp-stat-card">
      <div class="exp-stat-num">${expenses.length}</div>
      <div class="exp-stat-label">Transactions</div>
    </div>
    <div class="exp-stat-card">
      <div class="exp-stat-num">${getCities().length}</div>
      <div class="exp-stat-label">Cities</div>
    </div>
  `;
}

function renderForm(el: HTMLElement) {
  el.innerHTML = `
    <div class="exp-form">
      <div class="exp-form-title">Add expense</div>
      <div class="exp-cat-chips" id="exp-cat-chips">
        ${CATEGORIES.map(c => `
          <button class="exp-cat-chip ${c.id === selectedCategory ? 'selected' : ''}" data-cat="${c.id}">
            ${c.icon} ${c.label}
          </button>
        `).join('')}
      </div>
      <div class="exp-form-grid">
        <div>
          <label class="field-label">Amount</label>
          <input class="input" type="number" id="exp-amount" placeholder="0.00" min="0" step="0.01">
        </div>
        <div>
          <label class="field-label">Currency</label>
          <select class="input select" id="exp-currency">
            ${CURRENCIES.map(c => `<option value="${c.code}" ${c.code === 'EUR' ? 'selected' : ''}>${c.code} ${c.symbol}</option>`).join('')}
          </select>
        </div>
        <div class="field-full">
          <label class="field-label">What for?</label>
          <input class="input" id="exp-desc" placeholder="e.g. Dinner at Boqueria market">
        </div>
        <div>
          <label class="field-label">City</label>
          <input class="input" id="exp-city" placeholder="Barcelona">
        </div>
        <div>
          <label class="field-label">Date</label>
          <input class="input" type="date" id="exp-date" value="${new Date().toISOString().split('T')[0]}">
        </div>
      </div>
      <button class="btn btn-primary" id="exp-add-btn" style="width:100%; justify-content:center">Add expense</button>
    </div>
  `;

  el.querySelectorAll('.exp-cat-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedCategory = (btn as HTMLElement).dataset.cat!;
      el.querySelectorAll('.exp-cat-chip').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  el.querySelector('#exp-add-btn')?.addEventListener('click', () => {
    const amount = parseFloat((el.querySelector('#exp-amount') as HTMLInputElement).value);
    const currency = (el.querySelector('#exp-currency') as HTMLSelectElement).value;
    const desc = (el.querySelector('#exp-desc') as HTMLInputElement).value;
    const city = (el.querySelector('#exp-city') as HTMLInputElement).value;
    const date = (el.querySelector('#exp-date') as HTMLInputElement).value;

    if (addExpense(amount, currency, desc, city, date)) {
      (el.querySelector('#exp-amount') as HTMLInputElement).value = '';
      (el.querySelector('#exp-desc') as HTMLInputElement).value = '';
    }
  });
}

function renderList(el: HTMLElement) {
  const cities = getCities();
  const list = filteredExpenses();

  el.innerHTML = `
    <div class="exp-list-header">
      <div class="exp-list-title">Transactions</div>
    </div>
    ${cities.length > 1 ? `
    <div class="exp-city-pills">
      <div class="exp-city-pill ${filterCity === 'all' ? 'active' : ''}" data-city="all">All cities</div>
      ${cities.map(c => `<div class="exp-city-pill ${filterCity === c ? 'active' : ''}" data-city="${c}">${c}</div>`).join('')}
    </div>` : ''}
    <div class="exp-filter-row">
      <button class="exp-filter-btn ${filterCategory === 'all' ? 'active' : ''}" data-filter="all">All</button>
      ${CATEGORIES.map(c => `
        <button class="exp-filter-btn ${filterCategory === c.id ? 'active' : ''}" data-filter="${c.id}">${c.icon} ${c.label}</button>
      `).join('')}
    </div>
    ${list.length === 0 ? `
      <div class="empty-state">
        <div class="empty-icon">💸</div>
        <p>No expenses yet. Add your first one!</p>
      </div>
    ` : `
    <div class="exp-items">
      ${list.map(e => {
        const cat = CATEGORIES.find(c => c.id === e.category)!;
        const eurStr = e.currency !== 'EUR' ? ` · ${fmt(e.amountEur)}` : '';
        return `
          <div class="exp-item">
            <div class="exp-item-icon" style="background:${cat?.color ?? '#fde68a'}">${cat?.icon ?? '📌'}</div>
            <div class="exp-item-body">
              <div class="exp-item-desc">${e.description}</div>
              <div class="exp-item-meta">
                <span>${cat?.label}</span>
                <span>·</span>
                <span>${e.city}</span>
                <span>·</span>
                <span>${e.date}</span>
              </div>
            </div>
            <div class="exp-item-amount">${fmtFull(e.amount, e.currency)}${eurStr}</div>
            <button class="exp-item-delete" data-id="${e.id}">✕</button>
          </div>
        `;
      }).join('')}
    </div>`}
  `;

  el.querySelectorAll('.exp-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      filterCategory = (btn as HTMLElement).dataset.filter!;
      renderList(el);
    });
  });

  el.querySelectorAll('.exp-city-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      filterCity = (pill as HTMLElement).dataset.city!;
      renderList(el);
    });
  });

  el.querySelectorAll('.exp-item-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteExpense((btn as HTMLElement).dataset.id!));
  });
}

function renderBreakdown(el: HTMLElement) {
  const maxAmount = Math.max(...CATEGORIES.map(c =>
    expenses.filter(e => e.category === c.id).reduce((s, e) => s + e.amountEur, 0)
  ), 1);

  el.innerHTML = `
    <div class="exp-breakdown">
      <div class="exp-breakdown-title">By category</div>
      ${CATEGORIES.map(cat => {
        const catTotal = expenses.filter(e => e.category === cat.id).reduce((s, e) => s + e.amountEur, 0);
        const pct = (catTotal / maxAmount) * 100;
        if (catTotal === 0) return '';
        return `
          <div class="exp-cat-row">
            <div class="exp-cat-name">${cat.icon} ${cat.label}</div>
            <div class="exp-cat-bar-track">
              <div class="exp-cat-bar-fill" style="width:${pct}%;background:${cat.color === '#f3f4f6' ? '#d1d5db' : cat.color}"></div>
            </div>
            <div class="exp-cat-amount">${fmt(catTotal)}</div>
          </div>
        `;
      }).join('')}
      ${expenses.length === 0 ? '<p style="color:var(--ink-faint);font-size:13px;text-align:center;padding:16px 0">Add expenses to see breakdown</p>' : ''}
    </div>
  `;
}

function render() {
  const root = document.getElementById('view-expenses');
  if (!root) return;
  renderSummary(root.querySelector('.exp-summary')!);
  renderList(root.querySelector('.exp-list-wrap')!);
  renderBreakdown(root.querySelector('.exp-breakdown-wrap')!);
}

export function initExpenses() {
  load();
  const root = document.getElementById('view-expenses');
  if (!root) return;
  // Form is always rendered (not part of re-render cycle)
  renderForm(root.querySelector('.exp-form-wrap')!);
  render();
}
