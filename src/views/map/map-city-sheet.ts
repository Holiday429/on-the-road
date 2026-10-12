/* ==========================================================================
   On the Road · Map — city action sheet
   --------------------------------------------------------------------------
   Tapping a city pin opens this bottom sheet to pick where to dive in
   (Guide / Safety / Itinerary). Split out of map.ts to keep it under its
   max-lines ratchet.
   ========================================================================== */

import { navigateTo } from '../../core/app.ts';
import { openSheet } from '../../core/modal.ts';
import { t } from '../../core/i18n.ts';

/* ── City action sheet (Guide / Safety / Itinerary) — pick where to dive in ── */
export function openCityActionSheet(city: string): void {
  const m = openSheet({
    title: city,
    body: `
      <button class="map-sheet-action" data-go="cities">
        <span class="map-sheet-icon">🗺️</span>
        <span><strong>${t('map.sheet.guide')}</strong><small>${t('map.sheet.guideHint')}</small></span>
        <span class="map-sheet-arrow">›</span>
      </button>
      <button class="map-sheet-action" data-go="safety">
        <span class="map-sheet-icon">🛡️</span>
        <span><strong>${t('map.sheet.safety')}</strong><small>${t('map.sheet.safetyHint')}</small></span>
        <span class="map-sheet-arrow">›</span>
      </button>
      <button class="map-sheet-action" data-go="route">
        <span class="map-sheet-icon">🧭</span>
        <span><strong>${t('map.sheet.itinerary')}</strong><small>${t('map.sheet.itineraryHint')}</small></span>
        <span class="map-sheet-arrow">›</span>
      </button>`,
  });

  m.root.querySelectorAll<HTMLElement>('.map-sheet-action').forEach((btn) => {
    btn.addEventListener('click', () => {
      // 'safety' is now Guide's Safety tab, not its own view — route there too.
      const go = btn.dataset.go as 'cities' | 'safety' | 'route';
      m.close();
      navigateTo(go === 'safety' ? 'cities' : go);
      if (go === 'cities' || go === 'safety') {
        setTimeout(() => import('../guide/guide.ts').then(({ openGuideCity }) =>
          openGuideCity(city, go === 'safety' ? 'safety' : undefined)), 80);
      }
    });
  });
}
