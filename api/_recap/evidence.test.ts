/**
 * The evidence packer.
 *
 * Two jobs, and the tests are split along them: sample WIDELY enough that four
 * very different kinds of journal all produce usable material (the universality
 * requirement), and stay inside a token budget while doing it (the cost one).
 * The interesting cases are the lopsided journals — all photos, all essays —
 * because a packer tuned on a mixed journal quietly fails those.
 */
import { describe, it, expect } from 'vitest';
import { buildEvidence, evidenceBudget } from './evidence';

const mk = (over: Record<string, unknown> = {}): any => ({
  id: Math.random().toString(36).slice(2),
  tripId: 't1', title: 'Untitled', body: '', template: 'moment',
  destination: 'Lisbon', tags: [], happenedOn: '2026-07-08', mood: '',
  favorite: false, visibility: 'private', slug: '', photoCount: 0,
  createdAt: 1, updatedAt: 1, ...over,
});

const para = (n: number) => 'x'.repeat(n);

describe('refs', () => {
  it('maps short refs to real ids both ways', () => {
    const entries = [mk({ id: 'aaa' }), mk({ id: 'bbb' })];
    const { refMap } = buildEvidence(entries);
    expect(refMap.e01).toBe('aaa');
    expect(refMap.e02).toBe('bbb');
  });

  it('uses refs short enough to be worth the indirection', () => {
    // The whole reason refs exist: a 32-char document id costs ~16 tokens and
    // appears in every chapter's citations.
    const { refMap } = buildEvidence([mk({ id: 'c'.repeat(32) })]);
    expect(Object.keys(refMap)[0].length).toBeLessThanOrEqual(4);
  });

  it('orders refs chronologically regardless of input order', () => {
    const { refMap } = buildEvidence([
      mk({ id: 'late', happenedOn: '2026-08-01' }),
      mk({ id: 'early', happenedOn: '2026-07-01' }),
    ]);
    expect(refMap.e01).toBe('early');
  });
});

describe('layering by genre', () => {
  it('keeps a fragment verbatim — it is already as short as it gets', () => {
    const body = '如果不能生活在童话世界，就在瑞士的小木屋住一晚吧！';
    const { pack } = buildEvidence([mk({ body })]);
    expect(pack.fragments[0].text).toBe(body);
  });

  it('reduces a mid-length note to its opening and closing sentence', () => {
    // The opening says what was seen and the close says what was concluded;
    // the middle is scaffolding a model can infer. Biggest saving in the pack.
    const body = `我对城市涂鸦总有一种刻板印象。${para(120)}。在柏林，涂鸦是一种更纯粹的态度。`;
    const { pack } = buildEvidence([mk({ body })]);
    const note = pack.notes[0];
    expect(note.open).toContain('刻板印象');
    expect(note.close).toContain('纯粹的态度');
    expect(note.open.length + note.close.length).toBeLessThan(body.length);
  });

  it('keeps a long entry\'s head, structure and tail, dropping the elaboration', () => {
    const body = [
      'First paragraph stating what was noticed on arriving.',
      para(600),
      '1. A numbered point',
      '2. Another numbered point',
      para(600),
      'Closing paragraph with the judgement reached.',
    ].join('\n');

    const { pack } = buildEvidence([mk({ body })]);
    const text = pack.longform[0].text;
    expect(text).toContain('First paragraph');
    expect(text).toContain('Closing paragraph');
    expect(text).toContain('1. A numbered point');
    expect(text.length).toBeLessThan(body.length / 2);
  });

  it('pulls quoted speech into its own layer', () => {
    const { pack } = buildEvidence([
      mk({ body: '他说“因为很喜欢迪士尼的公主，就买了。”我笑了。' }),
    ]);
    expect(pack.dialogue[0].lines).toContain('因为很喜欢迪士尼的公主，就买了。');
  });

  it('gives every entry a cheap title row, so the sample is never mistaken for the whole', () => {
    const entries = Array.from({ length: 30 }, (_, i) => mk({ title: `t${i}`, body: para(100) }));
    const { pack } = buildEvidence(entries);
    expect(pack.allTitles.length).toBe(30);
  });
});

describe('lopsided journals', () => {
  it('still produces material for a photos-and-titles-only journal', () => {
    // This is the user the design would most easily fail: nothing to read.
    // The titles layer has to carry it, and the place/photo counts come from
    // signals rather than here.
    const entries = Array.from({ length: 12 }, (_, i) =>
      mk({ title: `Evening ${i}`, body: '', photoCount: 2, destination: 'Malmo' }));

    const { pack } = buildEvidence(entries);
    expect(pack.titlesOnly.length).toBeGreaterThan(0);
    expect(pack.titlesOnly[0]).toContain('Malmo');
    expect(pack.titlesOnly[0]).toContain('📷');
    expect(pack.longform).toEqual([]);
    expect(pack.fragments).toEqual([]);
  });

  it('spreads the longform layer across places instead of over-sampling one city', () => {
    // Six essays about Copenhagen and one about Rome: Rome must survive, or
    // the portrait reads as a portrait of one city.
    const entries = [
      ...Array.from({ length: 6 }, () => mk({ destination: 'Copenhagen', body: para(1200) })),
      mk({ destination: 'Rome', body: para(900) }),
    ];
    const { pack } = buildEvidence(entries);
    const places = pack.longform.map((l) => l.place);
    expect(places).toContain('Rome');
    expect(places.filter((p) => p === 'Copenhagen').length).toBeLessThan(6);
  });

  it('handles a journal of nothing but one-liners', () => {
    const entries = Array.from({ length: 20 }, () => mk({ body: '垃圾桶会跟你说 Merci' }));
    const { pack } = buildEvidence(entries);
    expect(pack.fragments.length).toBeGreaterThan(0);
    expect(pack.notes).toEqual([]);
  });

  it('survives an empty journal', () => {
    const { pack, refMap } = buildEvidence([]);
    expect(refMap).toEqual({});
    expect(pack.allTitles).toEqual([]);
  });
});

describe('friction detection', () => {
  it('does not fire on ordinary prose that merely contains common negatives', () => {
    // Regression: the first pattern list included 没有 / 误 / 丢, which appear
    // constantly in normal travel writing, and every long entry looked like a
    // crisis. Nothing has gone wrong in either of these.
    const calm = [
      mk({ body: `漫无目的在山中闲逛，没有游人、只见牛羊。${para(100)}最后我们沿着玫瑰的指引走下山。` }),
      mk({ body: `这里没有wifi，店主解释说因为他们是卢德分子。${para(100)}于是我决定当一回卢德分子。` }),
    ];
    const { pack } = buildEvidence(calm);
    expect(pack.frictionRefs).toEqual([]);
  });

  it('ranks the most substantial trouble first, not the earliest', () => {
    // Slicing by date handed the model whichever mishap came early in the
    // itinerary, which is rarely the telling one.
    const early = mk({
      happenedOn: '2026-07-01',
      body: `火车取消了，只好改签。${para(90)}`,
    });
    const big = mk({
      happenedOn: '2026-08-01',
      body: `房间太热，睡不着，最后决定提前退房并申请退款。${para(400)}终于解决了。`,
    });
    const { pack, refMap } = buildEvidence([early, big]);
    expect(refMap[pack.frictionRefs[0]]).toBe(big.id);
  });

  it('needs both the trouble and the response, not just a complaint', () => {
    const complaint = mk({ body: `物价贵的离谱，什么都买不起，钱包憋憋的。${para(80)}` });
    const resolved = mk({
      body: '房间太热，睡不着，第二晚我在客厅沙发上躺了几个小时。'
        + `起来第一件事就是决定提前退房，最后联系客服说明了我的解决方案。${para(60)}`,
    });

    const { pack, refMap } = buildEvidence([complaint, resolved]);
    const resolvedRef = Object.keys(refMap).find((r) => refMap[r] === resolved.id)!;
    expect(pack.frictionRefs).toContain(resolvedRef);
    expect(pack.frictionRefs.length).toBe(1);
  });
});

describe('budget', () => {
  it('scales the allowance to how much the person wrote', () => {
    expect(evidenceBudget(10)).toBeLessThan(evidenceBudget(100));
  });

  it('caps the allowance so a prolific journal cannot blow the context', () => {
    expect(evidenceBudget(5000)).toBe(9000);
  });

  it('stays inside budget for a very large journal', () => {
    const entries = Array.from({ length: 400 }, (_, i) =>
      mk({ title: `Note ${i}`, body: para(1500), destination: `City${i % 20}` }));

    const { pack, chars } = buildEvidence(entries);
    expect(chars).toBeLessThanOrEqual(evidenceBudget(400) * 1.05);
    // The layer that shows how the person thinks is the one kept longest.
    expect(pack.longform.length).toBeGreaterThan(0);
  });

  it('sacrifices the cheap global map before the long-form reasoning', () => {
    const entries = Array.from({ length: 300 }, (_, i) =>
      mk({ title: `A fairly long title number ${i} to inflate the map`, body: para(2000) }));

    const { pack } = buildEvidence(entries);
    expect(pack.longform.length).toBeGreaterThan(0);
    expect(pack.allTitles.length).toBeLessThan(120);
  });
});
