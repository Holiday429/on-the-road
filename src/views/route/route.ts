/* ==========================================================================
   On the Road · Itinerary / Route
   ========================================================================== */

import './route.css';
import { DEFAULT_ROUTE_LEGS, loadStoredRouteLegs, ROUTE_STORAGE_KEY } from '../../data/default-route.ts';

interface Transport {
  type: 'flight' | 'train' | 'bus' | 'ferry';
  from: string;
  to: string;
  date: string;
  time?: string;
  duration?: string;
  price?: string;
  confirmed: boolean;
  notes?: string;
}

interface Accommodation {
  name: string;
  address?: string;
  price?: string;
  confirmed: boolean;
  link?: string;
}

interface Leg {
  id: string;
  city: string;
  country: string;
  flag: string;
  dateFrom: string;
  dateTo: string;
  accommodation?: Accommodation;
  arrivalTransport?: Transport;
  notes?: string;
}

const TRANSPORT_ICONS: Record<string, string> = {
  flight: '✈️', train: '🚆', bus: '🚌', ferry: '⛴️',
};

const FLAG_MAP: Record<string, string> = {
  'Denmark': '🇩🇰', 'Germany': '🇩🇪', 'Netherlands': '🇳🇱',
  'Belgium': '🇧🇪', 'France': '🇫🇷', 'Spain': '🇪🇸',
  'Portugal': '🇵🇹', 'Switzerland': '🇨🇭', 'Italy': '🇮🇹',
  'Austria': '🇦🇹', 'Czech Republic': '🇨🇿', 'Poland': '🇵🇱',
  'Hungary': '🇭🇺', 'Croatia': '🇭🇷', 'Greece': '🇬🇷',
};

const DEFAULT_LEGS: Leg[] = DEFAULT_ROUTE_LEGS;

let legs: Leg[] = [];
let addFormOpen = false;

function uid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function load() {
  const loaded = loadStoredRouteLegs<Leg>(DEFAULT_LEGS);
  legs = loaded.legs;
  if (!loaded.fromStorage) save();
}

function save() { localStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify(legs)); }

function daysBetween(from: string, to: string): number {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000);
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function deleteLeg(id: string) {
  if (!confirm('Remove this stop from the itinerary?')) return;
  legs = legs.filter(l => l.id !== id);
  save();
  render();
}

function addLeg(city: string, country: string, dateFrom: string, dateTo: string,
                transportType: string, transportFrom: string, accomName: string) {
  const newLeg: Leg = {
    id: uid(), city, country,
    flag: FLAG_MAP[country] ?? '🗺️',
    dateFrom, dateTo,
  };
  if (transportType && transportFrom) {
    newLeg.arrivalTransport = {
      type: transportType as Transport['type'],
      from: transportFrom, to: city, date: dateFrom,
      confirmed: false,
    };
  }
  if (accomName) {
    newLeg.accommodation = { name: accomName, confirmed: false };
  }
  legs.push(newLeg);
  legs.sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
  save();
  addFormOpen = false;
  render();
}

function renderLeg(leg: Leg): string {
  const days = daysBetween(leg.dateFrom, leg.dateTo);
  const t = leg.arrivalTransport;
  const a = leg.accommodation;

  return `
    <div class="route-leg" data-id="${leg.id}">
      <div class="route-leg-dot"></div>
      <div class="route-leg-card">
        <div class="route-leg-header">
          <div class="route-leg-flag">${leg.flag}</div>
          <div class="route-leg-info">
            <div class="route-leg-city">${leg.city}</div>
            <div class="route-leg-country">${leg.country}</div>
          </div>
          <div class="route-leg-dates">
            <div>${fmtDate(leg.dateFrom)} → ${fmtDate(leg.dateTo)}</div>
            <div class="route-leg-duration">${days} night${days !== 1 ? 's' : ''}</div>
          </div>
          <button class="task-action-btn delete-leg" data-id="${leg.id}" title="Remove" style="margin-left:8px">✕</button>
        </div>
        ${(t || a || leg.notes) ? `
        <div class="route-leg-body">
          <div>
            ${t ? `
            <div class="route-leg-section-title">Getting there</div>
            <div class="transport-node">
              <div class="transport-icon">${TRANSPORT_ICONS[t.type]}</div>
              <div class="transport-info">
                <div class="transport-label">${t.from} → ${t.to}</div>
                <div class="transport-detail">
                  ${t.date} ${t.time ? `· ${t.time}` : ''} ${t.duration ? `· ${t.duration}` : ''} ${t.price ? `· ${t.price}` : ''}
                </div>
              </div>
              <span class="transport-confirmed badge ${t.confirmed ? 'badge-green' : 'badge-gray'}">
                ${t.confirmed ? '✓ Booked' : 'Not booked'}
              </span>
            </div>` : ''}
            ${leg.notes ? `<div style="font-size:var(--fs-sm);color:var(--ink-muted);margin-top:8px;font-style:italic">${leg.notes}</div>` : ''}
          </div>
          <div>
            ${a ? `
            <div class="route-leg-section-title">Accommodation</div>
            <div class="accom-card">
              <div class="accom-name">${a.name}</div>
              <div class="accom-meta">
                ${a.address ? `<span>📍 ${a.address}</span>` : ''}
                ${a.price ? `<span>💰 ${a.price}/night</span>` : ''}
                <span class="badge ${a.confirmed ? 'badge-green' : 'badge-gray'}" style="font-size:11px">
                  ${a.confirmed ? '✓ Confirmed' : 'Not confirmed'}
                </span>
              </div>
            </div>` : `
            <div class="route-leg-section-title">Accommodation</div>
            <div class="accom-card" style="border-style:dashed;color:var(--ink-muted)">
              <div style="font-size:var(--fs-sm)">Not added yet</div>
            </div>`}
          </div>
        </div>` : ''}
      </div>
    </div>
  `;
}

function renderAddForm(): string {
  return `
    <div class="route-add-form ${addFormOpen ? 'open' : ''}" id="route-add-form">
      <div class="route-add-form-title">Add a stop</div>
      <div class="route-add-form-grid">
        <div class="field-full">
          <label class="field-label">City</label>
          <input class="input" id="raf-city" placeholder="e.g. Prague">
        </div>
        <div>
          <label class="field-label">Country</label>
          <input class="input" id="raf-country" placeholder="e.g. Czech Republic">
        </div>
        <div>
          <label class="field-label">Arrival date</label>
          <input class="input" type="date" id="raf-from">
        </div>
        <div>
          <label class="field-label">Departure date</label>
          <input class="input" type="date" id="raf-to">
        </div>
        <div>
          <label class="field-label">Transport type</label>
          <select class="input select" id="raf-transport">
            <option value="">None</option>
            <option value="train">🚆 Train</option>
            <option value="flight">✈️ Flight</option>
            <option value="bus">🚌 Bus</option>
            <option value="ferry">⛴️ Ferry</option>
          </select>
        </div>
        <div>
          <label class="field-label">Coming from</label>
          <input class="input" id="raf-from-city" placeholder="e.g. Vienna">
        </div>
        <div class="field-full">
          <label class="field-label">Accommodation name</label>
          <input class="input" id="raf-accom" placeholder="e.g. Generator Hostel">
        </div>
      </div>
      <div class="route-add-form-btns">
        <button class="btn btn-ghost" id="raf-cancel">Cancel</button>
        <button class="btn btn-primary" id="raf-save">Add stop</button>
      </div>
    </div>
  `;
}

function render() {
  const root = document.getElementById('view-route');
  if (!root) return;

  const timeline = root.querySelector<HTMLElement>('.route-timeline')!;

  timeline.innerHTML = `
    ${renderAddForm()}
    ${legs.map(renderLeg).join('')}
    <div style="position:relative;padding-left:48px">
      <button class="route-add-btn" id="route-add-toggle">
        <span style="font-size:20px">＋</span>
        Add a stop
      </button>
    </div>
  `;

  // Events
  timeline.querySelector('#route-add-toggle')?.addEventListener('click', () => {
    addFormOpen = true;
    render();
    timeline.querySelector('#route-add-form')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  timeline.querySelector('#raf-cancel')?.addEventListener('click', () => {
    addFormOpen = false;
    render();
  });

  timeline.querySelector('#raf-save')?.addEventListener('click', () => {
    const city = (timeline.querySelector('#raf-city') as HTMLInputElement).value;
    const country = (timeline.querySelector('#raf-country') as HTMLInputElement).value;
    const from = (timeline.querySelector('#raf-from') as HTMLInputElement).value;
    const to = (timeline.querySelector('#raf-to') as HTMLInputElement).value;
    const tType = (timeline.querySelector('#raf-transport') as HTMLSelectElement).value;
    const tFrom = (timeline.querySelector('#raf-from-city') as HTMLInputElement).value;
    const accom = (timeline.querySelector('#raf-accom') as HTMLInputElement).value;
    if (!city || !from || !to) { alert('Please fill in city and dates.'); return; }
    addLeg(city, country, from, to, tType, tFrom, accom);
  });

  timeline.querySelectorAll('.delete-leg').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteLeg((btn as HTMLElement).dataset.id!);
    });
  });
}

export function initRoute() {
  load();
  render();
}
