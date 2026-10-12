/* ==========================================================================
   On the Road · Google Maps export sheet
   --------------------------------------------------------------------------
   Shared bottom sheet used by the Map, Itinerary and Guide views. The caller
   supplies scopes (whole trip / a city / a day / a walk); the sheet turns the
   chosen scope into either
     · Google Maps directions links (split into parts when a route is too long
       for one URL), or
     · a KML (Google My Maps) / GPX file, after filling in missing coordinates.
   ========================================================================== */

import './export-sheet.css';
import { openSheet } from './modal.ts';
import { escHtml, safeUrl } from './utils.ts';
import { t as tr } from './i18n.ts';
import { downloadTextFile, fileStem } from './export-files.ts';
import { geocode, geocodeLocal } from '../views/map/geocode.ts';
import { buildDeepLinks, type TravelMode } from '../data/maps-deeplink.ts';
import { groupsPlaces, hasCoords, textQuery, type ExportScope } from '../data/places-export.ts';
import { completeGroupCoords } from '../data/places-coords.ts';
import { buildKml, MY_MAPS_MAX_LAYERS, type KmlLayout } from '../data/kml-export.ts';
import { buildGpx } from '../data/gpx-export.ts';

type RouteMode = 'perGroup' | 'oneRoute';
type Format = 'links' | 'kml' | 'gpx';

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
const FORMATS: Array<[Format, string]> = [
  ['links', 'export.fmtLinks'], ['kml', 'export.fmtKml'], ['gpx', 'export.fmtGpx'],
];
const NOMINATIM_GAP_S = 1.1;

const scopeLabel = (s: ExportScope) => (s.id === 'trip' ? tr('export.wholeTrip') : s.label);
const option = (value: string, label: string, selected: boolean) =>
  `<option value="${escHtml(value)}"${selected ? ' selected' : ''}>${escHtml(label)}</option>`;

/* ── Links ────────────────────────────────────────────────────────────────── */

function linksMarkup(scope: ExportScope, mode: RouteMode, travelMode?: TravelMode): string {
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

/* ── Files (KML / GPX) ────────────────────────────────────────────────────── */

const defaultLayout = (scope: ExportScope): KmlLayout =>
  scope.groups.length > MY_MAPS_MAX_LAYERS ? 'flat' : 'perGroup';

function fileMarkup(scope: ExportScope, format: 'kml' | 'gpx', layout: KmlLayout): string {
  const needLookup = groupsPlaces(scope.groups)
    .filter(p => !hasCoords(p) && textQuery(p) && !geocodeLocal(textQuery(p))).length;
  const parts = [
    format === 'kml' ? `<p class="mx-hint">${escHtml(tr('export.kmlHowTo'))}</p>` : '',
    format === 'kml' && layout === 'perGroup' && scope.groups.length > MY_MAPS_MAX_LAYERS
      ? `<p class="mx-warn">${escHtml(tr('export.layerWarn', { n: scope.groups.length }))}</p>` : '',
    needLookup
      ? `<p class="mx-hint">${escHtml(tr('export.estimate', { n: needLookup, s: Math.ceil(needLookup * NOMINATIM_GAP_S) }))}</p>` : '',
    `<button type="button" class="btn btn-primary" data-mx="make">${escHtml(tr('export.makeFile', { ext: format }))}</button>`,
    '<p class="mx-status" data-mx="status" aria-live="polite"></p>',
  ];
  return parts.join('');
}

async function makeFile(
  scope: ExportScope, format: 'kml' | 'gpx', layout: KmlLayout,
  root: HTMLElement, signal: AbortSignal,
): Promise<void> {
  const btn = root.querySelector<HTMLButtonElement>('[data-mx="make"]')!;
  const status = root.querySelector<HTMLElement>('[data-mx="status"]')!;
  btn.disabled = true;
  try {
    const done = await completeGroupCoords(scope.groups, {
      geocoder: async (q) => { const h = await geocode(q); return h ? { lat: h.lat, lng: h.lng } : null; },
      onProgress: ({ done: d, total }) => {
        status.textContent = total ? tr('export.finding', { done: d, total }) : '';
      },
      signal,
    });
    if (done.aborted) return;

    const name = scopeLabel(scope);
    const file = format === 'kml'
      ? buildKml(done.groups, { name, layout })
      : buildGpx(done.groups, { name });
    if (!file.included) { status.textContent = tr('export.fileNone'); return; }

    downloadTextFile(
      `${fileStem(name)}.${format}`,
      format === 'kml' ? 'application/vnd.google-earth.kml+xml' : 'application/gpx+xml',
      file.content,
    );
    const note = file.skipped.length
      ? ` ${tr('export.skippedLoc', { n: file.skipped.length, names: file.skipped.map(p => p.name || '(unnamed)').join(', ') })}`
      : '';
    status.textContent = tr('export.fileDone', { n: file.included }) + note;
  } finally {
    btn.disabled = false;
  }
}

/* ── Sheet ────────────────────────────────────────────────────────────────── */

export function openExportSheet(opts: ExportSheetOptions): void {
  const { title, scopes } = opts;
  let scopeId = scopes.find(s => s.id === opts.initialScope)?.id ?? scopes[0]?.id;
  let format: Format = 'links';
  let mode: RouteMode = opts.routeMode ?? 'perGroup';
  let travel: TravelMode | undefined = opts.travelMode;
  let layout: KmlLayout | null = null;   // null = automatic (flat when too many groups)
  let job: AbortController | null = null;

  const m = openSheet({
    title,
    className: 'mx-sheet',
    onClose: () => job?.abort(),
    body: `
      <p class="mx-hint">${escHtml(tr('export.hint'))}</p>
      ${scopes.length > 1 ? `
      <label class="mx-field"><span>${escHtml(tr('export.scope'))}</span>
        <select class="input" data-mx="scope">
          ${scopes.map(s => option(s.id, scopeLabel(s), s.id === scopeId)).join('')}
        </select></label>` : ''}
      <label class="mx-field"><span>${escHtml(tr('export.format'))}</span>
        <select class="input" data-mx="format">
          ${FORMATS.map(([v, l]) => option(v, tr(l), v === format)).join('')}
        </select></label>
      <div class="mx-field-row" data-for="links">
        <label class="mx-field"><span>${escHtml(tr('export.links'))}</span>
          <select class="input" data-mx="mode">
            ${option('perGroup', tr('export.perGroup'), mode === 'perGroup')}
            ${option('oneRoute', tr('export.oneRoute'), mode === 'oneRoute')}
          </select></label>
        <label class="mx-field"><span>${escHtml(tr('export.travel'))}</span>
          <select class="input" data-mx="travel">
            ${TRAVEL_MODES.map(([v, l]) => option(v, tr(l), (travel ?? '') === v)).join('')}
          </select></label>
      </div>
      <label class="mx-field" data-for="kml"><span>${escHtml(tr('export.layout'))}</span>
        <select class="input" data-mx="layout">
          ${option('perGroup', tr('export.layoutGroup'), false)}
          ${option('flat', tr('export.layoutFlat'), false)}
        </select></label>
      <div class="mx-results" data-mx="results"></div>`,
  });

  const results = m.root.querySelector<HTMLElement>('[data-mx="results"]')!;
  const layoutSelect = m.root.querySelector<HTMLSelectElement>('[data-mx="layout"]')!;

  const render = () => {
    job?.abort();
    job = null;
    m.root.querySelectorAll<HTMLElement>('[data-for]').forEach(el => { el.hidden = el.dataset.for !== format; });
    const scope = scopes.find(s => s.id === scopeId);
    if (!scope) {
      results.innerHTML = `<p class="mx-empty">${escHtml(tr('export.empty'))}</p>`;   // eslint-disable-line no-restricted-syntax -- static markup, text via escHtml
      return;
    }
    const effLayout = layout ?? defaultLayout(scope);
    layoutSelect.value = effLayout;
    // eslint-disable-next-line no-restricted-syntax -- audited: labels via escHtml, hrefs via safeUrl
    results.innerHTML = format === 'links' ? linksMarkup(scope, mode, travel) : fileMarkup(scope, format, effLayout);
  };
  render();

  const on = (sel: string, fn: (v: string) => void) =>
    m.root.querySelector(`[data-mx="${sel}"]`)?.addEventListener('change', (e) => { fn((e.target as HTMLSelectElement).value); render(); });
  on('scope', v => { scopeId = v; });
  on('format', v => { format = v as Format; });
  on('mode', v => { mode = v as RouteMode; });
  on('travel', v => { travel = (v || undefined) as TravelMode | undefined; });
  on('layout', v => { layout = v as KmlLayout; });

  results.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const copy = target.closest<HTMLButtonElement>('.mx-copy');
    if (copy) {
      try {
        await navigator.clipboard.writeText(copy.dataset.url ?? '');
        copy.textContent = tr('export.copied');
      } catch {
        copy.textContent = tr('export.copyFailed');
      }
      setTimeout(() => { copy.textContent = tr('export.copy'); }, 1600);
      return;
    }
    if (target.closest('[data-mx="make"]') && format !== 'links') {
      const scope = scopes.find(s => s.id === scopeId);
      if (!scope) return;
      job = new AbortController();
      await makeFile(scope, format, layout ?? defaultLayout(scope), results, job.signal);
    }
  });
}
