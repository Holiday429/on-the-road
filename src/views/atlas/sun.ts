/* ==========================================================================
   On the Road · Atlas — where the sun is (pure)
   --------------------------------------------------------------------------
   The point on Earth where the sun is straight overhead at a given moment. The
   Atlas shades the hemisphere opposite it, so the globe shows which of the
   places you have been are in daylight right now. Accurate to well under a
   degree — plenty for a shaded half-disc.
   ========================================================================== */

export interface GeoPoint { longitude: number; latitude: number; }

const RAD = Math.PI / 180;

/** Day number in the year (1 = 1 Jan), in UTC. */
function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((d.getTime() - start) / 86400000);
}

/** The sub-solar point for `date`. */
export function subsolarPoint(date: Date): GeoPoint {
  const n = dayOfYear(date);
  // Declination: the sun's latitude, swinging ±23.44° over the year.
  const latitude = -23.44 * Math.cos(((360 / 365) * (n + 10)) * RAD);
  // Equation of time (minutes): the sun runs up to ~16 min fast/slow of the clock.
  const b = ((360 / 365) * (n - 81)) * RAD;
  const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  let longitude = 15 * (12 - utcHours - eot / 60);   // 15° per hour, west as the day goes on
  longitude = ((((longitude + 180) % 360) + 360) % 360) - 180;
  return { longitude, latitude };
}

/** The centre of the night side: directly opposite the sun. The night is the 90° circle around it. */
export function nightCentre(date: Date): GeoPoint {
  const s = subsolarPoint(date);
  return { longitude: ((((s.longitude + 360) % 360) + 360) % 360) - 180, latitude: -s.latitude };
}
