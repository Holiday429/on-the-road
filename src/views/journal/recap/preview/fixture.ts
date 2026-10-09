/* ==========================================================================
   On the Road · Recap preview fixtures  (DEV ONLY)
   --------------------------------------------------------------------------
   Canned portraits for reviewing the deck's UI without signing in, touching
   Firestore, or spending an AI credit.

   `europeZh` / `europeEn` are real generated content from the Europe 2026
   journal, so the layout is judged against text of the length it will actually
   hold — a fixture of lorem ipsum would make every card look fine. Every string
   here is within the limits in api/_recap/limits.ts (see fixture.test.ts).

   The others are the cases that break layouts: a portrait with several chapters
   withheld by the privacy gate, a numbers-only card with no AI text at all, and
   every field at its maximum length.

   Imported only by preview/main.ts, which is itself dev-only. Nothing here
   ships in a production bundle.
   ========================================================================== */

import type { StoredTravelerRecap } from '../../../../data/stores/traveler-recap-store.ts';
import type { RecapChapter } from '../../../../data/schema.ts';

type Fixture = StoredTravelerRecap;

const META = {
  tripId: 'europe-2026-hicf',
  sourceHash: 'devfixture',
  refMap: {
    e03: 'x3', e06: 'x6', e08: 'x8', e11: 'x11', e19: 'x19', e22: 'x22', e24: 'x24',
    e30: 'x30', e38: 'x38', e41: 'x41', e44: 'x44', e54: 'x54', e60: 'x60', e82: 'x82',
  },
  source: 'ai' as const,
  visibility: 'private' as const,
  slug: '',
  generatedAt: Date.now(),
  createdAt: Date.now(),
  updatedAt: Date.now(),
  schemaVersion: 1,
};

const chapter = (
  id: RecapChapter['id'], heading: string, body: string, bodyPublic: string, refs: string[],
): RecapChapter => ({ id, heading, body, bodyPublic, evidenceRefs: refs, shareable: true, flags: [] });

/* ── The real portrait, Chinese ───────────────────────────────────────────── */

export const europeZh: Fixture = {
  ...META,
  id: 'fixture-europe-zh',
  entryCount: 82,
  signals: {},
  archetype: { label: '系统的旁观者', tagline: '不记录去过哪里，记录一件事为什么被设计成这样' },
  traits: [
    { key: '系统视角', score: 92, note: '看风景会追问它为谁而建、谁能抵达' },
    { key: '情绪分账', score: 88, note: '把难受、善意、流程、关系分开记账' },
    { key: '不确定性偏好', score: 85, note: '把「没做攻略」当素材，而不是风险' },
    { key: '主动社交', score: 38, note: '相遇多由对方先开口，你接得住，但不先伸手' },
  ],
  numbers: [
    { label: '记录天数', value: '53 / 74', caption: '' },
    { label: '城市', value: '23', caption: '' },
    { label: '字数', value: '22,044', caption: '' },
    { label: '照片', value: '287', caption: '' },
    { label: '最长一篇', value: '1,987', caption: '' },
    { label: '带对话的笔记', value: '29%', caption: '' },
  ],
  chapters: [
    chapter('attention', '你看的是行为',
      '你记的几乎不是风景，是行为。一个人做某件事时的分寸，比那件事本身更容易被你写下来——谁在动手之前先问了一句，谁对赶时间的人没耐心、却对需要帮助的人下了车，谁把规则写在门口让所有人都不必猜。你反复回到同一个判断：**尊重是结构上的设计，不是态度上的客气。**代价是，你很少让一处风景只是风景。',
      '你记下的不是风景，而是行为。一个人做事时的分寸，比事情本身更容易落进你的笔记；你一再得出同一个结论：**真正的尊重，是结构上的设计，而不是态度上的客气。**',
      ['e03', 'e22', 'e60']),
    chapter('method', '三步，然后留口子',
      '先看见一个物理事实，让它变成判断，再给判断留口子：一条被飞机划开又晕散的线、一段上下起伏的坡路、一片有人每天去浇水的墓地。你从不停在“很美”，也很少停在“很糟”。结尾几乎总向上，**那是写作上的自我管理**——代价是，你不允许一段记录停在负面里。',
      '你的方法有三步：先看见一个具体的事实，把它推成一个判断，再给判断留一个口子。结尾几乎总是向上，**但那不是乐观，而是你对自己写作的一种管理。**',
      ['e11', 'e41']),
    chapter('relations', '把关系分开算',
      '你处理关系用分账法：房间太热是客观条件，对方的善意是另一回事，向客服争取是第三件，关系本身是第四件。**所以不顺的时候，你们没有滑向互相指责。**对只同走一段路的人，你写下来，然后平静放手——代价是，你很少让一段相遇有后续。',
      '你处理关系用分账法：处境的难受、对方的善意、流程上的争取、关系本身，**四件事分开算**，所以不顺的时候也不会互相指责。只同行一段的人，你记下来，然后平静放手。',
      ['e08', 'e44']),
    chapter('friction', '先动手，再复盘',
      '察觉处境不对，你的第一反应不是忍受，是“不能被沉没成本限制选择”。**事后你复盘，却不假装自己会变**：为了一片晴天的湖，你赌上了接下来的行程，一路奔跑才赶上，然后写下“下一次还敢”。代价是，这样的日子你会把自己逼得很紧。',
      '察觉处境不对，你的第一反应不是忍受，而是动手改。**事后你会复盘，却不假装自己会变**：为一片值得的风景冒险，你说下次不能这样，又承认再遇到，还敢。',
      ['e54', 'e30']),
    chapter('recording', '离开后才写得清',
      '你的总结总是写在交通工具上、在离开之后——一座城的长文写在去下一站的火车上。**你需要先离开，才能把一个地方说清楚。**还有一条规律：不喜欢的地方写得更长、更结构化，喜欢的地方写得短、散、全是对话。分析是你处理距离的方式，白描是你处理亲近的方式。',
      '你写得最清楚的，往往是离开之后：总结总在路上写成，**你需要先走远，才能把一个地方说清楚。**不喜欢的地方，你写得长而有结构；喜欢的地方，写得短、散、全是对话。',
      ['e24', 'e82']),
    chapter('throughline', '它对谁开着门',
      '“可抵达”出现了三次，落在三个层面：风景的（缆车让婴儿和老人都不必先耗尽力气）、审美的（一座城的美人人可得，另一座的美需要知识门槛）、爱的（墓地让人能随时探望）。**你在意的是它对谁开着门**，也在同一篇里推翻了自己一半的结论。',
      '同一个想法在你的笔记里换了三种形式：风景能不能被抵达，美能不能被读懂，爱能不能被随时探望。**你在意的不是东西好不好，而是它对谁开着门**——你也诚实地承认，那扇门对很多人没开。',
      ['e38', 'e19']),
  ],
  oneLine: '你是一个在别人的生活里找“这件事是怎么被设计出来的”的旅行者——然后把答案留一个口子。',
  questions: [
    '下一趟，有什么你一向绕开的东西，想站在它面前看一会？',
    '再遇到诱惑你赶路的风景，你想先给自己定一条底线吗？',
    '下一趟，你会试着在还没离开时就写总结吗？',
  ],
};

/* ── The same portrait in English (the roomier limits) ────────────────────── */

export const europeEn: Fixture = {
  ...META,
  id: 'fixture-europe-en',
  entryCount: 82,
  signals: {},
  archetype: { label: 'System Watcher', tagline: 'Records why a thing is built so' },
  traits: [
    { key: 'Systems', score: 92, note: 'Asks who a view was built for' },
    { key: 'Ledger', score: 88, note: 'Keeps discomfort and goodwill apart' },
    { key: 'Drift', score: 85, note: 'Treats no-plan as material, not risk' },
    { key: 'Reaching out', score: 38, note: 'Meets people who speak first' },
  ],
  numbers: [
    { label: 'Days kept', value: '53 / 74', caption: '' },
    { label: 'Cities', value: '23', caption: '' },
    { label: 'Characters', value: '22,044', caption: '' },
    { label: 'Photos', value: '287', caption: '' },
    { label: 'Longest', value: '1,987', caption: '' },
    { label: 'With voices', value: '29%', caption: '' },
  ],
  chapters: [
    chapter('attention', 'You watch conduct',
      'You rarely record scenery; you record conduct — who asked before acting, who lost patience with a hurried traveller yet stepped off the tram for a passenger who needed help, who put the rules on the door so nobody had to guess. **You keep concluding that respect is design, not manners.** The cost: you rarely let a view simply be a view.',
      'You record conduct, not scenery. How someone handles a small moment lands in your notes, and **you keep concluding that respect is design, not manners.**',
      ['e03', 'e22', 'e60']),
    chapter('method', 'Three steps, then air',
      'A physical fact, turned into a judgement, then left with an opening: a contrail pulled apart by wind, a street of steep hills, a cemetery someone waters daily. You rarely stop at "lovely" or at "awful". **Your endings tilt upward** — and the price is that you will not let an entry end in the dark.',
      'See a concrete fact, turn it into a judgement, leave the judgement an opening. Your endings tilt upward: **not optimism, but a way of managing yourself.**',
      ['e11', 'e41']),
    chapter('relations', 'Separate ledgers',
      'You keep separate ledgers: the heat is a fact, the other person\'s goodwill is another thing, arguing with support is a third, the relationship a fourth. **So a bad day never slid into blame.** People who walk only one stretch with you get written down, then let go — the cost is few follow-ups.',
      'You keep separate ledgers: the discomfort, the other person\'s goodwill, the process, the relationship. **So bad days never turn into blame.** Short companions are let go calmly.',
      ['e08', 'e44']),
    chapter('friction', 'Act, then review',
      'When something is wrong your first move is not endurance but "I will not be held by sunk cost". **You review afterwards without pretending you will change:** for one clear afternoon on a lake you gambled the onward journey, then wrote that you would do it again. It leaves you running hard.',
      'When something is wrong your first move is to change it, not endure it. **You review afterwards without pretending to change:** you would take the risk again.',
      ['e54', 'e30']),
    chapter('recording', 'Clear once gone',
      'Your summing-up is written in transit, after leaving — a long piece on one city, written on the train to the next. **You need distance to see a place clearly.** And a pattern: places you dislike get long, structured writing; places you love get short, loose lines, full of talk.',
      '**You write most clearly after leaving:** summaries come on the road. Places you dislike get long, structured writing; places you love get short, loose lines full of talk.',
      ['e24', 'e82']),
    chapter('throughline', 'Who the door opens for',
      'One idea surfaced three times: who can reach a view (a cable car lets infants and the old arrive unspent), who can read a city\'s beauty (open to all in one, gated by knowledge in another), who can keep visiting a grave. **You ask who the door opens for,** and undo half your own conclusion.',
      'One idea in three forms: can a view be reached, can beauty be read, can love be visited. **What you care about is who a thing opens its door for.**',
      ['e38', 'e19']),
  ],
  oneLine: 'You look for how a life was designed, then leave the answer open.',
  questions: [
    'What have you always walked past that you could stand before?',
    'Next time a view tempts you to rush, what is your limit?',
    'Could you write the summary before you leave?',
  ],
};

/* ── Layout stress cases ──────────────────────────────────────────────────── */

/**
 * Two chapters whose public text tripped the automatic checks — the ones about
 * other people, which is where it bites in practice. They are NOT locked: the
 * owner sees a "check" chip with the reasons and decides whether to share them.
 */
export const flagged: Fixture = {
  ...europeZh,
  id: 'fixture-flagged',
  chapters: europeZh.chapters.map((c) => {
    if (c.id === 'relations') {
      return {
        ...c, shareable: false, flags: ['relationship-label', 'quoted-speech'],
        bodyPublic: '你和伴侣旅行时，对方说“这不是你的错”，你把**处境的难受与对方的善意分开算**，所以不顺的时候也不会互相指责。',
      };
    }
    if (c.id === 'friction') {
      return {
        ...c, shareable: false, flags: ['money', 'person-name'],
        bodyPublic: '为了省下 200 欧元的差价，你和 Theis 在最热的一天换了住处：**察觉处境不对，你的第一反应是动手改，而不是忍受。**',
      };
    }
    return c;
  }),
};

/** No AI text at all — the honest floor when generation is skipped or the journal is small. */
export const signalsOnly: Fixture = {
  ...META,
  id: 'fixture-signals',
  entryCount: 5,
  signals: {},
  source: 'signals',
  archetype: { label: '', tagline: '' },
  traits: [],
  numbers: europeZh.numbers,
  chapters: [],
  oneLine: '',
  questions: [],
};

/** Take n characters from a pool, repeating it as needed. */
const fill = (n: number, pool = '一二三四五六七八九十百千万亿') =>
  pool.repeat(Math.ceil(n / pool.length)).slice(0, n);

/** Every field at its CJK maximum, to see whether a card still holds the worst case. */
export const overflow: Fixture = {
  ...europeZh,
  id: 'fixture-overflow',
  archetype: { label: fill(14), tagline: fill(30) },
  traits: europeZh.traits.map((t) => ({ ...t, key: fill(6), note: fill(40) })),
  numbers: europeZh.numbers.map((n) => ({ ...n, label: fill(10), caption: fill(24) })),
  chapters: europeZh.chapters.map((c) => ({ ...c, heading: fill(16), body: fill(260), bodyPublic: fill(150) })),
  oneLine: fill(60),
  questions: [fill(40), fill(40), fill(40)],
};

/** Every field at its Latin maximum — the same worst case for the roomy tier. */
export const overflowEn: Fixture = {
  ...europeEn,
  id: 'fixture-overflow-en',
  archetype: { label: 'Wwwwwwwwwwwwwwwwwwwwwwwwwwww'.slice(0, 28), tagline: fill(60, 'wide words fill the line ') },
  traits: europeEn.traits.map((t) => ({ ...t, key: 'Wwwwwwwwwwww', note: fill(70, 'wide words fill ') })),
  numbers: europeEn.numbers.map((n) => ({ ...n, label: 'Wwwwwwwwwwwwwwww', caption: fill(44, 'wide words fill ') })),
  chapters: europeEn.chapters.map((c) => ({
    ...c, heading: fill(28, 'Wide words '), body: fill(520, 'wide words fill the line '), bodyPublic: fill(300, 'wide words fill the line '),
  })),
  oneLine: fill(110, 'wide words fill the line '),
  questions: [fill(80, 'wide words '), fill(80, 'wide words '), fill(80, 'wide words ')],
};

export const FIXTURES: Array<{
  id: string; label: string; lang: 'zh' | 'en'; recap: Fixture | null; entryCount: number;
}> = [
  { id: 'europe-zh', label: '真实内容 · 中文', lang: 'zh', recap: europeZh, entryCount: 82 },
  { id: 'europe-en', label: 'Real content · EN', lang: 'en', recap: europeEn, entryCount: 82 },
  { id: 'flagged', label: '两张卡带「请确认」（公开视图）', lang: 'zh', recap: flagged, entryCount: 82 },
  { id: 'signals', label: '仅数字（无 AI）', lang: 'zh', recap: signalsOnly, entryCount: 5 },
  { id: 'overflow', label: '压力测试 · 中文上限', lang: 'zh', recap: overflow, entryCount: 82 },
  { id: 'overflow-en', label: 'Stress · EN limits', lang: 'en', recap: overflowEn, entryCount: 82 },
  { id: 'empty-ready', label: '空状态 · 可生成', lang: 'zh', recap: null, entryCount: 30 },
  { id: 'empty-locked', label: '空状态 · 笔记不足', lang: 'zh', recap: null, entryCount: 3 },
];
