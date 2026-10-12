import { describe, expect, it } from 'vitest';
import { buildKml, escXml, MY_MAPS_MAX_LAYERS } from './kml-export.ts';
import { buildGpx } from './gpx-export.ts';
import type { ExportGroup, ExportPlace } from './places-export.ts';

const pl = (name: string, over: Partial<ExportPlace> = {}): ExportPlace => ({ name, source: 'plan', ...over });
const grp = (title: string, places: ExportPlace[]): ExportGroup => ({ id: title, title, kind: 'day', city: 'Paris', places });

const groups = [
  grp('Day 1', [pl('Louvre', { lat: 48.8606, lng: 2.3376, note: 'Go early', address: 'Rue de Rivoli', category: 'museum' }), pl('No coords')]),
  grp('Day 2', [pl('Orsay', { lat: 48.86, lng: 2.3266 })]),
];

describe('escXml', () => {
  it('escapes markup characters and strips illegal control characters', () => {
    expect(escXml(`<a href="x">Tom & 'Jerry'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; &apos;Jerry&apos;&lt;/a&gt;');
    expect(escXml('a\u0000b\u0008c\td\n')).toBe('abc\td\n');
  });
});

describe('buildKml', () => {
  it('writes lng,lat order and one folder per group', () => {
    const { content, included, skipped } = buildKml(groups, { name: 'Trip' });
    expect(content).toContain('<coordinates>2.337600,48.860600,0</coordinates>');
    expect(content.match(/<Folder>/g)).toHaveLength(2);
    expect(content).toContain('<name>Day 1</name>');
    expect(included).toBe(2);
    expect(skipped.map(s => s.name)).toEqual(['No coords']);
  });

  it('includes note, address and category in the description', () => {
    expect(buildKml(groups, { name: 'T' }).content).toContain('<description>Go early\nRue de Rivoli\n#museum</description>');
  });

  it('flat layout puts everything in a single folder', () => {
    const { content } = buildKml(groups, { name: 'Trip', layout: 'flat' });
    expect(content.match(/<Folder>/g)).toHaveLength(1);
    expect(content.match(/<Placemark>/g)).toHaveLength(2);
  });

  it('drops folders that end up empty', () => {
    const { content } = buildKml([grp('Empty', [pl('x')]), groups[1]], { name: 'T' });
    expect(content).not.toContain('<name>Empty</name>');
  });

  it('escapes hostile names so the document stays well-formed', () => {
    const { content } = buildKml([grp('G', [pl('A</name><x/>&', { lat: 1, lng: 2 })])], { name: 'T' });
    expect(content).toContain('<name>A&lt;/name&gt;&lt;x/&gt;&amp;</name>');
    expect(content).not.toContain('<x/>');
  });

  it('exposes the My Maps layer cap', () => {
    expect(MY_MAPS_MAX_LAYERS).toBe(10);
  });
});

describe('buildGpx', () => {
  it('writes waypoints with lat/lon attributes and a route per multi-stop group', () => {
    const two = [grp('Day 1', [pl('A', { lat: 1, lng: 2 }), pl('B', { lat: 3, lng: 4 })]), groups[1]];
    const { content, included } = buildGpx(two, { name: 'Trip' });
    expect(content).toContain('<wpt lat="1.000000" lon="2.000000">');
    expect(content.match(/<rte>/g)).toHaveLength(1); // Day 2 has a single stop → no route
    expect(content.match(/<rtept /g)).toHaveLength(2);
    expect(included).toBe(3);
  });

  it('reports places without coordinates', () => {
    expect(buildGpx(groups, { name: 'T' }).skipped.map(s => s.name)).toEqual(['No coords']);
  });
});
