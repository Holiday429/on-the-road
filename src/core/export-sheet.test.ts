// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const download = vi.hoisted(() => vi.fn());
vi.mock('./export-files.ts', async (orig) => ({ ...(await orig<typeof import('./export-files.ts')>()), downloadTextFile: download }));
vi.mock('../views/map/geocode.ts', () => ({
  geocodeLocal: () => null,
  geocode: async (q: string) => (q.startsWith('Nowhere') ? null : { lat: 48.86, lng: 2.33, iso: 'FR' }),
}));

import { openExportSheet } from './export-sheet.ts';
import type { ExportScope } from '../data/places-export.ts';

const place = (name: string, over = {}) => ({ name, source: 'plan' as const, city: 'Paris', ...over });
const scopes: ExportScope[] = [
  {
    id: 'trip', label: 'Whole trip',
    groups: [
      { id: 'g1', title: 'Paris · Day 1', kind: 'day', city: 'Paris', places: [place('Louvre'), place('Orsay'), place('Nowhere Cafe')] },
      { id: 'g2', title: 'Paris · Day 2', kind: 'day', city: 'Paris', places: [place('Eiffel', { lat: 48.85, lng: 2.29 })] },
    ],
  },
];

const q = <T extends HTMLElement>(sel: string) => document.body.querySelector<T>(sel)!;
const choose = (sel: string, value: string) => {
  const el = q<HTMLSelectElement>(sel);
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
};

beforeEach(() => { download.mockClear(); });
afterEach(() => { document.body.replaceChildren(); });

describe('openExportSheet', () => {
  it('renders one link block per group by default', () => {
    openExportSheet({ title: 'Export', scopes });
    expect(document.body.querySelectorAll('.mx-block')).toHaveLength(2);
    expect(q<HTMLAnchorElement>('.mx-link').href).toContain('https://www.google.com/maps/');
  });

  it('switches to a single continuous route', () => {
    openExportSheet({ title: 'Export', scopes });
    choose('[data-mx="mode"]', 'oneRoute');
    expect(document.body.querySelectorAll('.mx-block')).toHaveLength(1);
  });

  it('hides link-only controls and shows the KML layout control when the format changes', () => {
    openExportSheet({ title: 'Export', scopes });
    expect(q('[data-for="links"]').hidden).toBe(false);
    expect(q('[data-for="kml"]').hidden).toBe(true);
    choose('[data-mx="format"]', 'kml');
    expect(q('[data-for="links"]').hidden).toBe(true);
    expect(q('[data-for="kml"]').hidden).toBe(false);
    expect(q('[data-mx="make"]').textContent).toContain('kml');
  });

  it('geocodes missing places, downloads a KML and reports the unresolved one', async () => {
    openExportSheet({ title: 'Export', scopes });
    choose('[data-mx="format"]', 'kml');
    q('[data-mx="make"]').click();
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1));

    const [filename, mime, content] = download.mock.calls[0] as [string, string, string];
    expect(filename).toBe('Whole-trip.kml');
    expect(mime).toBe('application/vnd.google-earth.kml+xml');
    expect(content.match(/<Placemark>/g)).toHaveLength(3);
    expect(content).not.toContain('Nowhere Cafe');
    expect(q('[data-mx="status"]').textContent).toContain('Nowhere Cafe');
  });

  it('writes GPX when chosen', async () => {
    openExportSheet({ title: 'Export', scopes });
    choose('[data-mx="format"]', 'gpx');
    q('[data-mx="make"]').click();
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(download.mock.calls[0][0]).toBe('Whole-trip.gpx');
    expect(download.mock.calls[0][2]).toContain('<gpx ');
  });

  it('defaults to a single KML layer when there are more groups than My Maps allows', () => {
    const many: ExportScope[] = [{
      id: 'trip', label: 'Whole trip',
      groups: Array.from({ length: 12 }, (_, i) => ({
        id: `g${i}`, title: `Day ${i}`, kind: 'day' as const, city: 'Paris', places: [place(`P${i}`, { lat: 1, lng: 2 })],
      })),
    }];
    openExportSheet({ title: 'Export', scopes: many });
    choose('[data-mx="format"]', 'kml');
    expect(q<HTMLSelectElement>('[data-mx="layout"]').value).toBe('flat');
    expect(document.body.querySelector('.mx-warn')).toBeNull();
  });
});
