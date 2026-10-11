/* ==========================================================================
   On the Road · Dashboard — journal album drawer
   --------------------------------------------------------------------------
   The Journal page's Albums view, shown in the side drawer. It runs the real
   capture controller (its own instance, so it doesn't disturb the Journal page)
   switched to the albums view: your albums, AI tidy suggestions, tag groups, the
   album detail, the entry reader — all the page's own behaviour, fed live from
   the stores for as long as the drawer is open.

   Loaded on demand: the capture module pulls in Leaflet, the AI-tidy client and
   the card exporter, none of which the Dashboard should carry up front.
   ========================================================================== */

import '../journal/journal.css';
import { openDrawer } from '../../core/drawer.ts';
import { t } from '../../core/i18n.ts';
import { journalStore, type StoredJournalEntry } from '../../data/stores/journal-store.ts';
import { journalAlbumStore, type StoredJournalAlbum } from '../../data/stores/journal-album-store.ts';
import { routeStore, type StoredLeg } from '../../data/stores/route-store.ts';

export async function openJournalAlbumDrawer(trigger: HTMLElement | null): Promise<void> {
  const { createCaptureController } = await import('../journal/capture/capture.ts');

  let entries: StoredJournalEntry[] = journalStore.peek();
  let legs: StoredLeg[] = routeStore.peek();
  let albums: StoredJournalAlbum[] = journalAlbumStore.peek();
  let host: HTMLElement | null = null;
  const unsubs: Array<() => void> = [];

  const ctl = createCaptureController({
    getEntries: () => entries,
    getLegs: () => legs,
    getAlbums: () => albums,
    requestRender: () => paint(),
  });

  function paint(): void {
    if (!host) return;
    // eslint-disable-next-line no-restricted-syntax -- audited: the capture renderer escapes its interpolations (same markup the Journal page paints)
    host.innerHTML = ctl.render();
    ctl.afterRender(host);
  }

  const d = openDrawer({
    title: `📔 ${t('dash.journal.albums')}`,
    body: '<div class="jr-album-host"></div>',
    className: 'jr-album-drawer',
    returnFocus: trigger,
    onClose: () => { unsubs.forEach((u) => u()); },
  });
  host = d.body.querySelector<HTMLElement>('.jr-album-host');
  if (!host) return;

  ctl.bind(host);
  paint();
  // The controller switches views by delegated click on [data-journal-view]; use
  // the same door rather than reaching into its state.
  const door = document.createElement('button');
  door.hidden = true;
  door.dataset.journalView = 'albums';
  host.appendChild(door);
  door.click();

  unsubs.push(
    journalStore.subscribe((rows) => { entries = rows; ctl.handleDataChange(); paint(); }),
    journalAlbumStore.subscribe((rows) => { albums = rows; ctl.handleDataChange(); paint(); }),
    routeStore.subscribe((rows) => { legs = rows; ctl.handleDataChange(); paint(); }),
  );
}
