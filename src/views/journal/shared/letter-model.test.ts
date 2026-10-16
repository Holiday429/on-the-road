import { describe, expect, it } from 'vitest';
import {
  CARD_BORDER, PILE_WIDTH, cardWidth, envelopeTitle, hasLetter, letterDate, photoLean, pilePlan, postcardFrame, postcardTilt, stampParts,
} from './letter-model.ts';

describe('stampParts', () => {
  it('splits an ISO date the way a rubber stamp prints it', () => {
    expect(stampParts('2026-07-30')).toEqual({ day: '30', month: 'JUL', year: '2026' });
    expect(stampParts('2026-01-01')).toEqual({ day: '01', month: 'JAN', year: '2026' });
    expect(stampParts('2026-12-25')).toEqual({ day: '25', month: 'DEC', year: '2026' });
  });

  it('keeps a nonsense month rather than printing the wrong one', () => {
    expect(stampParts('2026-13-01').month).toBe('13');
    expect(stampParts('').day).toBe('');
  });
});

describe('photoLean', () => {
  it('is stable: the same photo leans the same way on every render', () => {
    expect(photoLean('entry-4', 2)).toBe(photoLean('entry-4', 2));
  });

  it('alternates direction so a stack of photos fans out', () => {
    expect(photoLean('e', 0)).toBeLessThan(0);
    expect(photoLean('e', 1)).toBeGreaterThan(0);
    expect(photoLean('e', 2)).toBeLessThan(0);
  });

  it('stays a small tilt — a taped photo, not a windmill', () => {
    for (let i = 0; i < 40; i++) {
      const lean = Math.abs(photoLean(`entry-${i}`, i));
      expect(lean).toBeGreaterThanOrEqual(1.2);
      expect(lean).toBeLessThanOrEqual(3);
    }
  });

  it('gives different photos of one entry different angles', () => {
    const angles = new Set([0, 1, 2, 3].map((i) => photoLean('same-entry', i)));
    expect(angles.size).toBeGreaterThan(1);
  });
});

describe('postcardTilt', () => {
  it('is fixed by entry id and position', () => {
    expect(postcardTilt('j6', 1)).toBe(postcardTilt('j6', 1));
  });

  it('leans 2°–5°, alternating sides', () => {
    for (let i = 0; i < 60; i++) {
      const tilt = postcardTilt(`entry-${i}`, i);
      expect(Math.abs(tilt)).toBeGreaterThanOrEqual(2);
      expect(Math.abs(tilt)).toBeLessThanOrEqual(5);
      expect(tilt < 0).toBe(i % 2 === 0);
    }
  });
});

describe('postcardFrame', () => {
  it('frames a photo as the standard shape it is within a few percent of', () => {
    expect(postcardFrame(1.52)).toEqual({ ratio: 1.5, known: true });
    expect(postcardFrame(0.74)).toEqual({ ratio: 0.75, known: true });
    expect(postcardFrame(1.78)).toMatchObject({ ratio: 16 / 9, known: true });
  });

  it('keeps an odd shape rather than cropping it to a standard one', () => {
    // a 2.2:1 panorama is not a 16:9
    expect(postcardFrame(2.2)).toEqual({ ratio: 2.2, known: true });
    // 1.15 sits between square and 4:3 and is neither
    expect(postcardFrame(1.15).ratio).toBe(1.15);
  });

  it('limits extreme shapes', () => {
    expect(postcardFrame(5).ratio).toBe(2.6);
    expect(postcardFrame(0.1).ratio).toBe(0.4);
  });

  it('shows an unmeasured photo as 3:2, flagged unknown', () => {
    expect(postcardFrame(undefined)).toEqual({ ratio: 1.5, known: false });
    expect(postcardFrame(NaN).known).toBe(false);
    expect(postcardFrame(0).known).toBe(false);
  });
});

describe('cardWidth', () => {
  it('gives a tall card less width than a wide one, within limits', () => {
    expect(cardWidth(0.75)).toBeLessThan(cardWidth(1.5));
    expect(cardWidth(16 / 9)).toBe(340);
    expect(cardWidth(0.4)).toBeGreaterThanOrEqual(200);
  });
});

describe('pilePlan', () => {
  const ratios = [0.75, 4 / 3, 2 / 3, 1.5, 16 / 9];

  it('is the same every time', () => {
    expect(pilePlan('j14', ratios)).toEqual(pilePlan('j14', ratios));
  });

  it('keeps each card the shape of its photo, border included', () => {
    for (const card of pilePlan('j14', ratios).cards) {
      const picture = (card.w - 2 * CARD_BORDER) / (card.h - 2 * CARD_BORDER);
      expect(picture).toBeCloseTo(card.frame.ratio, 1);
    }
  });

  it('puts every card inside the pile column', () => {
    const pile = pilePlan('j14', ratios);
    for (const c of pile.cards) {
      expect(c.left).toBeGreaterThanOrEqual(0);
      expect(c.left + c.w).toBeLessThanOrEqual(PILE_WIDTH);
    }
  });

  it('fans downward so each card has a strip to click', () => {
    const tops = pilePlan('j14', ratios).cards.map((c) => c.top);
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
    expect(new Set(tops).size).toBe(tops.length);
  });

  it('never grows past the height limit for a full nine', () => {
    const nine = pilePlan('x', Array(9).fill(2 / 3));
    expect(nine.height).toBeLessThanOrEqual(700);
    expect(new Set(nine.cards.map((c) => c.top)).size).toBe(9);
  });

  it('is just the one card for one photo, and nothing for none', () => {
    expect(pilePlan('x', [1.5]).cards).toHaveLength(1);
    expect(pilePlan('x', [1.5]).cards[0].top).toBe(0);
    expect(pilePlan('x', [])).toEqual({ width: PILE_WIDTH, height: 0, cards: [] });
  });

  it('lays out an unmeasured photo too', () => {
    expect(pilePlan('x', [undefined]).cards[0].frame.known).toBe(false);
  });
});

describe('hasLetter', () => {
  it('is true with words', () => {
    expect(hasLetter({ body: 'hello', images: ['a'] })).toBe(true);
  });
  it('is false for photos with no words', () => {
    expect(hasLetter({ body: '  ', images: ['a'] })).toBe(false);
    expect(hasLetter({ body: '', coverImage: 'a' })).toBe(false);
  });
  it('keeps a blank page for an entry with nothing, so the desk is not empty', () => {
    expect(hasLetter({ body: '', images: [] })).toBe(true);
  });
});

describe('envelopeTitle', () => {
  it('prefers the title, then the first line, then the place', () => {
    expect(envelopeTitle({ title: 'Nyhavn', body: 'x', destination: 'CPH' })).toBe('Nyhavn');
    expect(envelopeTitle({ title: '', body: 'First line\nsecond', destination: 'CPH' })).toBe('First line');
    expect(envelopeTitle({ title: '', body: '', destination: 'CPH' })).toBe('CPH');
    expect(envelopeTitle({ title: '', body: '', destination: '' })).toBe('');
  });

  it('cuts a long CJK line that has no spaces to break on', () => {
    const long = '字'.repeat(80);
    const out = envelopeTitle({ title: '', body: long, destination: '' });
    expect(out.length).toBe(36);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('letterDate', () => {
  it('writes the date and the place on one line', () => {
    expect(letterDate('2026-09-06', 'Copenhagen', 'en')).toBe('6 September 2026, Copenhagen');
    expect(letterDate('2026-09-06', '哥本哈根', 'zh')).toBe('2026年9月6日，哥本哈根');
  });

  it('drops the comma when there is no place', () => {
    expect(letterDate('2026-09-06', '  ', 'en')).toBe('6 September 2026');
  });

  it('falls back to the raw text for a date it cannot read', () => {
    expect(letterDate('not-a-date', '', 'en')).toBe('not-a-date');
  });
});
