/* ==========================================================================
   On the Road · Guide — one city, on any host element
   --------------------------------------------------------------------------
   The Guide page renders its city into its own `#view-cities` DOM. The
   Itinerary's side drawer wants the same guide without leaving the page, so
   this mounts a city's saved guide (header, tabs, the tab's cards) into
   whatever element it is given, using the Guide's own renderers. It only reads
   what has already been generated; making a guide stays on the Guide page.
   ========================================================================== */

import { cityStore, type StoredCityIntel } from '../../data/stores/city-store.ts';
import { slugId, escHtml } from '../../core/utils.ts';
import { t } from '../../core/i18n.ts';
import { TABS, tabLabel, renderTabContent, wireTabContent, setGuideTab, type TabKey } from './guide.ts';

/** Show `city`'s saved guide in `host`. Returns a function that stops listening.
 *  `onMissing` is called from the "no guide yet" state's button. */
export function mountGuideEmbed(host: HTMLElement, city: string, onMissing: () => void): () => void {
  const id = slugId(city);
  let tab: TabKey = 'intro';
  let intel: StoredCityIntel | undefined;

  const paint = () => {
    if (!intel) {
      // eslint-disable-next-line no-restricted-syntax -- audited: city escaped via escHtml; copy from i18n
      host.innerHTML = `
        <div class="rd-side-empty">
          <p>${escHtml(t('route.drawer.noGuide', { city }))}</p>
          <button type="button" class="btn btn-primary" data-act="make-guide">${escHtml(t('route.drawer.makeGuide'))}</button>
        </div>`;
      host.querySelector('[data-act="make-guide"]')?.addEventListener('click', onMissing);
      return;
    }
    const doc = intel;
    setGuideTab(tab);
    // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml; tab content comes from the Guide's own escaped renderers
    host.innerHTML = `
      <div class="guide-detail active">
        <div class="guide-tabs" role="tablist">
          ${TABS.map((x) => `
            <button class="guide-tab ${tab === x.key ? 'active' : ''} ${x.isDo ? 'tab-do' : 'tab-know'}" data-tab="${x.key}" role="tab">
              <span>${x.icon}</span><span class="guide-tab-label">${escHtml(tabLabel(x.key))}</span>
            </button>`).join('')}
        </div>
        <div class="guide-tab-content" id="guide-tab-content">${renderTabContent(doc)}</div>
      </div>`;
    const detail = host.querySelector<HTMLElement>('.guide-detail')!;
    detail.querySelectorAll<HTMLElement>('.guide-tab').forEach((el) => el.addEventListener('click', () => {
      tab = el.dataset.tab as TabKey;
      paint();
    }));
    wireTabContent(detail, doc);
  };

  const scroller = () => host.closest<HTMLElement>('.otr-drawer-body');
  return cityStore.subscribe((rows) => {
    intel = rows.find((r) => r.id === id);
    const top = scroller()?.scrollTop ?? 0;
    paint();
    const el = scroller();
    if (el) el.scrollTop = top;
  });
}
