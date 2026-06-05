/* ==========================================================================
   On the Road · Trip Chooser — shared modal for all "Link a trip" surfaces
   --------------------------------------------------------------------------
   Call openTripChooser() from any view that needs trip selection.
   On confirm the chooser calls switchTrip and shows a success toast —
   the view re-renders automatically via onTripChange.
   ========================================================================== */

import './trip-chooser.css';
import { currentTripId, listTrips, switchTrip, type StoredTrip } from '../data/trip-context.ts';

export interface TripChooserOptions {
  /** Shown as the modal headline. Default: "Choose a trip" */
  title?: string;
  /** Short line below the title. */
  subtitle?: string;
}

function esc(s: string): string {
  return (s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!
  ));
}

/* ── Toast ─────────────────────────────────────────────────────────────────── */

export function showTripToast(tripName: string) {
  document.querySelector('.tc-toast')?.remove();
  const el = document.createElement('div');
  el.className = 'tc-toast';
  el.innerHTML = `<span class="tc-toast-check">✓</span> Switched to <strong>${esc(tripName)}</strong>`;
  document.body.appendChild(el);
  // Force reflow so the CSS transition fires.
  requestAnimationFrame(() => el.classList.add('tc-toast--visible'));
  setTimeout(() => {
    el.classList.remove('tc-toast--visible');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
  }, 2800);
}

/* ── Chooser modal ──────────────────────────────────────────────────────────── */

export async function openTripChooser(opts: TripChooserOptions = {}) {
  const {
    title = 'Choose a trip',
    subtitle = 'Linking a trip connects its itinerary stops, stays, and map to this view.',
  } = opts;

  // Close any existing chooser first.
  document.getElementById('tc-backdrop')?.remove();

  let trips: StoredTrip[] = [];
  try { trips = await listTrips(); } catch { /* offline — show empty state */ }

  const activeId = currentTripId();

  const tripRows = trips.map((t) => `
    <button class="tc-trip-row${t.id === activeId ? ' is-active' : ''}" data-id="${esc(t.id)}" type="button">
      <span class="tc-trip-dot" style="background:${esc(t.coverColor || '#f9b830')}"></span>
      <span class="tc-trip-name">${esc(t.name)}</span>
      <span class="tc-trip-dates">${t.startDate ? `${t.startDate.slice(0, 7)}` : ''}</span>
      ${t.id === activeId ? '<span class="tc-trip-check">✓</span>' : ''}
    </button>`).join('');

  const backdrop = document.createElement('div');
  backdrop.id = 'tc-backdrop';
  backdrop.className = 'trip-modal-backdrop';
  backdrop.innerHTML = `
    <div class="trip-modal tc-modal" role="dialog" aria-modal="true" aria-labelledby="tc-title">
      <div class="tc-header">
        <div>
          <h2 class="trip-modal-title" id="tc-title">${esc(title)}</h2>
          ${subtitle ? `<p class="trip-modal-subtitle">${esc(subtitle)}</p>` : ''}
        </div>
        <button class="tc-close" type="button" aria-label="Close">✕</button>
      </div>

      ${trips.length ? `
        <div class="tc-trip-list">${tripRows}</div>
      ` : `
        <div class="tc-empty">
          <div class="tc-empty-icon">🗺️</div>
          <div class="tc-empty-text">No trips yet. Create one to get started.</div>
        </div>
      `}

      <div class="tc-footer">
        <button class="btn btn-ghost tc-new-btn" type="button" id="tc-new-trip">＋ New trip</button>
      </div>
    </div>`;

  document.body.appendChild(backdrop);

  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  const close = () => {
    window.removeEventListener('keydown', onKey);
    backdrop.remove();
  };

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector('.tc-close')?.addEventListener('click', close);
  window.addEventListener('keydown', onKey);

  // Trip row click → switch + toast.
  backdrop.querySelectorAll<HTMLElement>('.tc-trip-row').forEach((row) => {
    row.addEventListener('click', async () => {
      const id = row.dataset.id!;
      if (id === currentTripId()) {
        // Already active — just close with a subtle confirmation.
        close();
        const trip = trips.find((t) => t.id === id);
        if (trip) showTripToast(trip.name);
        return;
      }
      // Mark as loading.
      row.classList.add('is-loading');
      row.setAttribute('aria-busy', 'true');
      try {
        await switchTrip(id);
        close();
        const trip = trips.find((t) => t.id === id);
        if (trip) showTripToast(trip.name);
      } catch {
        row.classList.remove('is-loading');
        row.removeAttribute('aria-busy');
      }
    });
  });

  // New trip shortcut: open the existing new-trip modal from app.ts.
  backdrop.querySelector('#tc-new-trip')?.addEventListener('click', () => {
    close();
    const newBtn = document.getElementById('trip-menu-new') as HTMLElement | null;
    if (newBtn) { newBtn.click(); }
    else { document.getElementById('trip-pill')?.click(); }
  });
}
