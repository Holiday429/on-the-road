/* ==========================================================================
   On the Road · Journal — remembering how each photo is shaped
   --------------------------------------------------------------------------
   Entries written from now on carry `imageRatios` (one width / height per
   photo). Older ones do not, and a postcard cannot be framed until its shape
   is known, so the reader measures what is missing: look in the entry, then in
   memory, then in localStorage, and only then load the picture.

   A measured entry is written back once, so the next device (and the magazine,
   which paginates every entry in an album) gets the shapes without loading a
   single photo. Same idea as the map writing a leg's coordinates back.

   No Firestore import here: the caller hands in `write`, which keeps this file
   testable without a backend.
   ========================================================================== */

import { entryImages } from './utils.ts';

const KEY = 'otr:journal:ratio:';
const mem = new Map<string, number>();
const inFlight = new Map<string, Promise<number | undefined>>();
const written = new Set<string>();
const pendingWrite = new Map<string, number>();

const isRatio = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
/** Inline and temporary URLs say nothing durable about the file, and a data URL is far too big a key. */
const isDurable = (url: string) => !url.startsWith('data:') && !url.startsWith('blob:');

/** What is already known about one photo, without loading it. */
export function cachedRatio(url: string): number | undefined {
  if (!url) return undefined;
  const hit = mem.get(url);
  if (hit) return hit;
  if (!isDurable(url)) return undefined;
  try {
    const stored = Number(localStorage.getItem(KEY + url));
    if (isRatio(stored)) { mem.set(url, stored); return stored; }
  } catch { /* storage unavailable: measuring again is only slower */ }
  return undefined;
}

export function rememberRatio(url: string, ratio: number): void {
  if (!url || !isRatio(ratio)) return;
  mem.set(url, ratio);
  if (!isDurable(url)) return;
  try { localStorage.setItem(KEY + url, String(ratio)); } catch { /* full or blocked */ }
}

type RatioSource = { images?: string[]; coverImage?: string; imageRatios?: number[] };

/**
 * The entry's own `imageRatios`, if they can be trusted: one per photo. A list
 * of the wrong length was left behind by a client that added or removed a photo
 * without knowing about the field, so every index in it is suspect.
 */
export function storedRatios(entry: RatioSource): number[] | undefined {
  const list = entry.imageRatios;
  if (!Array.isArray(list) || !list.length) return undefined;
  return list.length === entryImages(entry).length && list.every(isRatio) ? list : undefined;
}

/** Width / height of photo `index`, or undefined while it has not been measured. */
export function ratioFor(entry: RatioSource, index: number): number | undefined {
  const own = storedRatios(entry)?.[index];
  if (own) return own;
  return cachedRatio(entryImages(entry)[index] ?? '');
}

/** Load a picture just far enough to read its size. Gives up (undefined) rather than hanging. */
export function measureRatio(src: string, timeoutMs = 8000): Promise<number | undefined> {
  if (!src) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const img = new Image();
    const timer = window.setTimeout(() => done(undefined), timeoutMs);
    function done(r: number | undefined) {
      window.clearTimeout(timer);
      img.onload = img.onerror = null;
      resolve(r);
    }
    img.onload = () => done(img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : undefined);
    img.onerror = () => done(undefined);
    img.src = src;
  });
}

function measureOnce(url: string, measure: (src: string) => Promise<number | undefined>): Promise<number | undefined> {
  const known = cachedRatio(url);
  if (known) return Promise.resolve(known);
  let p = inFlight.get(url);
  if (!p) {
    p = measure(url).then((r) => {
      inFlight.delete(url);
      if (r) rememberRatio(url, r);
      return r;
    });
    inFlight.set(url, p);
  }
  return p;
}

export interface MeasureOpts {
  /** Replaceable for tests. */
  measure?: (src: string) => Promise<number | undefined>;
  /** Persist `imageRatios` onto the entry. Failure is swallowed: offline just means measuring again next time. */
  write?: (entryId: string, ratios: number[]) => Promise<unknown>;
  /** Debounce before a write-back, so paging through entries does not fire a write per page. */
  writeDelayMs?: number;
}

/**
 * Measure every photo of `entries` whose shape is not yet known.
 * Resolves to true if anything new was learned — the caller should repaint.
 */
export async function measureMissing(
  entries: Array<RatioSource & { id: string }>,
  opts: MeasureOpts = {},
): Promise<boolean> {
  const measure = opts.measure ?? measureRatio;
  let learned = false;

  await Promise.all(entries.map(async (entry) => {
    const urls = entryImages(entry);
    if (!urls.length) return;
    const trusted = storedRatios(entry);
    const before = urls.map((u, i) => trusted?.[i] ?? cachedRatio(u));
    const ratios = await Promise.all(urls.map((u, i) => before[i] ?? measureOnce(u, measure)));
    if (ratios.some((r, i) => r && !before[i])) learned = true;

    const all = ratios.every(isRatio);
    if (all && !trusted && opts.write && !written.has(entry.id)) {
      scheduleWrite(entry.id, ratios as number[], opts);
    }
  }));
  return learned;
}

function scheduleWrite(id: string, ratios: number[], opts: MeasureOpts) {
  written.add(id);
  window.clearTimeout(pendingWrite.get(id));
  pendingWrite.set(id, window.setTimeout(() => {
    pendingWrite.delete(id);
    void Promise.resolve(opts.write!(id, ratios)).catch(() => { /* offline / signed out: try again next session */ });
  }, opts.writeDelayMs ?? 1200));
}

/** For tests. */
export function resetRatioCache(): void {
  mem.clear(); inFlight.clear(); written.clear();
  for (const t of pendingWrite.values()) window.clearTimeout(t);
  pendingWrite.clear();
}
