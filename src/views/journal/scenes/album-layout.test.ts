import { describe, expect, it } from 'vitest';
import { pickLayout } from './album-layout.ts';

type L = 'photo' | 'photo2' | 'words' | 'words2';
const led = (l: L) => l.startsWith('photo');

describe('pickLayout', () => {
  const options: L[] = ['photo', 'photo2', 'words', 'words2'];

  /** Pick a whole run of pages the way the paginator does. */
  const run = (albumId: string, n: number, opts: readonly L[] = options) => {
    const out: L[] = [];
    let prev: L | null = null;
    for (let i = 0; i < n; i++) { prev = pickLayout(opts, prev, led, albumId, i); out.push(prev); }
    return out;
  };

  it('never repeats a layout on the page straight after it', () => {
    const plan = run('album-1', 24);
    for (let i = 1; i < plan.length; i++) expect(plan[i], `page ${i}`).not.toBe(plan[i - 1]);
  });

  it('alternates picture-led and text-led where there is a choice', () => {
    const plan = run('album-2', 24);
    for (let i = 1; i < plan.length; i++) expect(led(plan[i])).not.toBe(led(plan[i - 1]));
  });

  it('is stable: the same album is laid out the same way every time', () => {
    expect(run('album-1', 12)).toEqual(run('album-1', 12));
  });

  it('varies between albums where the choice is real', () => {
    const plans = new Set(['album-1', 'album-2', 'album-3', 'album-4', 'album-5', 'album-6'].map((id) => run(id, 12).join()));
    expect(plans.size).toBeGreaterThan(1);
  });

  it('takes the only option there is, even if it repeats', () => {
    expect(run('a', 4, ['words'])).toEqual(['words', 'words', 'words', 'words']);
  });

  it('breaks the alternation rather than repeat, when only one kind is on offer', () => {
    const plan = run('a', 6, ['words', 'words2']);
    for (let i = 1; i < plan.length; i++) expect(plan[i]).not.toBe(plan[i - 1]);
  });
});
