/**
 * The portrait's behavioural layer.
 *
 * These are the signals the model can't compute and shouldn't be asked to: how
 * often someone wrote, which habits lapsed, whether the place they wrote about
 * most is the place they wrote about longest. The tests pin the readings that
 * carry an actual personality claim, because a wrong reading there doesn't
 * produce a worse portrait — it produces a confident falsehood about a person.
 */
import { describe, it, expect } from 'vitest';
import { bucketOf, computeSignals, extractNameCandidates, lastSentence } from './signals';

const mk = (over: Record<string, unknown> = {}): any => ({
  id: Math.random().toString(36).slice(2),
  title: '', body: '', destination: 'Lisbon', happenedOn: '2026-07-08',
  photoCount: 0, ...over,
});

describe('length buckets', () => {
  it('treats an empty body as its own genre, not as missing data', () => {
    // A photo-first recorder's entries all land here. If this collapsed into
    // "fragment" the portrait would read them as terse writing rather than as
    // a deliberate choice not to write.
    expect(bucketOf(0)).toBe('captionOnly');
    expect(bucketOf(1)).toBe('fragment');
  });

  it('separates genres rather than splitting the range evenly', () => {
    expect(bucketOf(26)).toBe('fragment');    // a two-line thought
    expect(bucketOf(155)).toBe('note');
    expect(bucketOf(700)).toBe('essay');
    expect(bucketOf(1987)).toBe('longform');  // an essay with headings
  });
});

describe('rhythm', () => {
  it('counts recording days against the span, not entries against days', () => {
    const s = computeSignals([
      mk({ happenedOn: '2026-07-01' }),
      mk({ happenedOn: '2026-07-01' }),
      mk({ happenedOn: '2026-07-03' }),
    ]);
    expect(s.activeDays).toBe(2);
    expect(s.tripSpanDays).toBe(3);
    expect(s.burstDays).toBe(1);
    expect(s.maxBurst).toBe(2);
  });

  it('reports where the longest silence fell, not just its length', () => {
    // Wrote on day 1, then nothing until day 20: a gap this early reads as
    // warming up, which is a different person from one who tails off at the end.
    const s = computeSignals([
      mk({ happenedOn: '2026-07-01' }),
      mk({ happenedOn: '2026-07-20' }),
      mk({ happenedOn: '2026-07-21' }),
      mk({ happenedOn: '2026-07-22' }),
    ]);
    expect(s.longestSilence).toBe(18);
    expect(s.silencePosition).toBe('early');
  });

  it('calls a short, evenly-spread gap no silence at all', () => {
    const s = computeSignals([
      mk({ happenedOn: '2026-07-01' }),
      mk({ happenedOn: '2026-07-02' }),
      mk({ happenedOn: '2026-07-03' }),
    ]);
    expect(s.silencePosition).toBe('none');
  });
});

describe('depth vs density', () => {
  it('flags writing longest about a place other than the most-written one', () => {
    // The strongest single tell in the whole layer: it means analysis is how
    // this person handles distance and plain description is how they handle
    // closeness. Four short notes in one city, two long ones in another.
    const entries = [
      ...Array.from({ length: 4 }, () => mk({ destination: 'Copenhagen', body: 'x'.repeat(50) })),
      mk({ destination: 'Brussels', body: 'y'.repeat(900) }),
      mk({ destination: 'Brussels', body: 'y'.repeat(700) }),
    ];
    const s = computeSignals(entries);
    expect(s.densestPlace).toBe('Copenhagen');
    expect(s.deepestPlace).toBe('Brussels');
    expect(s.depthDensityMismatch).toBe(true);
  });

  it('will not crown a place visited once as the deepest', () => {
    // One 1900-char essay says something about that day, not about the place.
    const entries = [
      mk({ destination: 'Lisbon', body: 'x'.repeat(200) }),
      mk({ destination: 'Lisbon', body: 'x'.repeat(200) }),
      mk({ destination: 'Venice', body: 'y'.repeat(1900) }),
    ];
    const s = computeSignals(entries);
    expect(s.deepestPlace).toBe('Lisbon');
    expect(s.depthDensityMismatch).toBe(false);
  });
});

describe('voice', () => {
  it('counts quoted dialogue across scripts', () => {
    const s = computeSignals([
      mk({ body: '他说“因为很喜欢，就买了。”我笑了。' }),
      mk({ body: 'She asked "can I play the piano?" before sitting down.' }),
      mk({ body: 'no quotes at all in this one' }),
    ]);
    expect(s.dialogueRatio).toBeCloseTo(0.67, 1);
  });

  it('separates a we-traveller from an I-traveller', () => {
    const together = computeSignals([
      mk({ body: '我们决定先休整一下。' }),
      mk({ body: '我们走了很久的路。' }),
    ]);
    expect(together.firstPersonPluralRatio).toBe(1);

    const alone = computeSignals([
      mk({ body: '我一个人走到海边。' }),
      mk({ body: '我停下脚步看了很久。' }),
    ]);
    expect(alone.firstPersonPluralRatio).toBe(0);
  });

  it('notices endings left deliberately open', () => {
    const s = computeSignals([
      mk({ body: '这座城市有很多问题。就等下一次再丰富或打破吧' }),
      mk({ body: '今天天气很好。' }),
    ]);
    expect(s.openEndedEndingRatio).toBe(0.5);
  });

  it('finds structured, numbered thinking', () => {
    const s = computeSignals([
      mk({ body: '走在坡路上我想到：\n1. 起起落落是常态\n2. 方向同样重要' }),
      mk({ body: 'just a plain line' }),
    ]);
    expect(s.listicleCount).toBe(1);
  });
});

describe('sentence edges', () => {
  it('does not return a bare quote mark as the closing thought', () => {
    // Regression: an entry ending on a line of dialogue split into a final
    // piece that was just `”`, which the notes layer then sent to the model as
    // "what this person concluded" — a token spent to say nothing.
    const s = computeSignals([
      mk({ body: '我问他为什么会有这个？\n“因为很喜欢，就买了。”\n“很好，以后每次我来的时候就可以用了。”' }),
    ]);
    expect(s.entryCount).toBe(1);
    expect(lastSentence('他说“好的。”\n“那就这样吧。”')).toContain('那就这样');
    expect(lastSentence('他说“好的。”')).not.toMatch(/^[”"]$/);
  });

  it('still returns a quoted sentence when that is the real content', () => {
    expect(lastSentence('“被尊重的感觉真好。”')).toContain('被尊重');
  });
});

describe('recurring people', () => {
  it('counts a name only once it appears in more than one entry', () => {
    const names = extractNameCandidates([
      'Theis showed me the backstage today.',
      'Theis wanted to go to Rome.',
      'Mikkel only turns up here once.',
    ]);
    expect(names.get('Theis')).toBe(2);
    expect(names.get('Mikkel')).toBe(1);
  });

  it('does not mistake sentence-initial common words for people', () => {
    const names = extractNameCandidates([
      'The train was late. When it arrived we boarded.',
      'The weather turned. When we left it was raining.',
    ]);
    expect(names.has('The')).toBe(false);
    expect(names.has('When')).toBe(false);
  });

  it('leaves a CJK-only journal at zero rather than guessing', () => {
    // No capitalisation to key off, so this under-counts by design. The
    // portrait must read 0 as "unknown" and lean on we-vs-I instead — never
    // as "travelled alone", which would be a fabricated biographical claim.
    const s = computeSignals([
      mk({ body: '朋友带我参观他工作的后台。' }),
      mk({ body: '朋友说要帮我找枕头和被子。' }),
    ]);
    expect(s.namedPeopleCount).toBe(0);
    expect(s.firstPersonPluralRatio).toBe(0);
  });
});

describe('edges', () => {
  it('survives an empty journal', () => {
    const s = computeSignals([]);
    expect(s.entryCount).toBe(0);
    expect(s.cadence).toBe(0);
    expect(s.depthDensityMismatch).toBe(false);
  });

  it('survives a journal of photos with no words', () => {
    const s = computeSignals([
      mk({ body: '', photoCount: 2 }),
      mk({ body: '', photoCount: 1 }),
    ]);
    expect(s.lengthBuckets.captionOnly).toBe(2);
    expect(s.photoOnlyRatio).toBe(1);
    expect(s.lengthRange).toEqual([0, 0]);
    expect(s.dialogueRatio).toBe(0); // no division by zero
  });

  it('rates a one-genre journal as narrow and a mixed one as wide', () => {
    const uniform = computeSignals(
      Array.from({ length: 6 }, () => mk({ body: 'x'.repeat(100) })),
    );
    const mixed = computeSignals([
      mk({ body: '' }), mk({ body: 'x'.repeat(30) }), mk({ body: 'x'.repeat(150) }),
      mk({ body: 'x'.repeat(500) }), mk({ body: 'x'.repeat(1200) }),
    ]);
    expect(uniform.styleSpread).toBe(0);
    expect(mixed.styleSpread).toBeGreaterThan(0.9);
  });
});
