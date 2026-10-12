/* ==========================================================================
   On the Road · Stamp memory
   --------------------------------------------------------------------------
   Which stamps the traveller has already watched get pressed, so the "thunk"
   plays once per stamp rather than on every visit. Per device (localStorage) —
   the stamps themselves are derived from the route, nothing else is stored.
   ========================================================================== */

const KEY = 'otr:stampsSeen';

function read(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function isStampSeen(id: string): boolean {
  return read().has(id);
}

export function markStampsSeen(ids: string[]): void {
  if (!ids.length) return;
  try {
    const seen = read();
    ids.forEach((id) => seen.add(id));
    localStorage.setItem(KEY, JSON.stringify([...seen].slice(-500)));
  } catch { /* storage unavailable: stamps just replay next time */ }
}

/** Of these ids, the ones not seen yet. */
export function unseenStamps(ids: string[]): string[] {
  const seen = read();
  return ids.filter((id) => !seen.has(id));
}
