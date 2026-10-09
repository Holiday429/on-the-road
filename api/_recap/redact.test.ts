/**
 * The privacy gate.
 *
 * This is the one file in the feature where a bug has a victim. A chapter held
 * back wrongly costs the owner a share card; a chapter released wrongly puts
 * someone's private life — often a travelling companion's, who never agreed to
 * any of this — on a public page. So every test here is written from the
 * second direction: given text that a model plausibly returns, does the gate
 * refuse it?
 */
import { describe, it, expect } from 'vitest';
import { applyPrivacyGate, judgePublicBody, PUBLIC_BODY_MAX } from './redact';

const names = ['Theis', 'Mikkel'];
const judge = (text: string) => judgePublicBody(text, names);

/** A clean public body of valid length, used as the baseline. */
const CLEAN = 'They handle trouble by separating the problem from the person, then acting before the mood sets in.';

describe('what passes', () => {
  it('accepts an abstracted judgement with no identifying detail', () => {
    expect(judge(CLEAN).ok).toBe(true);
  });

  it('accepts CJK text of a sensible length', () => {
    expect(judge('他处理麻烦的方式是分账：客观条件、对方的善意、流程、关系，四件事分开算。').ok).toBe(true);
  });
});

describe('what is refused', () => {
  it('refuses a name the traveller actually writes about', () => {
    // The point of seeding from the entries: no generic PII regex knows "Theis"
    // is a person, but this journal does.
    const verdict = judge('Their method shows most clearly in how they travel with Theis over a long trip.');
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons).toContain('person-name');
  });

  it('refuses relationship labels, in either language', () => {
    expect(judge('They are generous with a partner when the day goes wrong and nobody is at fault.').reasons)
      .toContain('relationship-label');
    expect(judge('和伴侣旅行时，他们从不把天气的难受算到对方头上，这是一种分账的能力。').reasons)
      .toContain('relationship-label');
  });

  it('refuses quoted speech even when the quote is flattering', () => {
    const verdict = judge('They defuse blame early, saying "this is not your fault" before resentment forms.');
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons).toContain('quoted-speech');
  });

  it('refuses money, in any of the formats these journals use', () => {
    for (const text of [
      `They weigh value oddly: paid 9 euros for the better juice without blinking once at it.`,
      `他们对价格敏感，但愿意为了一个等级的提升多付 1 欧元，这是一种取舍。`,
      `A $200 compensation offer was accepted mostly to stop the matter occupying their head.`,
    ]) {
      expect(judge(text).reasons).toContain('money');
    }
  });

  it('refuses health and body detail', () => {
    expect(judge('When the heat made them physically sick, they moved rather than endure it quietly.').reasons)
      .toContain('health');
  });

  it('refuses anything that pins down one real listing or host', () => {
    expect(judge('What they value in an Airbnb is a home first, which tells you how they read hospitality.').reasons)
      .toContain('vendor');
    expect(judge('他们最在意的是房东是否把房子当成自己的生活，而不是一桩生意，这是一种判断力。').reasons)
      .toContain('vendor');
  });

  it('refuses an address or room number', () => {
    expect(judge('They photographed the door number on leaving, which is how they mark a place as theirs.').reasons)
      .toContain('address');
  });

  it('refuses an empty or stub bodyPublic rather than sharing a fragment', () => {
    expect(judge('').ok).toBe(false);
    expect(judge('').reasons).toContain('empty');
    expect(judge('They are curious.').reasons).toContain('too-short');
  });

  it('collects every reason, so the owner sees all of them at once', () => {
    const verdict = judge('Travelling with Theis, a partner, they said "it is fine" after paying 200 euros.');
    expect(verdict.reasons).toEqual(expect.arrayContaining([
      'person-name', 'relationship-label', 'quoted-speech', 'money',
    ]));
  });

  it('does not fire on a name that is merely a substring of a word', () => {
    // 'Mikkel' inside a longer token must not trip the word-boundary check.
    expect(judge('Their approach to Mikkelsenism is irrelevant here, it is about method and pace.').reasons)
      .not.toContain('person-name');
  });
});

describe('length handling', () => {
  it('trims an otherwise-clean body that only overran the layout', () => {
    // The one failure that can be fixed instead of refused: losing a trailing
    // clause costs a nuance, not the judgement.
    const long = `${CLEAN} There is a further clause here that pushes it past the layout limit for one card.`;
    expect(long.length).toBeGreaterThan(PUBLIC_BODY_MAX);

    const { chapters, report } = applyPrivacyGate(
      [chapter({ bodyPublic: long })],
      ['Theis showed me the backstage.', 'Theis wanted Rome.'],
    );
    expect(chapters[0].shareable).toBe(true);
    expect(chapters[0].bodyPublic.length).toBeLessThanOrEqual(PUBLIC_BODY_MAX);
    expect(report.attention).toEqual(['trimmed']);
  });

  it('will not trim its way out of a disclosure', () => {
    // Over-long AND contains a name: trimming is not offered, because the fix
    // for a leak is not a shorter leak.
    const long = `Travelling with Theis over several weeks, ${CLEAN} and a little more text besides.`;
    const { chapters } = applyPrivacyGate(
      [chapter({ bodyPublic: long })],
      ['Theis showed me the backstage.', 'Theis wanted Rome.'],
    );
    expect(chapters[0].shareable).toBe(false);
  });
});

describe('flags', () => {
  it('lists the reasons on a flagged chapter, and none on a clean one', () => {
    const leaking = chapter({ bodyPublic: 'They travel with a partner, said "it is fine", and paid 200 euros for peace.' });
    const { chapters } = applyPrivacyGate([leaking, chapter()], []);
    expect(chapters[0].flags).toEqual(expect.arrayContaining(['relationship-label', 'quoted-speech', 'money']));
    expect(chapters[0].shareable).toBe(false);
    expect(chapters[1].flags).toEqual([]);
  });

  it('judges the plain text, so the emphasis marker neither trips nor hides anything', () => {
    expect(judge('They handle trouble by separating the problem from the person, **then acting before the mood sets in.**').ok).toBe(true);
    expect(judge('They travel with **Theis** over a long trip and keep their patience through every delay.').reasons).toContain('person-name');
  });

  it('clears the flag when a too-long text can be trimmed cleanly', () => {
    const long = `${CLEAN} There is a further clause here that pushes it past the layout limit for one card.`;
    const { chapters } = applyPrivacyGate([chapter({ bodyPublic: long })], []);
    expect(chapters[0].flags).toEqual([]);
  });
});

describe('the gate overrides the model', () => {
  it('ignores shareable:true on a chapter that leaks', () => {
    const { chapters } = applyPrivacyGate(
      [chapter({ bodyPublic: 'They are at their best with Theis, who brings out their patience.', shareable: true })],
      ['Theis showed me the backstage.', 'Theis wanted Rome.'],
    );
    expect(chapters[0].shareable).toBe(false);
  });

  it('grants shareable on a clean chapter the model marked false', () => {
    const { chapters } = applyPrivacyGate([chapter({ bodyPublic: CLEAN, shareable: false })], []);
    expect(chapters[0].shareable).toBe(true);
  });

  it('holds back everything when the model skipped bodyPublic entirely', () => {
    // Default-deny in practice: a model that writes only `body` shares nothing.
    const { chapters } = applyPrivacyGate(
      [chapter({ body: 'A long private reading full of specifics.', bodyPublic: '' })],
      [],
    );
    expect(chapters[0].shareable).toBe(false);
  });

  it('only consults names that recur, not every capitalised word', () => {
    // 'Venice' appears in one entry; a place mentioned once is not a person,
    // and gating on it would withhold chapters for no reason.
    const { chapters } = applyPrivacyGate(
      [chapter({ bodyPublic: CLEAN })],
      ['Venice was quiet that night.', 'The island was empty of tourists.'],
    );
    expect(chapters[0].shareable).toBe(true);
  });
});

function chapter(over: Record<string, unknown> = {}): any {
  return {
    id: 'attention', heading: 'What you look at',
    body: 'private version', bodyPublic: CLEAN,
    evidenceRefs: [], shareable: false, flags: [], ...over,
  };
}
