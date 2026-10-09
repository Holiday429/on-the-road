import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const verifyAndMeter = vi.fn();
vi.mock('./_guard', () => ({ verifyAndMeter: (...a: unknown[]) => verifyAndMeter(...a) }));

function makeReq(body: unknown, opts: { method?: string } = {}) {
  const withIntent = body && typeof body === 'object' && !Array.isArray(body) ? { userInitiated: true, ...body } : body;
  return { method: opts.method ?? 'POST', headers: {}, body: withIntent } as unknown as
    import('http').IncomingMessage & { body: Record<string, unknown>; headers: Record<string, string>; method: string };
}

function makeRes() {
  const res: {
    statusCode?: number; body?: any;
    status: (c: number) => typeof res; json: (d: unknown) => void;
    setHeader: (k: string, v: string) => void; end: () => void;
  } = {
    status(code: number) { res.statusCode = code; return res; },
    json(data: unknown) { res.body = data; },
    setHeader() {},
    end() {},
  };
  return res;
}

/** Guard that lets the request through as user u1. */
const allow = () => verifyAndMeter.mockResolvedValue('u1');

const entry = (i: number, over: Record<string, unknown> = {}) => ({
  id: `id${i}`,
  happenedOn: `2026-07-${String(i + 1).padStart(2, '0')}`,
  title: `Title ${i}`,
  body: 'A note about the day. Theis said hello and we walked on, then it ended.',
  destination: i % 2 ? 'Lisbon' : 'Berlin',
  photoCount: 1,
  ...over,
});
const journal = (n: number) => Array.from({ length: n }, (_, i) => entry(i));

const CLEAN = 'They handle trouble by separating the problem from the person, then acting before the mood sets in.';

/** A model reply carrying every chapter; individual tests override pieces of it. */
function modelReply(over: Record<string, unknown> = {}, chapterOver: Record<string, unknown> = {}) {
  return {
    archetype: { label: 'System Watcher', tagline: 'Records how a thing was designed' },
    traits: [1, 2, 3, 4].map((n) => ({ key: `trait${n}`, score: 40 + n * 10, note: 'note' })),
    numbers: ['a', 'c', 'e', 'g', 'i', 'k'].map((l) => ({ label: l })),
    chapters: ['attention', 'method', 'relations', 'friction', 'recording', 'throughline'].map((id) => ({
      id, heading: id, body: `private reading for ${id}`, bodyPublic: CLEAN, evidenceRefs: ['e01'], ...chapterOver,
    })),
    oneLine: 'A line.',
    questions: ['Look at what?', 'Choose how?', 'Write when?'],
    ...over,
  };
}

function stubModel(reply: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok,
    text: async () => 'upstream error',
    json: async () => ({ choices: [{ message: { content: typeof reply === 'string' ? reply : JSON.stringify(reply) } }] }),
  })));
}

beforeEach(() => {
  vi.resetModules();
  verifyAndMeter.mockReset();
  process.env.DEEPSEEK_API_KEY = 'test-key';
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('unexpected network call in test'); }));
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('/api/recap · request handling', () => {
  it('rejects non-POST methods without touching the guard', async () => {
    const { default: handler } = await import('./recap');
    const res = makeRes();
    await handler(makeReq({}, { method: 'GET' }) as never, res as never);
    expect(res.statusCode).toBe(405);
    expect(verifyAndMeter).not.toHaveBeenCalled();
  });

  it('refuses any request that is not flagged as a user tap, before the guard or the model', async () => {
    const { default: handler } = await import('./recap');
    for (const flag of [undefined, false, 'true', 1, null]) {
      const res = makeRes();
      await handler(makeReq({ entries: journal(10), tripId: 't1', userInitiated: flag }) as never, res as never);
      expect(res.statusCode).toBe(400);
    }
    expect(verifyAndMeter).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a missing or empty entry list before charging anything', async () => {
    const { default: handler } = await import('./recap');
    for (const body of [{}, { entries: [] }, { entries: 'nope' }, { entries: [{ junk: true }] }]) {
      const res = makeRes();
      await handler(makeReq(body) as never, res as never);
      expect(res.statusCode).toBe(400);
    }
    expect(verifyAndMeter).not.toHaveBeenCalled();
  });

  it('refuses an oversized journal before charging anything', async () => {
    const { default: handler } = await import('./recap');
    const res = makeRes();
    await handler(makeReq({ entries: journal(801).map((e, i) => ({ ...e, id: `x${i}` })) }) as never, res as never);
    expect(res.statusCode).toBe(413);
    expect(verifyAndMeter).not.toHaveBeenCalled();
  });

  it('stops where the guard stops it', async () => {
    verifyAndMeter.mockImplementation(async (_r: unknown, res: { status: (c: number) => { json: (d: unknown) => void } }) => {
      res.status(402).json({ error: 'quota_exceeded' });
      return null;
    });
    const { default: handler } = await import('./recap');
    const res = makeRes();
    await handler(makeReq({ entries: journal(10), tripId: 't1' }) as never, res as never);
    expect(res.statusCode).toBe(402);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('/api/recap · small journals', () => {
  it('returns a numbers-only card for free, without calling the model', async () => {
    allow();
    const { default: handler } = await import('./recap');
    const res = makeRes();
    await handler(makeReq({ entries: journal(3), tripId: 't1' }) as never, res as never);

    expect(verifyAndMeter).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.objectContaining({ chargeable: false }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.draft.source).toBe('signals');
    expect(res.body.draft.chapters).toEqual([]);
    expect(res.body.draft.numbers.length).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('/api/recap · portrait', () => {
  it('charges a credit and returns a finished document', async () => {
    allow();
    stubModel(modelReply());
    const { default: handler } = await import('./recap');
    const res = makeRes();
    await handler(makeReq({ entries: journal(12), tripId: 'trip1' }) as never, res as never);

    expect(verifyAndMeter).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.objectContaining({ tripId: 'trip1', chargeable: true }),
    );
    expect(res.statusCode).toBe(200);
    const { draft } = res.body;
    expect(draft.source).toBe('ai');
    expect(draft.tripId).toBe('trip1');
    expect(draft.entryCount).toBe(12);
    expect(draft.chapters).toHaveLength(6);
    expect(draft.archetype.label).toBe('System Watcher');
    expect(draft.visibility).toBe('private');
    expect(draft.sourceHash).toBeTruthy();
  });

  it('maps short refs back to real entry ids for the client to store', async () => {
    allow();
    stubModel(modelReply());
    const { default: handler } = await import('./recap');
    const res = makeRes();
    await handler(makeReq({ entries: journal(10) }) as never, res as never);
    expect(res.body.draft.refMap.e01).toBe('id0');
    expect(Object.keys(res.body.draft.refMap)).toHaveLength(10);
  });

  it('takes figures from signals, never from the model', async () => {
    allow();
    // The model tries to supply its own value for a tile.
    stubModel(modelReply({ numbers: [{ label: 'x', caption: 'y', value: '999 days' }] }));
    const { default: handler } = await import('./recap');
    const res = makeRes();
    await handler(makeReq({ entries: journal(10) }) as never, res as never);
    expect(JSON.stringify(res.body.draft.numbers)).not.toContain('999');
  });

  it('enforces the layout length limits even when the model overruns them (CJK tier)', async () => {
    allow();
    stubModel(modelReply({
      archetype: { label: 'x'.repeat(40), tagline: 'y'.repeat(90) },
      traits: [1, 2, 3, 4, 5, 6].map((n) => ({ key: 'k'.repeat(30), score: 500, note: `${n}`.repeat(90) })),
      oneLine: 'o'.repeat(300),
    }));
    const { default: handler } = await import('./recap');
    const res = makeRes();
    await handler(makeReq({ entries: journal(10), lang: 'Simplified Chinese' }) as never, res as never);

    const { draft } = res.body;
    expect(draft.archetype.label.length).toBeLessThanOrEqual(14);
    expect(draft.archetype.tagline.length).toBeLessThanOrEqual(30);
    expect(draft.traits).toHaveLength(4);                       // radar has four axes
    expect(draft.traits.every((t: any) => t.score <= 100 && t.key.length <= 12 && t.note.length <= 40)).toBe(true);
    expect(draft.oneLine.length).toBeLessThanOrEqual(60);
  });

  it('drops evidence refs the model invented', async () => {
    allow();
    stubModel(modelReply({}, { evidenceRefs: ['e01', 'e99', 'not-a-ref'] }));
    const { default: handler } = await import('./recap');
    const res = makeRes();
    await handler(makeReq({ entries: journal(10) }) as never, res as never);
    expect(res.body.draft.chapters[0].evidenceRefs).toEqual(['e01']);
  });

  it('ignores shareable:true from the model and applies the privacy gate itself', async () => {
    allow();
    const leaking = 'They are at their best when travelling with Theis, who brings out their patience.';
    stubModel({
      ...modelReply(),
      chapters: modelReply().chapters.map((c, i) => (
        i === 0 ? { ...c, bodyPublic: leaking, shareable: true } : { ...c, shareable: false }
      )),
    });
    const { default: handler } = await import('./recap');
    const res = makeRes();
    await handler(makeReq({ entries: journal(10) }) as never, res as never);

    const byId = Object.fromEntries(res.body.draft.chapters.map((c: any) => [c.id, c]));
    expect(byId.attention.shareable).toBe(false);          // leaks a recurring name
    expect(res.body.privacyReport.attention).toContain('person-name');
    expect(byId.method.shareable).toBe(true);              // clean, though the model said false
  });

  it('answers 502 and stores nothing when the model returns an unusable portrait', async () => {
    allow();
    stubModel({ archetype: { label: 'x' }, chapters: [] });
    const { default: handler } = await import('./recap');
    const res = makeRes();
    await handler(makeReq({ entries: journal(10) }) as never, res as never);
    expect(res.statusCode).toBe(502);
    expect(res.body.draft).toBeUndefined();
  });

  it('answers 502 when the provider call fails', async () => {
    allow();
    stubModel('', false);
    const { default: handler } = await import('./recap');
    const res = makeRes();
    await handler(makeReq({ entries: journal(10) }) as never, res as never);
    expect(res.statusCode).toBe(502);
  });

  it('never puts photo URLs or other fields in the prompt', async () => {
    allow();
    stubModel(modelReply());
    const { default: handler } = await import('./recap');
    const res = makeRes();
    const entries = journal(10).map((e) => ({ ...e, images: ['https://secret/x.jpg'], coverImage: 'https://secret/c.jpg' }));
    await handler(makeReq({ entries }) as never, res as never);

    const sent = JSON.parse((fetch as any).mock.calls[0][1].body).messages[0].content as string;
    expect(sent).not.toContain('secret');
  });
});

describe('/api/recap · content rules', () => {
  it('never sends tags, mood or favourites to the model, even if the client includes them', async () => {
    allow();
    stubModel(modelReply());
    const { default: handler } = await import('./recap');
    const res = makeRes();
    const entries = journal(10).map((e) => ({ ...e, tags: ['secrettag'], mood: 'secretmood', favorite: true }));
    await handler(makeReq({ entries }) as never, res as never);

    const sent = JSON.parse((fetch as any).mock.calls[0][1].body).messages[0].content as string;
    expect(sent).not.toContain('secrettag');
    expect(sent).not.toContain('secretmood');
    expect(sent).not.toMatch(/"tagging"|"moodField"/);
  });

  it('asks for three questions and keeps at most three', async () => {
    allow();
    stubModel(modelReply({ questions: ['one?', 'two?', 'three?', 'four?', '', 7] }));
    const { default: handler } = await import('./recap');
    const res = makeRes();
    await handler(makeReq({ entries: journal(10) }) as never, res as never);
    expect(res.body.draft.questions).toEqual(['one?', 'two?', 'three?']);
    expect(res.body.draft.question).toBeUndefined();
  });

  it('has no rarity field any more', async () => {
    allow();
    stubModel(modelReply({ archetype: { label: 'L', tagline: 'T', rarity: 'Top 9%' } }));
    const { default: handler } = await import('./recap');
    const res = makeRes();
    await handler(makeReq({ entries: journal(10) }) as never, res as never);
    expect(res.body.draft.archetype).toEqual({ label: 'L', tagline: 'T' });
  });

  it('builds one overview tile per figure, with values from signals and words from the model', async () => {
    allow();
    stubModel(modelReply());
    const { default: handler } = await import('./recap');
    const res = makeRes();
    await handler(makeReq({ entries: journal(12) }) as never, res as never);

    const { numbers } = res.body.draft;
    expect(numbers.length).toBeGreaterThanOrEqual(4);
    expect(numbers.length).toBeLessThanOrEqual(6);
    expect(numbers[0].value).toBe('12 / 12');         // recording days / trip span
    expect(numbers[0].label).toBe('a');               // the model's label
    expect(numbers.every((n: any) => n.caption === '')).toBe(true); // no captions any more
    // The prompt told the model what each figure is about.
    const sent = JSON.parse((fetch as any).mock.calls[0][1].body).messages[0].content as string;
    expect(sent).toContain('days with at least one note');
  });

  it('does not offer a "text-less notes" tile', async () => {
    allow();
    stubModel(modelReply());
    const { default: handler } = await import('./recap');
    const res = makeRes();
    const entries = journal(10).map((e, i) => (i < 4 ? { ...e, body: '' } : e));
    await handler(makeReq({ entries }) as never, res as never);
    const text = JSON.stringify(res.body.draft.numbers);
    expect(text).not.toMatch(/image only|wordless|no text/i);
  });

  it('caps trait keys by script: six CJK glyphs, twelve Latin letters', async () => {
    allow();
    stubModel(modelReply({
      traits: [
        { key: '不确定性偏好很强烈', score: 80, note: 'n' },
        { key: 'Systems thinking, deeply', score: 70, note: 'n' },
        { key: '系统视角', score: 60, note: 'n' },
        { key: 'Drift', score: 50, note: 'n' },
      ],
    }));
    const { default: handler } = await import('./recap');
    const res = makeRes();
    await handler(makeReq({ entries: journal(10) }) as never, res as never);
    const keys = res.body.draft.traits.map((t: any) => t.key);
    expect(keys[0]).toHaveLength(6);
    expect(keys[1].length).toBeLessThanOrEqual(12);
    expect(keys[2]).toBe('系统视角');
  });

  it('allows public bodies up to the card limit and no further', async () => {
    allow();
    const within = '他们处理麻烦时先分开事实与情绪，再决定要不要为它花力气，所以很少被一件小事拖住一整天。'.repeat(1); // < 150
    stubModel(modelReply({}, { bodyPublic: within }));
    const { default: handler } = await import('./recap');
    const res = makeRes();
    await handler(makeReq({ entries: journal(10) }) as never, res as never);
    expect(res.body.draft.chapters.every((c: any) => c.shareable)).toBe(true);
  });
});

describe('/api/recap · limits by output language', () => {
  it('tells the model the tight limits for Chinese and the roomy ones for English', async () => {
    for (const [lang, expectTagline] of [['Simplified Chinese', '<= 30'], ['English', '<= 60']] as const) {
      allow();
      stubModel(modelReply());
      vi.resetModules();
      const { default: handler } = await import('./recap');
      const res = makeRes();
      await handler(makeReq({ entries: journal(10), lang }) as never, res as never);
      const sent = JSON.parse((fetch as any).mock.calls.at(-1)[1].body).messages[0].content as string;
      expect(sent).toContain(`archetype.tagline   ${expectTagline}`);
    }
  });

  it('does not truncate an English portrait to the CJK limits', async () => {
    allow();
    const tagline = 'Records why a thing is built so'; // 31 chars: over CJK 30, fine for English
    const pub = 'You keep separate ledgers: the discomfort, the other person\'s goodwill, the process and the relationship, so bad days never turn into blame.'; // > 150
    stubModel(modelReply({ archetype: { label: 'System Watcher Nearly', tagline } }, { bodyPublic: pub }));
    const { default: handler } = await import('./recap');
    const res = makeRes();
    await handler(makeReq({ entries: journal(10), lang: 'English' }) as never, res as never);

    expect(pub.length).toBeGreaterThan(130);
    expect(res.body.draft.archetype.tagline).toBe(tagline);
    expect(res.body.draft.archetype.label).toBe('System Watcher Nearly');
    expect(res.body.draft.chapters.every((c: any) => c.bodyPublic === pub && c.shareable)).toBe(true);
  });

  it('still holds Chinese to the tight limits', async () => {
    allow();
    stubModel(modelReply({ archetype: { label: '系'.repeat(30), tagline: '观'.repeat(60) } }));
    const { default: handler } = await import('./recap');
    const res = makeRes();
    await handler(makeReq({ entries: journal(10), lang: 'Simplified Chinese' }) as never, res as never);
    expect(res.body.draft.archetype.label).toHaveLength(14);
    expect(res.body.draft.archetype.tagline).toHaveLength(30);
  });

  it('cuts spaced text at a word boundary instead of mid-word', async () => {
    allow();
    stubModel(modelReply({ oneLine: 'You look for how a life was designed and then you leave the answer open for the next person to find it' }));
    const { default: handler } = await import('./recap');
    const res = makeRes();
    await handler(makeReq({ entries: journal(10), lang: 'English' }) as never, res as never);
    const line = res.body.draft.oneLine as string;
    expect(line.length).toBeLessThanOrEqual(110);
    expect(line).toMatch(/\w$/);
    expect('You look for how a life was designed and then you leave the answer open for the next person to find it').toContain(line);
    expect(line.endsWith(' ')).toBe(false);
  });
});

describe('/api/recap · emphasis and flags', () => {
  const CLEAN_EM = '你处理关系用分账法：处境的难受、对方的善意、流程上的争取、关系本身，**四件事分开算**，所以不顺的时候也不会互相指责。';

  it('keeps exactly one emphasised sentence and removes every other asterisk', async () => {
    allow();
    stubModel(modelReply({}, { body: '**一**句话，**二**句话，**三**句话。', bodyPublic: CLEAN_EM + '**多余' }));
    const { default: handler } = await import('./recap');
    const res = makeRes();
    await handler(makeReq({ entries: journal(10), lang: 'Simplified Chinese' }) as never, res as never);

    const c = res.body.draft.chapters[0];
    expect(c.body).toBe('**一**句话，二句话，三句话。');
    expect((c.bodyPublic.match(/\*\*/g) ?? []).length).toBe(2);   // one closed pair, no strays
    expect(c.bodyPublic).toContain('**四件事分开算**');
  });

  it('leaves marker-free text alone', async () => {
    allow();
    stubModel(modelReply({}, { bodyPublic: '他们处理麻烦时先分开事实与情绪，再决定要不要为它花力气，所以很少被一件小事拖住一整天。' }));
    const { default: handler } = await import('./recap');
    const res = makeRes();
    await handler(makeReq({ entries: journal(10), lang: 'Simplified Chinese' }) as never, res as never);
    expect(res.body.draft.chapters[0].bodyPublic).not.toContain('*');
  });

  it('measures length on the plain text, not counting the marker', async () => {
    allow();
    // Exactly at the CJK ceiling once the four asterisks are ignored.
    const plain = '字'.repeat(150);
    stubModel(modelReply({}, { bodyPublic: `**${plain.slice(0, 40)}**${plain.slice(40)}` }));
    const { default: handler } = await import('./recap');
    const res = makeRes();
    await handler(makeReq({ entries: journal(10), lang: 'Simplified Chinese' }) as never, res as never);
    expect(res.body.draft.chapters[0].flags).not.toContain('too-long');
  });

  it('flags a leaking chapter with the reasons, and still returns its public text', async () => {
    allow();
    const leaking = '你和 Theis 一起旅行时，处境的难受与对方的善意被你分得很清楚，所以不顺的时候也不会互相指责。';
    stubModel(modelReply({}, { bodyPublic: leaking }));
    const { default: handler } = await import('./recap');
    const res = makeRes();
    await handler(makeReq({ entries: journal(10), lang: 'Simplified Chinese' }) as never, res as never);

    const c = res.body.draft.chapters[0];
    expect(c.shareable).toBe(false);
    expect(c.flags).toContain('person-name');
    // Advice, not a lock: the text is still there for the owner to decide on.
    expect(c.bodyPublic).toBe(leaking);
  });

  it('gives a clean chapter an empty flag list', async () => {
    allow();
    stubModel(modelReply());
    const { default: handler } = await import('./recap');
    const res = makeRes();
    await handler(makeReq({ entries: journal(10) }) as never, res as never);
    expect(res.body.draft.chapters.every((c: any) => c.shareable && c.flags.length === 0)).toBe(true);
  });

  it('asks the model to mark one key sentence and to write labels only', async () => {
    allow();
    stubModel(modelReply());
    const { default: handler } = await import('./recap');
    const res = makeRes();
    await handler(makeReq({ entries: journal(10) }) as never, res as never);
    const sent = JSON.parse((fetch as any).mock.calls[0][1].body).messages[0].content as string;
    expect(sent).toContain('double asterisks');
    expect(sent).toContain('"numbers": [ { "label": "..." } ]');
    expect(sent).not.toContain('caption <=');          // no per-number captions requested
  });
});

describe('sanitizeEntries', () => {
  it('drops malformed rows but keeps the good ones', async () => {
    const { sanitizeEntries } = await import('./recap');
    const out = sanitizeEntries([entry(1), null, 'x', { id: '', happenedOn: '2026-01-01' }, { id: 'a', happenedOn: 'July 4' }, entry(2)])!;
    expect(out.map((e) => e.id)).toEqual(['id1', 'id2']);
  });

  it('clamps photo counts and truncates oversize text', async () => {
    const { sanitizeEntries } = await import('./recap');
    const [e] = sanitizeEntries([entry(1, { photoCount: 500, body: 'x'.repeat(50_000), title: 't'.repeat(900) })])!;
    expect(e.photoCount).toBe(9);
    expect(e.body.length).toBe(6000);
    expect(e.title.length).toBe(200);
  });

  it('rejects a non-array', async () => {
    const { sanitizeEntries } = await import('./recap');
    expect(sanitizeEntries({})).toBeNull();
  });
});
