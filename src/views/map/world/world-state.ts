/* ==========================================================================
   On the Road · World — view state machine
   --------------------------------------------------------------------------
   world ──pick a country──▶ focusing ──camera settled──▶ country
     ▲                          │ superseded / cancelled        │
     └────────── leave ─────────┴───────────────────────────────┘

   Every transition is stamped with a token. An async step (the camera
   animation, a geodata load) checks `isLive(token)` after each await and quietly
   stops if the user has since picked another country or gone back — so clicks
   in quick succession can never leave a half-applied view. This replaces the
   stack of fixed-delay timers the Marginalia map used for the same job.
   ========================================================================== */

export type WorldPhase = 'world' | 'focusing' | 'country';

export interface WorldState {
  readonly phase: WorldPhase;
  /** The picked country (set from `begin` until `leave`). */
  readonly iso: string | null;
  /** Start moving to a country. Supersedes any transition in flight. */
  begin(iso: string): number;
  /** Is this token still the latest transition? */
  isLive(token: number): boolean;
  /** The camera has arrived. Returns false (and does nothing) if superseded. */
  settle(token: number): boolean;
  /** Go back to the world view. Supersedes any transition in flight. */
  leave(): number;
}

export function createWorldState(): WorldState {
  let phase: WorldPhase = 'world';
  let iso: string | null = null;
  let token = 0;
  return {
    get phase() { return phase; },
    get iso() { return iso; },
    begin(next) { token += 1; phase = 'focusing'; iso = next; return token; },
    isLive(t) { return t === token; },
    settle(t) {
      if (t !== token || phase !== 'focusing') return false;
      phase = 'country';
      return true;
    },
    leave() { token += 1; phase = 'world'; iso = null; return token; },
  };
}
