/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cachedRatio, measureMissing, ratioFor, rememberRatio, resetRatioCache, storedRatios } from './ratio-cache.ts';

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'e1', images: ['https://x/a.jpg', 'https://x/b.jpg'], ...over,
}) as { id: string; images: string[]; imageRatios?: number[] };

beforeEach(() => { resetRatioCache(); localStorage.clear(); });

describe('storedRatios', () => {
  it('trusts a list with one ratio per photo', () => {
    expect(storedRatios(entry({ imageRatios: [1.5, 0.75] }))).toEqual([1.5, 0.75]);
  });

  it('ignores a list of the wrong length: an older client changed the photos', () => {
    expect(storedRatios(entry({ imageRatios: [1.5] }))).toBeUndefined();
    expect(storedRatios(entry({ imageRatios: [1.5, 1, 1] }))).toBeUndefined();
  });

  it('ignores a list with a bad number in it', () => {
    expect(storedRatios(entry({ imageRatios: [1.5, 0] }))).toBeUndefined();
  });
});

describe('ratioFor', () => {
  it('prefers the entry, then memory, then storage', () => {
    expect(ratioFor(entry({ imageRatios: [1.5, 0.75] }), 1)).toBe(0.75);
    expect(ratioFor(entry(), 0)).toBeUndefined();
    rememberRatio('https://x/a.jpg', 1.78);
    expect(ratioFor(entry(), 0)).toBe(1.78);
  });

  it('survives a reload: it was written to localStorage', () => {
    rememberRatio('https://x/a.jpg', 1.33);
    resetRatioCache();                       // memory gone, storage kept
    expect(cachedRatio('https://x/a.jpg')).toBe(1.33);
  });

  it('keeps inline pictures out of localStorage', () => {
    rememberRatio('data:image/svg+xml;utf8,abc', 1.5);
    expect(localStorage.length).toBe(0);
    expect(cachedRatio('data:image/svg+xml;utf8,abc')).toBe(1.5);
  });

  it('reads the first photo for an entry with only the legacy coverImage', () => {
    rememberRatio('https://x/old.jpg', 0.66);
    expect(ratioFor({ coverImage: 'https://x/old.jpg' }, 0)).toBe(0.66);
  });
});

describe('measureMissing', () => {
  it('measures only what is unknown, once per picture, and says it learned something', async () => {
    const measure = vi.fn(async (src: string) => (src.endsWith('a.jpg') ? 1.5 : 0.75));
    rememberRatio('https://x/b.jpg', 0.75);
    expect(await measureMissing([entry()], { measure })).toBe(true);
    expect(measure).toHaveBeenCalledTimes(1);
    expect(ratioFor(entry(), 0)).toBe(1.5);

    expect(await measureMissing([entry()], { measure })).toBe(false);
    expect(measure).toHaveBeenCalledTimes(1);
  });

  it('shares one load between entries that use the same picture', async () => {
    const measure = vi.fn(async () => 1.5);
    await measureMissing([entry({ id: 'a' }), entry({ id: 'b' })], { measure });
    expect(measure).toHaveBeenCalledTimes(2);   // a.jpg and b.jpg, not four
  });

  it('writes the shapes back once, when every photo is known', async () => {
    const write = vi.fn(async () => {});
    const measure = async (src: string) => (src.endsWith('a.jpg') ? 1.5 : 0.75);
    await measureMissing([entry()], { measure, write, writeDelayMs: 0 });
    await new Promise((r) => setTimeout(r, 5));
    expect(write).toHaveBeenCalledWith('e1', [1.5, 0.75]);

    await measureMissing([entry()], { measure, write, writeDelayMs: 0 });
    await new Promise((r) => setTimeout(r, 5));
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('does not write an entry that already carries its shapes', async () => {
    const write = vi.fn(async () => {});
    await measureMissing([entry({ imageRatios: [1.5, 0.75] })], { measure: async () => 1, write, writeDelayMs: 0 });
    await new Promise((r) => setTimeout(r, 5));
    expect(write).not.toHaveBeenCalled();
  });

  it('does not write a half-measured entry', async () => {
    const write = vi.fn(async () => {});
    const measure = async (src: string) => (src.endsWith('a.jpg') ? 1.5 : undefined);
    await measureMissing([entry()], { measure, write, writeDelayMs: 0 });
    await new Promise((r) => setTimeout(r, 5));
    expect(write).not.toHaveBeenCalled();
  });

  it('shrugs off a failed write', async () => {
    const write = vi.fn(async () => { throw new Error('Not signed in'); });
    await measureMissing([entry()], { measure: async () => 1.5, write, writeDelayMs: 0 });
    await new Promise((r) => setTimeout(r, 5));
    expect(write).toHaveBeenCalled();           // and nothing threw
  });
});
