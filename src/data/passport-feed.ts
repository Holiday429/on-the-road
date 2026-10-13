/* ==========================================================================
   On the Road · Passport feed
   --------------------------------------------------------------------------
   One shared, lazily started subscription that turns the legs of every trip
   into PassportData (data/passport.ts). The sidebar badge, the Dashboard card,
   the Itinerary strip and the passport itself all read it, so they can never
   disagree. Starts on the first listener, stops on the last.
   ========================================================================== */

import { routeStore } from './stores/route-store.ts';
import { listTrips, onTripChange } from './trip-context.ts';
import { todayIso } from './trip-phase.ts';
import { passportFor, type PassportData } from './passport.ts';
import type { FootprintLeg } from './footprint.ts';

type Listener = (p: PassportData) => void;

const EMPTY: PassportData = { stamps: [], countries: 0, cities: 0, nights: 0, trips: 0 };

const listeners = new Set<Listener>();
let current: PassportData = EMPTY;
let legs: FootprintLeg[] = [];
let names = new Map<string, string>();
let stops: Array<() => void> = [];
let legsStop: (() => void) | null = null;

function recompute(): void {
  current = passportFor(legs, todayIso(), names);
  listeners.forEach((l) => l(current));
}

async function loadNames(): Promise<void> {
  try { names = new Map((await listTrips()).map((t) => [t.id, t.name])); } catch { names = new Map(); }
  recompute();
}

/** (Re)subscribes to every trip's legs — the set of trips can change under us. */
function watchLegs(): void {
  legsStop?.();
  legsStop = routeStore.subscribeAll((rows) => { legs = rows as unknown as FootprintLeg[]; recompute(); });
}

function start(): void {
  watchLegs();
  stops.push(onTripChange(() => { watchLegs(); void loadNames(); }));
  void loadNames();
}

function stop(): void {
  legsStop?.();
  legsStop = null;
  stops.forEach((s) => s());
  stops = [];
  current = EMPTY;
}

/** Calls `cb` now and on every change. Returns the unsubscribe. */
export function onPassport(cb: Listener): () => void {
  if (listeners.size === 0) start();
  listeners.add(cb);
  cb(current);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) stop();
  };
}

/** Latest data without subscribing (empty until something has subscribed). */
export function peekPassport(): PassportData {
  return current;
}
