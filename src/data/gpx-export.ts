/* ==========================================================================
   On the Road · GPX export
   --------------------------------------------------------------------------
   GPX 1.1: every place as a <wpt>, plus one <rte> per group so navigation apps
   (Organic Maps, Komoot, Garmin…) can follow a day in order.
   ========================================================================== */

import { escXml, describePlace, type FileBuildResult } from './kml-export.ts';
import { hasCoords, type ExportGroup, type ExportPlace } from './places-export.ts';

type Located = ExportPlace & { lat: number; lng: number };

const pt = (tag: string, p: Located, group: string) => {
  const desc = describePlace(p);
  return `<${tag} lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}"><name>${escXml(p.name)}</name>`
    + `${desc ? `<desc>${escXml(desc)}</desc>` : ''}<type>${escXml(group)}</type></${tag}>`;
};

export function buildGpx(groups: ExportGroup[], opts: { name: string }): FileBuildResult {
  const skipped: ExportPlace[] = [];
  let included = 0;
  const wpts: string[] = [];
  const rtes: string[] = [];

  for (const g of groups) {
    const located: Located[] = [];
    for (const p of g.places) {
      if (hasCoords(p)) located.push(p as Located); else skipped.push(p);
    }
    included += located.length;
    wpts.push(...located.map(p => `  ${pt('wpt', p, g.title)}`));
    if (located.length >= 2) {
      rtes.push(`  <rte><name>${escXml(g.title)}</name>\n${located.map(p => `    ${pt('rtept', p, g.title)}`).join('\n')}\n  </rte>`);
    }
  }

  const content = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="On the Road" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escXml(opts.name)}</name></metadata>
${[...wpts, ...rtes].join('\n')}
</gpx>
`;
  return { content, included, skipped };
}
