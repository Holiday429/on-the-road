/* ==========================================================================
   On the Road · Onboarding — full-page first-trip creation
   ========================================================================== */

import './onboarding.css';
import { createTrip, switchTrip, type NewTripInput } from '../../data/trip-context.ts';
import { retagLegacyData } from '../../data/migrate-retag.ts';
import { createDestinationInput } from '../../core/destination-input.ts';
import { TRAVEL_STYLES, type TravelStyle } from '../../data/schema.ts';
import logoGif from '../../../assets/logo.gif';

const STYLE_META: Record<TravelStyle, { icon: string; label: string }> = {
  solo:    { icon: '🧍', label: 'Solo'    },
  couple:  { icon: '👫', label: 'Couple'  },
  family:  { icon: '👨‍👩‍👧', label: 'Family'  },
  friends: { icon: '🧑‍🤝‍🧑', label: 'Friends' },
  group:   { icon: '👥', label: 'Group'   },
};

const COVER_COLORS = ['#f9b830', '#e07b54', '#5b9bd5', '#6abf69', '#9b7dd4', '#e05c7a'];

export function showOnboarding(onDone: () => void): void {
  const screen = document.getElementById('onboarding-screen');
  if (!screen) return;

  // ── State ────────────────────────────────────────────────────────────────
  let selectedStyle: TravelStyle | null = null;
  let selectedColor = COVER_COLORS[0];
  let destPicker: ReturnType<typeof createDestinationInput> | null = null;

  // ── Render ───────────────────────────────────────────────────────────────
  screen.innerHTML = `
    <div class="ob-card">

      <div class="ob-header">
        <h1 class="ob-title">Plan your first trip</h1>
        <button type="button" class="ob-close" id="ob-close" aria-label="Skip for now">✕</button>
      </div>

      <div class="ob-body">

        <div class="ob-col-left">
          <div class="ob-field">
            <label class="ob-label" for="ob-name">Trip name</label>
            <input id="ob-name" class="input" placeholder="e.g. Europe Summer 2026" autocomplete="off">
          </div>

          <div class="ob-field">
            <label class="ob-label">Travel dates</label>
            <div class="ob-row">
              <div class="ob-subfield">
                <label class="ob-sublabel" for="ob-start">Start date</label>
                <input id="ob-start" class="input" type="date">
              </div>
              <div class="ob-subfield">
                <label class="ob-sublabel" for="ob-end">End date</label>
                <input id="ob-end" class="input" type="date">
              </div>
            </div>
          </div>

          <div class="ob-field">
            <label class="ob-label">Destinations <span class="ob-label-opt">(optional)</span></label>
            <div id="ob-dest-mount" class="ob-dest-wrap"></div>
          </div>

          <div class="ob-field">
            <label class="ob-label">Travelling as <span class="ob-label-opt">(optional)</span></label>
            <div class="ob-style-group" id="ob-style-group">
              ${TRAVEL_STYLES.map(s => `
                <button type="button" class="ob-style-btn" data-style="${s}">
                  <span class="ob-style-icon">${STYLE_META[s].icon}</span>
                  ${STYLE_META[s].label}
                </button>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="ob-col-right">
          <div class="ob-field">
            <label class="ob-label" for="ob-currency">Base currency</label>
            <input id="ob-currency" class="input" value="EUR" maxlength="3" style="text-transform:uppercase">
          </div>

          <div class="ob-field">
            <label class="ob-label">Cover colour</label>
            <div class="ob-color-frame">
              <div class="ob-colors" id="ob-colors">
                ${COVER_COLORS.map(c => `
                  <button type="button" class="ob-color-swatch${c === selectedColor ? ' is-active' : ''}"
                    data-color="${c}" style="background:${c}" aria-label="Colour ${c}"></button>
                `).join('')}
              </div>
            </div>
          </div>

          <div class="ob-field">
            <label class="ob-label" for="ob-notes">Notes <span class="ob-label-opt">(optional)</span></label>
            <textarea id="ob-notes" class="input ob-notes-area" placeholder="What's the vibe? Any goals for this trip?" rows="4"></textarea>
          </div>
        </div>

      </div>

      <div class="ob-footer-rail" aria-hidden="true">
        <div class="ob-divider"></div>
        <div class="ob-walker-lane">
          <img src="${logoGif}" class="ob-walker-gif" alt="">
        </div>
      </div>

      <div class="ob-footer">
        <span class="ob-error" id="ob-error"></span>
        <button class="btn btn-primary ob-submit-btn" id="ob-submit">
          Let's go →
        </button>
      </div>

    </div>
  `;

  screen.removeAttribute('hidden');

  // ── Mount destination picker ─────────────────────────────────────────────
  const destMount = screen.querySelector<HTMLElement>('#ob-dest-mount')!;
  destPicker = createDestinationInput({
    container: destMount,
    placeholder: 'Search countries or cities…',
  });

  // ── Travel style pills ───────────────────────────────────────────────────
  screen.querySelector('#ob-style-group')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.ob-style-btn');
    if (!btn) return;
    const s = btn.dataset.style as TravelStyle;
    selectedStyle = selectedStyle === s ? null : s;
    screen.querySelectorAll('.ob-style-btn').forEach(b =>
      b.classList.toggle('is-active', (b as HTMLElement).dataset.style === selectedStyle)
    );
  });

  // ── Colour swatches ──────────────────────────────────────────────────────
  screen.querySelector('#ob-colors')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-color]');
    if (!btn) return;
    selectedColor = btn.dataset.color!;
    screen.querySelectorAll<HTMLElement>('.ob-color-swatch').forEach(b =>
      b.classList.toggle('is-active', b.dataset.color === selectedColor)
    );
  });

  // ── Close (skip) ─────────────────────────────────────────────────────────
  screen.querySelector('#ob-close')?.addEventListener('click', () => {
    screen.setAttribute('hidden', '');
    destPicker?.destroy();
    onDone();
  });

  // ── Submit ───────────────────────────────────────────────────────────────
  const errorEl = screen.querySelector<HTMLElement>('#ob-error')!;
  const submitBtn = screen.querySelector<HTMLButtonElement>('#ob-submit')!;

  submitBtn.addEventListener('click', async () => {
    const name         = (screen.querySelector<HTMLInputElement>('#ob-name')!).value.trim();
    const startDate    = (screen.querySelector<HTMLInputElement>('#ob-start')!).value;
    const endDate      = (screen.querySelector<HTMLInputElement>('#ob-end')!).value;
    const baseCurrency = (screen.querySelector<HTMLInputElement>('#ob-currency')!).value.trim().toUpperCase() || 'EUR';
    const notes        = (screen.querySelector<HTMLTextAreaElement>('#ob-notes')!).value.trim() || undefined;
    const destinations = destPicker?.getValues() ?? [];

    errorEl.textContent = '';

    if (!name) { errorEl.textContent = 'Trip name is required.'; return; }
    if (!startDate || !endDate) { errorEl.textContent = 'Start and end dates are required.'; return; }
    if (endDate < startDate) { errorEl.textContent = 'End date must be after start date.'; return; }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating…';

    const input: NewTripInput = {
      name, startDate, endDate, baseCurrency,
      coverColor: selectedColor,
      travelStyle: selectedStyle ?? undefined,
      destinations: destinations.length > 0 ? destinations : undefined,
      notes,
    };

    try {
      const id = await createTrip(input);
      await switchTrip(id);
      try {
        const n = await retagLegacyData(id);
        if (n > 0) console.info(`Re-tagged ${n} legacy docs to trip ${id}.`);
      } catch (e) {
        console.warn('Legacy retag skipped:', e);
      }
      screen.setAttribute('hidden', '');
      destPicker?.destroy();
      onDone();
    } catch (e) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Let\'s go →';
      errorEl.textContent = e instanceof Error ? e.message : 'Could not create trip.';
    }
  });

  screen.querySelector<HTMLInputElement>('#ob-name')?.focus();
}
