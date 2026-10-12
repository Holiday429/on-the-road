/* ==========================================================================
   On the Road · KML export
   --------------------------------------------------------------------------
   Builds a KML document that Google My Maps (and Google Earth) can import.
   Import it once at mymaps.google.com → Create → Import; it then shows up in
   the Google Maps app under Saved → Maps. KML is export-only here — Google's
   KmlLayer renderer is deprecated, we never render it.

   My Maps caps a map at 10 layers and imports each KML <Folder> as a layer, so
   callers can ask for layout 'flat' (one folder) when there are many groups.
   ========================================================================== */

import { hasCoords, type ExportGroup, type ExportPlace } from './places-export.ts';

export type KmlLayout = 'perGroup' | 'flat';

/** My Maps layer cap — beyond this a per-group layout stops importing cleanly. */
export const MY_MAPS_MAX_LAYERS = 10;

// XML 1.0 forbids most C0 control characters even when escaped.
const ILLEGAL_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export function escXml(s: string): string {
  return s
    .replace(ILLEGAL_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface FileBuildResult {
  content: string;
  /** Places written to the file. */
  included: number;
  /** Places left out for lack of coordinates. */
  skipped: ExportPlace[];
}

export interface KmlOptions {
  name: string;
  layout?: KmlLayout;
}

export function describePlace(p: ExportPlace): string {
  return [p.note, p.address, p.category && `#${p.category}`].filter(Boolean).join('\n');
}

function placemark(p: ExportPlace & { lat: number; lng: number }): string {
  const desc = describePlace(p);
  // KML coordinate order is lng,lat,alt.
  return `    <Placemark>
      <name>${escXml(p.name)}</name>${desc ? `\n      <description>${escXml(desc)}</description>` : ''}
      <Point><coordinates>${p.lng.toFixed(6)},${p.lat.toFixed(6)},0</coordinates></Point>
    </Placemark>`;
}

export function buildKml(groups: ExportGroup[], opts: KmlOptions): FileBuildResult {
  const layout = opts.layout ?? 'perGroup';
  const skipped: ExportPlace[] = [];
  let included = 0;

  const marks = (places: ExportPlace[]): string[] => {
    const out: string[] = [];
    for (const p of places) {
      if (hasCoords(p)) { out.push(placemark(p as ExportPlace & { lat: number; lng: number })); included++; }
      else skipped.push(p);
    }
    return out;
  };

  const folders = layout === 'flat'
    ? [{ title: opts.name, marks: marks(groups.flatMap(g => g.places)) }]
    : groups.map(g => ({ title: g.title, marks: marks(g.places) }));

  const body = folders
    .filter(f => f.marks.length)
    .map(f => `  <Folder>\n    <name>${escXml(f.title)}</name>\n${f.marks.join('\n')}\n  </Folder>`)
    .join('\n');

  const content = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>${escXml(opts.name)}</name>
${body}
</Document>
</kml>
`;
  return { content, included, skipped };
}
