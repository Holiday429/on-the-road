/* ==========================================================================
   On the Road · Simulated clock (testing aid)
   --------------------------------------------------------------------------
   Lets the app treat "now" as some other moment — so a finished trip's data can
   be viewed as it looked before, during, or on any day of the trip. The
   Dashboard's "today", the banner's countdowns and clocks, and everything that
   reads trip-phase's todayIso() follow it.

   Stored as an offset (simulated − real) so the simulated time keeps ticking,
   and kept in localStorage so it survives a reload. Off unless set. The control
   that sets it is only shown with ?debug=1 (see debugEnabled), but an active
   simulation is always flagged on screen.

   Not a general time mock: records written while simulating (expenses,
   to-dos…) are dated with the simulated "today".
   ========================================================================== */

const KEY = 'otr:simOffset';
const DEBUG_KEY = 'otr:debug';

let _offset: number | null = null;     // ms; null = not simulating
let _loaded = false;
const _subs = new Set<() => void>();

function load(): void {
  if (_loaded) return;
  _loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    const n = raw == null ? NaN : Number(raw);
    _offset = Number.isFinite(n) ? n : null;
  } catch { /* no storage (private mode / node) — stay off */ }
}

function persist(): void {
  try {
    if (_offset == null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(_offset));
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

/** `datetime-local` value for the app's current "now". */
export function nowLocalValue(): string {
  const d = appNow();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ── Debug gate ──────────────────────────────────────────────────────────── */

/** The simulation control shows only after visiting with ?debug=1 (remembered;
 *  ?debug=0 turns it off). Optional ?sim=YYYY-MM-DD[THH:MM] starts a simulation. */
export function initDebugFromUrl(search: string = typeof location !== 'undefined' ? location.search : ''): void {
  const q = new URLSearchParams(search);
  try {
    const dbg = q.get('debug');
    if (dbg === '1') localStorage.setItem(DEBUG_KEY, '1');
    else if (dbg === '0') localStorage.removeItem(DEBUG_KEY);
  } catch { /* ignore */ }
  const sim = q.get('sim');
  if (sim) setSimulatedNow(sim.includes('T') ? sim : `${sim}T10:00`);
}

export function debugEnabled(): boolean {
  try { return localStorage.getItem(DEBUG_KEY) === '1'; } catch { return false; }
}

/** Test hook: forget cached state. */
export function _resetSimClockForTests(): void { _offset = null; _loaded = true; _subs.clear(); }
