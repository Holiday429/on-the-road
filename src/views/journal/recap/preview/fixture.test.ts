/**
 * The sample portraits are the only place the real copy lives, so they double as
 * the content spec: if a sentence here would not fit a card, or leans on the
 * things the portrait is not allowed to lean on, the layout work was judged
 * against something the product can never produce.
 */
import { describe, it, expect } from 'vitest';
import { CJK_LIMITS, LATIN_LIMITS } from '../../../../../api/_recap/limits.ts';
import { judgePublicBody } from '../../../../../api/_recap/redact.ts';
import { RECAP_CHAPTER_IDS } from '../../../../data/schema.ts';
import { plainText } from '../emphasis.ts';
import { europeEn, europeZh, flagged, overflow, overflowEn, signalsOnly } from './fixture.ts';

const REAL = [
  { name: 'zh', recap: europeZh, L: CJK_LIMITS },
  { name: 'en', recap: europeEn, L: LATIN_LIMITS },
];

describe.each(REAL)('real portrait ($name)', ({ recap, L }) => {
  it('fits every limit the prompt promises the model', () => {
    expect(recap.archetype.label.length).toBeLessThanOrEqual(L.label);
    expect(recap.archetype.tagline.length).toBeLessThanOrEqual(L.tagline);
    expect(recap.oneLine.length).toBeLessThanOrEqual(L.oneLine);
    recap.traits.forEach((t) => {
      expect(t.key.length).toBeLessThanOrEqual(L.traitKey);
      expect(t.note.length).toBeLessThanOrEqual(L.traitNote);
    });
    recap.numbers.forEach((n) => {
      expect(n.label.length).toBeLessThanOrEqual(L.numLabel);
      expect(n.caption).toBe(''); // no captions any more
    });
    recap.questions.forEach((q) => expect(q.length).toBeLessThanOrEqual(L.question));
    recap.chapters.forEach((c) => {
      // Measured on the plain text: the emphasis marker is presentation.
      const body = plainText(c.body);
      const pub = plainText(c.bodyPublic);
      expect(c.heading.length).toBeLessThanOrEqual(L.heading);
      expect(body.length).toBeGreaterThanOrEqual(L.bodyMin);
      expect(body.length).toBeLessThanOrEqual(L.bodyMax);
      expect(pub.length).toBeGreaterThanOrEqual(L.pubMin);
      expect(pub.length).toBeLessThanOrEqual(L.pubMax);
      expect(body.length).toBeGreaterThanOrEqual(pub.length);
    });
  });

  it('has the shape the deck is built for', () => {
    expect(recap.traits).toHaveLength(4);
    expect(recap.numbers).toHaveLength(6);
    expect(recap.questions).toHaveLength(3);
    expect(recap.chapters.map((c) => c.id)).toEqual([...RECAP_CHAPTER_IDS]);
  });

  it('has public text that passes the privacy gate', () => {
    for (const c of recap.chapters) {
      const verdict = judgePublicBody(c.bodyPublic, [], L.pubMax);
      expect({ chapter: c.id, reasons: verdict.reasons }).toEqual({ chapter: c.id, reasons: [] });
    }
  });

  it('does not lean on tags, moods or other metadata', () => {
    // The owner's call: tags are skipped for reasons that say nothing about them.
    const text = JSON.stringify([recap.chapters, recap.traits, recap.numbers, recap.oneLine, recap.questions]);
    expect(text).not.toMatch(/标签|tag(?:s|ging)?\b|\bmood|情绪字段|label vocab/i);
  });

  it('names no recurring person', () => {
    expect(JSON.stringify(recap.chapters)).not.toMatch(/Theis/);
  });

  it('marks exactly one key sentence in every chapter, in both texts', () => {
    for (const c of recap.chapters) {
      expect((c.body.match(/\*\*/g) ?? []).length).toBe(2);
      expect((c.bodyPublic.match(/\*\*/g) ?? []).length).toBe(2);
    }
  });

  it('asks three questions from three different angles', () => {
    expect(new Set(recap.questions).size).toBe(3);
  });
});

describe('stress fixtures', () => {
  it('sits exactly on the CJK limits', () => {
    expect(overflow.archetype.label).toHaveLength(CJK_LIMITS.label);
    expect(overflow.chapters[0].body).toHaveLength(CJK_LIMITS.bodyMax);
    expect(overflow.chapters[0].bodyPublic).toHaveLength(CJK_LIMITS.pubMax);
    expect(overflow.questions[0]).toHaveLength(CJK_LIMITS.question);
  });

  it('sits exactly on the Latin limits', () => {
    expect(overflowEn.archetype.label.length).toBe(LATIN_LIMITS.label);
    expect(overflowEn.chapters[0].body).toHaveLength(LATIN_LIMITS.bodyMax);
    expect(overflowEn.chapters[0].bodyPublic).toHaveLength(LATIN_LIMITS.pubMax);
  });
});

describe('edge fixtures', () => {
  it('flags the chapters about other people and keeps their text, so the owner can decide', () => {
    const marked = flagged.chapters.filter((c) => c.flags.length > 0);
    expect(marked.map((c) => c.id)).toEqual(['relations', 'friction']);
    expect(marked.every((c) => !c.shareable && c.bodyPublic.length > 0)).toBe(true);
  });

  it('has a numbers-only card with no archetype and no chapters', () => {
    expect(signalsOnly.source).toBe('signals');
    expect(signalsOnly.archetype.label).toBe('');
    expect(signalsOnly.chapters).toEqual([]);
    expect(signalsOnly.numbers.length).toBeGreaterThan(0);
  });
});
