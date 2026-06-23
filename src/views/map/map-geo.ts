/* ==========================================================================
   On the Road · Map · pure geometry & formatting helpers
   --------------------------------------------------------------------------
   Stateless functions extracted from map.ts: flight-path curve generation,
   bounds math, distance, and small label/date formatters. Nothing here touches
   the chart instance or module state, so it's safe to unit-test in isolation.
   ========================================================================== */

export interface GeoPt { lat: number; lng: number; }

/* ── Flight-path geometry ─────────────────────────────────────────────────── */

export function arcPoints(
  from: GeoPt, to: GeoPt,
  n = 20, bendFraction = 0.15,
): [number, number][] {
  const dLng = to.lng - from.lng, dLat = to.lat - from.lat;
  const chord = Math.sqrt(dLng * dLng + dLat * dLat);
  if (chord < 0.001) return [[from.lng, from.lat]];
  const pLng = -dLat / chord, pLat = dLng / chord;
  const b = chord * bendFraction;
  const cpLng = (from.lng + to.lng) / 2 + pLng * b;
  const cpLat = (from.lat + to.lat) / 2 + pLat * b;
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push([u * u * from.lng + 2 * u * t * cpLng + t * t * to.lng,
              u * u * from.lat + 2 * u * t * cpLat + t * t * to.lat]);
  }
  return pts;
}

export function bezierWaypoints(from: GeoPt, to: GeoPt, bend = 0.25, n = 30) {
  return arcPoints(from, to, n, bend).map(([lng, lat]) => ({ lat, lng }));
}

/* Waypoints whose count is proportional to geo distance, so that with a fixed
   per-waypoint duration the plane moves at a constant *visual* speed across
   segments of different lengths. ~one waypoint per `degPerStep` degrees. */
export function evenSpeedWaypoints(from: GeoPt, to: GeoPt, bend = 0.25, degPerStep = 1.6) {
  const dLng = to.lng - from.lng, dLat = to.lat - from.lat;
  const chord = Math.sqrt(dLng * dLng + dLat * dLat);
  const n = Math.max(2, Math.round(chord / degPerStep));
  return bezierWaypoints(from, to, bend, n);
}

/** Even-speed waypoints through a chain of geo points (for connecting flights). */
export function chainWaypoints(chain: GeoPt[], bend = 0.22): GeoPt[] {
  const out: GeoPt[] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const seg = evenSpeedWaypoints(chain[i], chain[i + 1], bend);
    out.push(...(i > 0 ? seg.slice(1) : seg));
  }
  return out;
}

/* ── Bounds & distance ────────────────────────────────────────────────────── */

export function expandBounds(bounds: { left: number; right: number; top: number; bottom: number }, ratio = 0.12) {
  const width = Math.max(0.1, bounds.right - bounds.left);
  const height = Math.max(0.1, bounds.top - bounds.bottom);
  const padLng = Math.max(0.28, width * ratio);
  const padLat = Math.max(0.28, height * ratio);
  return {
    left: bounds.left - padLng,
    right: bounds.right + padLng,
    top: bounds.top + padLat,
    bottom: bounds.bottom - padLat,
  };
}

// Great-circle-ish distance in degrees (good enough for de-duping nearby labels).
export function geoDist(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const dLng = aLng - bLng, dLat = aLat - bLat;
  return Math.sqrt(dLng * dLng + dLat * dLat);
}

/* ── Formatting ───────────────────────────────────────────────────────────── */

export function fmtRange(from: string, to: string): string {
  const o: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${new Date(from).toLocaleDateString('en-US', o)} – ${new Date(to).toLocaleDateString('en-US', o)}`;
}

export function nights(from: string, to: string): number {
  return Math.max(0, Math.round((+new Date(to) - +new Date(from)) / 86400000));
}

export function wrapMapLabel(text: string, maxLineLength = 12): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return text;
  const lines: string[] = [];
  let current = words[0];
  for (const word of words.slice(1)) {
    if (`${current} ${word}`.length <= maxLineLength) {
      current = `${current} ${word}`;
      continue;
    }
    lines.push(current);
    current = word;
  }
  lines.push(current);
  return lines.join('\n');
}

/** Map a 0..1 intensity to an amber heat colour (light cream → deep orange). */
export function heatColor(t: number): string {
  const lo = { r: 0xfd, g: 0xee, b: 0xd0 };  // pale amber
  const hi = { r: 0xe0, g: 0x6b, b: 0x1a };  // deep orange
  const k = Math.sqrt(Math.min(1, Math.max(0, t)));   // sqrt so small spends still read
  const ch = (a: number, b: number) => Math.round(a + (b - a) * k);
  return `rgb(${ch(lo.r, hi.r)}, ${ch(lo.g, hi.g)}, ${ch(lo.b, hi.b)})`;
}
