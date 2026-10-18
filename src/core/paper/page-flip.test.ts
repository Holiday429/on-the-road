/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { CURL_DEG, LIFT_DEG, SLICES, absoluteAngles, beginHingeFlip, bendAngle, commitsTurn, dragProgress, liftAngle, liftShade, pageCopy, sliceAngles, sliceGloss, sliceShade } from './page-flip.ts';

describe('liftAngle', () => {
  it('lifts the leaving sheet 0 → LIFT_DEG going forward', () => {
    expect(liftAngle(0, 1)).toBe(0);
    expect(liftAngle(1, 1)).toBeCloseTo(LIFT_DEG);
  });
  it('is slow to come off the page, then goes over quickly', () => {
    // behind a linear lift for the whole first half: the sheet has to be peeled up first
    expect(liftAngle(0.5, 1)).toBeLessThan(LIFT_DEG / 2);
    expect(liftAngle(0.75, 1) - liftAngle(0.5, 1)).toBeGreaterThan(liftAngle(0.25, 1));
  });
  it('brings the arriving sheet down LIFT_DEG → 0 going back', () => {
    expect(liftAngle(0, -1)).toBe(LIFT_DEG);
    expect(liftAngle(1, -1)).toBeCloseTo(0);
  });
  it('is clamped', () => {
    expect(liftAngle(-4, 1)).toBe(0);
    expect(liftAngle(9, 1)).toBe(LIFT_DEG);
  });
});

describe('bendAngle / sliceAngles', () => {
  it('is flat at rest and at the end, and bends most EARLY — paper curls as it is peeled, not at the halfway mark', () => {
    expect(bendAngle(0)).toBeCloseTo(0);
    expect(bendAngle(1)).toBeCloseTo(0);
    expect(bendAngle(0.32)).toBeCloseTo(CURL_DEG);
    // the peak is before the middle, and the sheet has largely straightened by the end
    expect(bendAngle(0.32)).toBeGreaterThan(bendAngle(0.5));
    expect(bendAngle(0.5)).toBeGreaterThan(bendAngle(0.85));
  });
  it('gives each slice a turn, the first carrying the whole lift', () => {
    const rel = sliceAngles(1, 1);
    expect(rel).toHaveLength(SLICES);
    expect(rel[0]).toBeCloseTo(LIFT_DEG);
    expect(rel.slice(1).every((a) => Math.abs(a) < 1e-6)).toBe(true);
  });
  it('shares the whole bend between the slices, over and above the lift', () => {
    const rel = sliceAngles(0.4, 1);
    const abs = absoluteAngles(rel);
    expect(abs[abs.length - 1] - liftAngle(0.4, 1)).toBeCloseTo(bendAngle(0.4));
  });
  it('takes its curve near the free edge, leaving the body of the sheet flat', () => {
    const rel = sliceAngles(0.32, 1);
    // the last slice bends several times as hard as one in the middle, and that one harder than the top
    expect(rel[SLICES - 1]).toBeGreaterThan(rel[SLICES >> 1] * 3);
    expect(rel[SLICES >> 1]).toBeGreaterThan(rel[1]);
  });
  it('a sheet coming down starts lifted and lands flat', () => {
    expect(absoluteAngles(sliceAngles(0, -1))[0]).toBeCloseTo(LIFT_DEG);
    expect(absoluteAngles(sliceAngles(1, -1)).every((a) => Math.abs(a) < 1e-6)).toBe(true);
  });
});

describe('sliceShade / sliceGloss', () => {
  it('is nothing facing you and darkest edge-on', () => {
    expect(sliceShade(0)).toBe(0);
    expect(sliceShade(90)).toBeGreaterThan(sliceShade(40));
    expect(sliceShade(160)).toBe(sliceShade(90));
  });
  it('catches the light only in a band of angles', () => {
    expect(sliceGloss(38)).toBeGreaterThan(sliceGloss(0));
    expect(sliceGloss(38)).toBeGreaterThan(sliceGloss(90));
  });
});

describe('liftShade', () => {
  it('is nothing when flat and most when the sheet stands high', () => {
    expect(liftShade(0)).toBe(0);
    expect(liftShade(90)).toBeGreaterThan(liftShade(30));
    expect(liftShade(90)).toBeLessThanOrEqual(0.4);
  });
});

describe('dragProgress / commitsTurn', () => {
  it('maps a drag to a fraction, either way round', () => {
    expect(dragProgress(0, 400)).toBe(0);
    expect(dragProgress(-160, 400)).toBeCloseTo(0.5);
    expect(dragProgress(900, 400)).toBe(1);
    expect(dragProgress(10, 0)).toBe(0);
  });
  it('completes the turn when pulled far enough or flicked', () => {
    expect(commitsTurn(0.2, 0.1)).toBe(false);
    expect(commitsTurn(0.4, 0)).toBe(true);
    expect(commitsTurn(0.1, 0.6)).toBe(true);
  });
});

describe('beginHingeFlip', () => {
  const mk = (cls: string) => Object.assign(document.createElement('div'), { className: cls, id: `x-${cls}` });

  it('returns null without the Web Animations API (nothing to animate with)', () => {
    const host = document.createElement('div');
    expect(beginHingeFlip(host, { dir: 1, sheet: mk('a') })).toBeNull();
  });

  it('cuts the sheet into slices hung one from the next, with the page under it', () => {
    const host = document.createElement('div');
    host.animate = (() => ({})) as never;
    const flip = beginHingeFlip(host, { dir: 1, sheet: mk('old'), under: mk('new') })!;
    expect(host.querySelector('.hf.is-forward .hf-sheet .is-front .old')).toBeTruthy();
    expect(host.querySelector('.hf-under .new')).toBeTruthy();
    expect(host.querySelectorAll('.hf-slice')).toHaveLength(SLICES);
    expect(host.querySelectorAll('.hf-page')).toHaveLength(SLICES);
    // each slice sits inside the one above it (that is what bends the sheet)
    expect(host.querySelector('.hf-sheet > .hf-slice > .hf-slice')).toBeTruthy();
    flip.set(0.5);
    const rel = sliceAngles(0.5, 1);
    expect(host.querySelector<HTMLElement>('.hf-sheet')!.style.transform).toBe(`rotateX(${rel[0].toFixed(2)}deg)`);
    flip.destroy();
    expect(host.querySelector('.hf')).toBeNull();
  });

  it('starts a backward turn lifted, and lands it flat', async () => {
    const host = document.createElement('div');
    host.animate = (() => ({})) as never;
    const flip = beginHingeFlip(host, { dir: -1, sheet: mk('arriving'), under: mk('leaving') })!;
    const sheet = host.querySelector<HTMLElement>('.hf-sheet')!;
    expect(sheet.style.transform).toBe(`rotateX(${LIFT_DEG.toFixed(2)}deg)`);
    flip.set(1);
    expect(sheet.style.transform).toBe('rotateX(0.00deg)');
    flip.destroy();
  });
});

describe('pageCopy', () => {
  it('drops ids so a copy never clashes with the live page', () => {
    const el = document.createElement('div');
    el.id = 'cal-panel';
    const inner = Object.assign(document.createElement('span'), { id: 'inner' });
    const img = Object.assign(document.createElement('img'), { src: 'a.png' });
    img.setAttribute('loading', 'lazy');
    el.append(inner, img);
    const c = pageCopy(el);
    expect(c.id).toBe('');
    expect(c.querySelector('[id]')).toBeNull();
    expect(c.querySelector('img')!.getAttribute('loading')).toBe('eager');
    expect(el.id).toBe('cal-panel');
  });
});
