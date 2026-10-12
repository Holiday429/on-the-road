/* ==========================================================================
   On the Road · Google Maps export sheet
   --------------------------------------------------------------------------
   Shared bottom sheet used by the Map, Itinerary and Guide views. The caller
   supplies scopes (whole trip / a city / a day / a walk); the sheet turns the
   chosen scope into Google Maps directions links, split into segments when a
   route is too long for one URL.
   ========================================================================== */

import './export-sheet.css';
import { openSheet } from './modal.ts';
import { escHtml, safeUrl } from './utils.ts';
import { t as tr } from './i18n.ts';
import { buildDeepLinks, type TravelMode } from '../data/maps-deeplink.ts';
import { groupsPlaces, type ExportScope } from '../data/places-export.ts';

type RouteMode = 'perGroup' | 'oneRoute';

export interface ExportSheetOptions {
  title: string;
  scopes: ExportScope[];
  /** Pre-select this scope id (falls back to the first). */
  initialScope?: string;
  /** Initial travel mode; undefined = let Google choose. */
  travelMode?: TravelMode;
  /** Initial grouping; defaults to one link set per day/group. */
  routeMode?: RouteMode;
}

const TRAVEL_MODES: Array<[TravelMode | '', string]> = [
  ['', 'export.auto'], ['walking', 'export.walking'], ['transit', 'export.transit'],
  ['driving', 'export.driving'], ['bicycling', 'export.cycling'],
];

const scopeLabel = (s: ExportScope) => (s.id === 'trip' ? tr('export.wholeTrip') : s.label);

function resultsMarkup(scope: ExportScope | undefined, mode: RouteMode, travelMode?: TravelMode): string {
  if (!scope) return `<p class="mx-empty">${escHtml(tr('export.empty'))}</p>`;

  const sets = mode === 'oneRoute'
    ? [{ title: scopeLabel(scope), places: groupsPlaces(scope.groups) }]
    : scope.groups.map(g => ({ title: g.title, places: g.places }));

  const skippedAll: string[] = [];
  const blocks = sets.map(set => {
    const { segments, skipped } = buildDeepLinks(set.places, { travelMode });
    skippedAll.push(...skipped.map(p => p.name || '(unnamed)'));
    if (!segments.length) return '';
    const rows = segments.map((seg, i) => {
      const label = segments.length > 1
        ? tr('export.part', { i: i + 1, n: segments.length, c: seg.count })
        : seg.count === 1 ? tr('export.openPlace') : tr('export.stops', { c: seg.count });
      return `
        <div class="mx-row">
          <a class="mx-link" href="${safeUrl(seg.url)}" target="_blank" rel="noopener">${escHtml(label)} ↗</a>
          <button type="button" class="mx-copy" data-url="${safeUrl(seg.url)}">${escHtml(tr('export.copy'))}</button>
        </div>`;
    }).join('');
    return `<div class="mx-block"><div class="mx-block-title">${escHtml(set.title)}</div>${rows}</div>`;
  }).join('');

  const skippedNote = skippedAll.length
    ? `<p class="mx-warn">${escHtml(tr('export.skipped', { n: skippedAll.length, names: skippedAll.join(', ') }))}</p>`
    : '';
  return (blocks || `<p class="mx-empty">${escHtml(tr('export.noLinks'))}</p>`) + skippedNote;
}

export function openExportSheet(opts: ExportSheetOptions): void {
  const { title, scopes } = opts;
  let scopeId = scopes.find(s => s.id === opts.initialScope)?.id ?? scopes[0]?.id;
  let mode: RouteMode = opts.routeMode ?? 'perGroup';
  let travel: TravelMode | undefined = opts.travelMode;

  const scopeSelect = scopes.length > 1
    ? `<label class="mx-field"><span>${escHtml(tr('export.scope'))}</span>
         <select class="input" data-mx="scope">
           ${scopes.map(s => `<option value="${escHtml(s.id)}"${s.id === scopeId ? ' selected' : ''}>${escHtml(scopeLabel(s))}</option>`).join('')}
         </select></label>`
    : '';

  const m = openSheet({
    title,
    className: 'mx-sheet',
    body: `
      <p class="mx-hint">${escHtml(tr('export.hint'))}</p>
      ${scopeSelect}
      <div class="mx-field-row">
        <label class="mx-field"><span>${escHtml(tr('export.links'))}</span>
          <select class="input" data-mx="mode">
            <option value="perGroup"${mode === 'perGroup' ? ' selected' : ''}>${escHtml(tr('export.perGroup'))}</option>
            <option value="oneRoute"${mode === 'oneRoute' ? ' selected' : ''}>${escHtml(tr('export.oneRoute'))}</option>
          </select></label>
        <label class="mx-field"><span>${escHtml(tr('export.travel'))}</span>
          <select class="input" data-mx="travel">
            ${TRAVEL_MODES.map(([v, l]) => `<option value="${v}"${(travel ?? '') === v ? ' selected' : ''}>${escHtml(tr(l))}</option>`).join('')}
          </select></label>
      </div>
      <div class="mx-results" data-mx="results"></div>`,
  });

  const results = m.root.querySelector<HTMLElement>('[data-mx="results"]')!;
  const render = () => {
    // eslint-disable-next-line no-restricted-syntax -- audited: labels via escHtml, hrefs via safeUrl
    results.innerHTML = resultsMarkup(scopes.find(s => s.id === scopeId), mode, travel);
  };
  render();

  m.root.querySelector('[data-mx="scope"]')?.addEventListener('change', (e) => {
    scopeId = (e.target as HTMLSelectElement).value; render();
  });
  m.root.querySelector('[data-mx="mode"]')?.addEventListener('change', (e) => {
    mode = (e.target as HTMLSelectElement).value as RouteMode; render();
  });
  m.root.querySelector('[data-mx="travel"]')?.addEventListener('change', (e) => {
    travel = ((e.target as HTMLSelectElement).value || undefined) as TravelMode | undefined; render();
  });
  results.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.mx-copy');
    if (!btn) return;
    try {
      await navigator.clipboard.writeText(btn.dataset.url ?? '');
      btn.textContent = tr('export.copied');
    } catch {
      btn.textContent = tr('export.copyFailed');
    }
    setTimeout(() => { btn.textContent = tr('export.copy'); }, 1600);
  });
}
