/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { loadAmCharts, loadCountryGeodata } from './amcharts-loader.ts';

const scripts = () => [...document.head.querySelectorAll<HTMLScriptElement>('script[data-amsrc]')];
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('amCharts loader', () => {
  it('does not cache a failure: the next call injects a fresh script and can succeed', async () => {
    const first = loadAmCharts();
    const caught = first.catch((e: Error) => e.message);
    scripts()[0].dispatchEvent(new Event('error'));
    expect(await caught).toMatch(/failed: .*index\.js/);
    expect(scripts()).toHaveLength(0);                 // the failed tag was removed

    const second = loadAmCharts();
    expect(second).not.toBe(first);
    // each of the four scripts loads in order; answer them as they appear
    for (let i = 0; i < 4; i++) {
      await tick();
      const s = scripts().find((el) => el.dataset.loaded !== '1')!;
      s.dispatchEvent(new Event('load'));
    }
    await expect(second).resolves.toBeUndefined();
    expect(loadAmCharts()).toBe(second);               // success is cached
  });

  it('country geodata failures are retryable too', async () => {
    const first = loadCountryGeodata('FR');
    const caught = first.catch(() => 'failed');
    scripts().find((el) => el.dataset.amsrc?.includes('franceLow'))!.dispatchEvent(new Event('error'));
    expect(await caught).toBe('failed');
    expect(loadCountryGeodata('FR')).not.toBe(first);
  });
});
