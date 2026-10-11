/* ==========================================================================
   On the Road · Time travel clock
   --------------------------------------------------------------------------
   Lets the app treat "now" as another moment — so a trip can be looked back on
   (or previewed) as it was on any day: the Dashboard's "today", the banner's
   countdowns and clocks, the agenda, spend, journal… and everything that reads
   trip-phase's todayIso() follow it.

   Stored as an offset (chosen − real) so the chosen time keeps ticking, and
   kept in sessionStorage: it survives a reload but not a closed tab, so the app
   never opens stuck in the past. An active trip through time is always flagged
   on screen (the pill in the Dashboard's greeting row).

   Not a general time mock: records added while looking back (expenses,
   to-dos…) are dated with the chosen day.
   ========================================================================== */

const KEY = 'otr:simOffset';

let _offset: number | null = null;     // ms; null = not simulating
let _loaded = false;
const _subs = new Set<() => void>();

function load(): void {
  if (_loaded) return;
  _loaded = true;
  try {
    const raw = sessionStorage.getItem(KEY);
    const n = raw == null ? NaN : Number(raw);
    _offset = Number.isFinite(n) ? n : null;
  } catch { /* no storage (private mode / node) — stay off */ }
}

function persist(): void {
  try {
    if (_offset == null) sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, String(_offset));
  } catch { /* best-effort */ }
}

/** The app's "now": the real time, shifted if a simulation is active. */
export function appNow(): Date {
  load();
  return new Date(Date.now() + (_offset ?? 0));
}

export function isSimulating(): boolean {
  load();
  return _offset != null;
}

/** Make "now" be `local` ('YYYY-MM-DDTHH:MM', the browser's local time); null
 *  returns to the real clock. Returns false for an unparsable value. */
export function setSimulatedNow(local: string | null): boolean {
  load();
  if (local == null) {
    _offset = null;
  } else {
    const target = new Date(local);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(local) || Number.isNaN(target.getTime())) return false;
    _offset = target.getTime() - Date.now();
  }
  persist();
  _subs.forEach((fn) => fn());
  return true;
}

export function onSimChange(fn: () => void): () => void {
  _subs.add(fn);
  return () => { _subs.delete(fn); };
}

/** `YYYY-MM-DD` of the app's current "now" (local). */
export function nowDateValue(): string {
  return nowLocalValue().slice(0, 10);
}

/** `datetime-local` value for the app's current "now". */
export function nowLocalValue(): string {
  const d = appNow();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ── Deep link ───────────────────────────────────────────────────────────── */

/** ?sim=YYYY-MM-DD[THH:MM] opens the app looking back at that moment (date only → 10:00). */
export function initSimFromUrl(search: string = typeof location !== 'undefined' ? location.search : ''): void {
  const sim = new URLSearchParams(search).get('sim');
  if (sim) setSimulatedNow(sim.includes('T') ? sim : `${sim}T10:00`);
}

/** Test hook: forget cached state. */
export function _resetSimClockForTests(): void { _offset = null; _loaded = true; _subs.clear(); }
