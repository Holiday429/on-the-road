/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { LIFT_DEG, beginHingeFlip, commitsTurn, dragProgress, liftAngle, liftOpacity, liftShade, pageCopy } from './page-flip.ts';

describe('liftAngle', () => {
  it('lifts the leaving sheet 0 → LIFT_DEG going forward', () => {
    expect(liftAngle(0, 1)).toBe(0);
    expect(liftAngle(0.5, 1)).toBeCloseTo(LIFT_DEG / 2);
    expect(liftAngle(1, 1)).toBe(LIFT_DEG);
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

describe('liftOpacity', () => {
  it('is solid while the sheet is low and gone by the time it leaves', () => {
    expect(liftOpacity(0)).toBe(1);
    expect(liftOpacity(50)).toBe(1);
    expect(liftOpacity(80)).toBeLessThan(1);
    expect(liftOpacity(LIFT_DEG)).toBe(0);
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

  it('lays the sheet and the page under it over the host, and takes them away again', () => {
    const host = document.createElement('div');
    host.animate = (() => ({})) as never;
    const flip = beginHingeFlip(host, { dir: 1, sheet: mk('old'), under: mk('new') })!;
    expect(host.querySelector('.hf.is-forward .hf-sheet .is-front .old')).toBeTruthy();
    expect(host.querySelector('.hf-under .new')).toBeTruthy();
    flip.set(0.5);
    expect(host.querySelector<HTMLElement>('.hf-sheet')!.style.transform).toBe(`rotateX(${LIFT_DEG / 2}deg)`);
    flip.destroy();
    expect(host.querySelector('.hf')).toBeNull();
  });

  it('starts a backward turn lifted, and lands it flat', async () => {
    const host = document.createElement('div');
    host.animate = (() => ({})) as never;
    const flip = beginHingeFlip(host, { dir: -1, sheet: mk('arriving'), under: mk('leaving') })!;
    const sheet = host.querySelector<HTMLElement>('.hf-sheet')!;
    expect(sheet.style.transform).toBe(`rotateX(${LIFT_DEG}deg)`);
    flip.set(1);
    expect(sheet.style.transform).toBe('rotateX(0deg)');
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
