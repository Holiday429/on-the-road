/* ==========================================================================
   On the Road · Atlas page
   --------------------------------------------------------------------------
   `#atlas` — the traveller's globe: every country on every trip, one for the
   whole account, sitting beside the passport. (One trip's route is `#map`.)

   Owns the route registration, the header, deep links and the language refresh;
   the globe itself is atlas.ts.
   ========================================================================== */

import '../map/map.css';   // shared chips, stat cards, zoom buttons, timeline (split out in P8.5)
import { renderViewTitleMarkup, consumeNavIntent, navigateTo } from '../../core/app.ts';
import { t, onLocaleChange } from '../../core/i18n.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { mountAtlas, type AtlasController } from './atlas.ts';

let _inited = false;
let _atlas: AtlasController | null = null;

function renderHeader(view: HTMLElement) {
  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml
  view.querySelector('.view-header')!.innerHTML = `
    <div class="view-title">${renderViewTitleMarkup('atlas', t('atlas.title'))}</div>
    <div class="view-subtitle">${esc(t('atlas.subtitle'))}</div>`;
}

/** Deep links — `navigateTo('atlas', { iso, tripId })`: open that country / filter to that trip. */
function applyIntent(): void {
  const i = consumeNavIntent('atlas');
  if (!i) return;
  if (i.tripId) _atlas?.filterTrip(i.tripId);
  if (i.iso) _atlas?.showCountry(i.iso);
}

export function initAtlas() {
  if (_inited) return; _inited = true;
  const view = document.getElementById('view-atlas'); if (!view) return;
  renderHeader(view);

  _atlas = mountAtlas(view.querySelector<HTMLElement>('.atlas-body')!, {
    // One trip's route lives on the Map page; it switches to the trip first.
    openRoute: (tripId) => void navigateTo('map', tripId ? { tripId } : undefined),
  });

  // Fresh mounts read the intent now; an already-mounted page is told by app.ts.
  applyIntent();
  window.addEventListener('otr:nav-intent', (e) => {
    if ((e as CustomEvent).detail?.view === 'atlas') applyIntent();
  });
  // Nothing should keep moving by itself while another page is showing.
  window.addEventListener('hashchange', () => _atlas?.setActive(window.location.hash === '#atlas'));

  onLocaleChange(() => { renderHeader(view); _atlas?.refreshText(); });
}
