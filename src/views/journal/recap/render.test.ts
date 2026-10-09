/**
 * @vitest-environment jsdom
 *
 * The deck's structure: nine cards in a fixed order, every back carrying its
 * topic bar and base bar, the cover's front being the brand and its back the
 * archetype, flagged chapters kept shareable, and flips that happen by toggling a
 * class on the node already in the page rather than by re-rendering.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setLocale } from '../../../core/i18n.ts';
import { buildDeck, bodySize, cardKey, deckSize, renderRecap } from './render.ts';
import { flipAll, openCount, cardsOf, toggleCard } from './interact.ts';
import { initialRecapUi } from './types.ts';
import { TONES } from './tones.ts';
import { europeEn, europeZh, flagged, signalsOnly } from './preview/fixture.ts';

beforeEach(() => setLocale('zh'));

function mount(recap: typeof europeZh | null, ui = initialRecapUi(), entryCount = 82) {
  const root = document.createElement('div');
  // eslint-disable-next-line no-restricted-syntax -- test harness; the fixtures are authored in this repo
  root.innerHTML = renderRecap({ recap, recaps: recap ? [recap] : [], entryCount, minEntries: 8, ui });
  return { root, shell: root.querySelector<HTMLElement>('.journal-recap-shell')!, ui };
}

const publicUi = () => { const ui = initialRecapUi(); ui.publicMode = true; return ui; };

describe('deck order', () => {
  it('is exactly nine cards: cover, traits, six chapters, closing', () => {
    const kinds = buildDeck(europeZh).map((c) => c.kind);
    expect(kinds).toEqual(['cover', 'traits', 'chapter', 'chapter', 'chapter', 'chapter', 'chapter', 'chapter', 'closing']);
    expect(deckSize(europeZh)).toBe(9);
  });

  it('gives relations and friction a card each, in order', () => {
    const ids = buildDeck(europeZh).flatMap((c) => (c.kind === 'chapter' ? [c.chapter.id] : []));
    expect(ids).toEqual(['attention', 'method', 'relations', 'friction', 'recording', 'throughline']);
  });

  it('leaves the radar out when there are not four traits, rather than faking a fourth', () => {
    const three = { ...europeZh, traits: europeZh.traits.slice(0, 3) };
    expect(buildDeck(three).some((c) => c.kind === 'traits')).toBe(false);
    expect(deckSize(three)).toBe(8);
  });

  it('is a single overview card for the numbers-only fallback', () => {
    expect(buildDeck(signalsOnly).map((c) => c.kind)).toEqual(['cover']);
  });
});

describe('every card has the same two faces', () => {
  it('has a front question and a back topic bar that repeats it', () => {
    const { shell } = mount(europeZh);
    const cards = cardsOf(shell);
    expect(cards).toHaveLength(9);
    for (const card of cards) {
      const front = card.querySelector('.recap-card-front')!;
      const back = card.querySelector('.recap-card-back')!;
      expect(front).not.toBeNull();
      expect(back.querySelector('.recap-topic')).not.toBeNull();
      // The question on the front is the question atop the back — so a turned or
      // saved card still says what it is answering.
      const frontQ = front.querySelector('.recap-front-q')!.textContent;
      const topicQ = back.querySelector('.recap-topic-q')!.textContent;
      expect(topicQ).toBe(frontQ);
    }
  });

  it('anchors every back with a base bar showing its position', () => {
    const { shell } = mount(europeZh);
    cardsOf(shell).forEach((card, i) => {
      const base = card.querySelector('.recap-card-back .recap-base')!;
      expect(base).not.toBeNull();
      expect(base.textContent).toContain(`${i + 1}/9`);
      expect(base.textContent).toContain('On the Road');
    });
  });

  it('gives every card its own colour, set from its identity not its position', () => {
    const { shell } = mount(europeZh);
    const lights = cardsOf(shell).map((c) => /--tone-l:(#[0-9a-f]{6})/i.exec(c.getAttribute('style') ?? '')![1]);
    expect(new Set(lights).size).toBe(9);
    expect(lights[0]).toBe(TONES.cover.light);
    expect(lights[2]).toBe(TONES.attention.light);
  });

  it('keeps a card\'s colour when another card is missing', () => {
    const three = { ...europeZh, traits: europeZh.traits.slice(0, 3) };
    const { shell } = mount(three);
    const attention = shell.querySelector('[data-recap-card="1"]')!; // radar gone, so attention moves up
    expect(attention.getAttribute('style')).toContain(TONES.attention.light);
  });

  it('keys colours by card identity', () => {
    const deck = buildDeck(europeZh);
    expect(deck.map(cardKey)).toEqual(['cover', 'traits', 'attention', 'method', 'relations', 'friction', 'recording', 'throughline', 'closing']);
    deck.forEach((c) => expect(TONES[cardKey(c)]).toBeDefined());
  });
});

describe('cover', () => {
  it('is the brand on the front and the archetype with its figures on the back', () => {
    const { shell } = mount(europeZh);
    const cover = shell.querySelector('[data-recap-card="0"]')!;
    const front = cover.querySelector('.recap-card-front')!;
    const back = cover.querySelector('.recap-card-back')!;

    expect(front.querySelector('.recap-logo-video')).not.toBeNull();
    expect(front.textContent).toContain('旅行者画像');
    expect(front.textContent).not.toContain('系统的旁观者'); // the conclusion lives on the back only

    expect(back.textContent).toContain('系统的旁观者');
    expect(back.querySelectorAll('.recap-tile')).toHaveLength(6);
    expect(back.textContent).toContain('22,044');
  });

  it('uses the small mp4 rather than the 2MB gif, with a still for reduced motion', () => {
    const { shell } = mount(europeZh);
    const video = shell.querySelector<HTMLVideoElement>('.recap-logo-video')!;
    expect(video.getAttribute('src')).toMatch(/logo\.mp4$/);
    expect(video.hasAttribute('muted') && video.hasAttribute('loop') && video.hasAttribute('playsinline')).toBe(true);
    expect(shell.querySelector('.recap-logo-still')!.getAttribute('src')).toMatch(/logo\.png$/);
    expect(shell.innerHTML).not.toContain('logo.gif');
  });

  it('shows labels under the figures but no captions', () => {
    const { shell } = mount(europeZh);
    expect(shell.querySelectorAll('.recap-tile-label')).toHaveLength(6);
    expect(shell.querySelector('.recap-tile-caption')).toBeNull();
  });

  it('has no rarity line', () => {
    expect(mount(europeZh).shell.querySelector('.recap-rarity')).toBeNull();
  });

  it('is dealt face-up and inert when there is no archetype', () => {
    const { shell } = mount(signalsOnly);
    const cover = shell.querySelector('[data-recap-card="0"]')!;
    expect(cover.classList.contains('recap-card--static')).toBe(true);
    expect(cover.hasAttribute('role')).toBe(false);
    expect(cover.querySelectorAll('.recap-card-face')).toHaveLength(1);
    expect(cover.textContent).toContain('53 / 74');
  });
});

describe('closing', () => {
  it('lists the three questions', () => {
    expect(mount(europeZh).shell.querySelectorAll('.recap-next-list li')).toHaveLength(3);
  });
});

describe('the key sentence', () => {
  it('is drawn highlighted, once per chapter, with no literal asterisks', () => {
    const { shell } = mount(europeZh);
    const chapters = Array.from(shell.querySelectorAll('.recap-card--chapter'));
    expect(chapters).toHaveLength(6);
    for (const card of chapters) expect(card.querySelectorAll('.recap-em')).toHaveLength(1);
    expect(shell.innerHTML).not.toContain('**');
  });

  it('survives an unbalanced marker from an older document without showing asterisks', () => {
    const broken = { ...europeZh, chapters: europeZh.chapters.map((c, i) => (i === 0 ? { ...c, body: '前面 **没有收尾' } : c)) };
    expect(mount(broken).shell.innerHTML).not.toContain('*');
  });

  it('sizes the text by its plain length, ignoring the marker', () => {
    expect(bodySize('短文。')).toBe('lg');
    expect(bodySize('字'.repeat(120))).toBe('md');
    expect(bodySize('字'.repeat(220))).toBe('sm');
    expect(bodySize(`**${'字'.repeat(92)}**`)).toBe('lg'); // 92 plain chars; 96 with markers would tip it over
  });
});

describe('private and public views', () => {
  it('shows the long reading and evidence chips in private, the short text in public', () => {
    const priv = mount(europeZh).shell;
    expect(priv.querySelectorAll('.recap-evidence-chip').length).toBeGreaterThan(0);
    expect(priv.textContent).toContain(europeZh.chapters[0].body.replace(/\*\*/g, '').slice(0, 20));

    const pub = mount(europeZh, publicUi()).shell;
    expect(pub.querySelectorAll('.recap-evidence-chip')).toHaveLength(0);
    expect(pub.textContent).toContain(europeZh.chapters[0].bodyPublic.replace(/\*\*/g, '').slice(0, 20));
    // The private reading must not appear anywhere in what a friend sees.
    expect(pub.textContent).not.toContain(europeZh.chapters[0].body.replace(/\*\*/g, '').slice(0, 30));
  });

  it('says so, rather than printing the private text, when a chapter has no public wording', () => {
    const bare = { ...europeZh, chapters: europeZh.chapters.map((c, i) => (i === 0 ? { ...c, bodyPublic: '', shareable: false, flags: ['empty'] } : c)) };
    const pub = mount(bare, publicUi()).shell;
    expect(pub.querySelector('.recap-body--none')!.textContent).toContain('公开版文案');
    expect(pub.textContent).not.toContain(europeZh.chapters[0].body.replace(/\*\*/g, '').slice(0, 30));
  });
});

describe('flagged chapters', () => {
  it('get a "check" chip in public view, with the reasons', () => {
    const pub = mount(flagged, publicUi()).shell;
    const chips = pub.querySelectorAll('.recap-flag');
    expect(chips).toHaveLength(2);
    expect(chips[0].getAttribute('title')).toContain('关系称谓');
    expect(chips[0].getAttribute('title')).toContain('原话');
  });

  it('are not locked: still turnable, with their text shown', () => {
    const ui = publicUi();
    const { shell } = mount(flagged, ui);
    const relations = shell.querySelector('[data-recap-card="4"]')!;
    expect(relations.classList.contains('has-flag')).toBe(true);
    expect(relations.getAttribute('role')).toBe('button');

    toggleCard(shell, ui, 4);
    expect(relations.classList.contains('is-flipped')).toBe(true);
    expect(relations.textContent).toContain('处境的难受与对方的善意');
  });

  it('show no chip in private view, where nothing is being shared', () => {
    expect(mount(flagged).shell.querySelectorAll('.recap-flag')).toHaveLength(0);
  });

  it('are counted in the footer', () => {
    expect(mount(flagged, publicUi()).shell.querySelector('.recap-footer')!.textContent).toContain('2 张');
  });

  it('leave a clean deck without a chip or a count', () => {
    const { shell } = mount(europeZh, publicUi());
    expect(shell.querySelectorAll('.recap-flag')).toHaveLength(0);
    expect(shell.querySelector('.recap-footer b')).toBeNull();
  });
});

describe('flipping', () => {
  it('toggles a class on the existing node, so the CSS transition can run', () => {
    const { shell, ui } = mount(europeZh);
    const before = shell.querySelector('[data-recap-card="2"]')!;
    toggleCard(shell, ui, 2);
    const after = shell.querySelector('[data-recap-card="2"]')!;
    expect(after).toBe(before);
    expect(after.classList.contains('is-flipped')).toBe(true);
    expect(after.getAttribute('aria-pressed')).toBe('true');
    expect(after.classList.contains('is-flipping')).toBe(true);
    expect(ui.flipped.has(2)).toBe(true);

    toggleCard(shell, ui, 2);
    expect(after.classList.contains('is-flipped')).toBe(false);
    expect(ui.flipped.has(2)).toBe(false);
  });

  it('counts the cover as open from the start and keeps the dots and label in step', () => {
    const { shell, ui } = mount(europeZh);
    expect(openCount(cardsOf(shell))).toBe(1);
    toggleCard(shell, ui, 3);
    toggleCard(shell, ui, 4);
    expect(openCount(cardsOf(shell))).toBe(3);
    expect(shell.querySelectorAll('.recap-dot.is-on')).toHaveLength(3);
    expect(shell.querySelector('[data-recap-progress-label]')!.textContent).toBe('已翻开 3 / 9');
  });

  it('does not count turning the cover over as another card', () => {
    const { shell, ui } = mount(europeZh);
    toggleCard(shell, ui, 0);
    expect(shell.querySelector('[data-recap-card="0"]')!.classList.contains('is-flipped')).toBe(true);
    expect(openCount(cardsOf(shell))).toBe(1);
  });

  it('will not turn a static card', () => {
    const stat = mount(signalsOnly);
    toggleCard(stat.shell, stat.ui, 0);
    expect(stat.shell.querySelector('[data-recap-card="0"]')!.classList.contains('is-flipped')).toBe(false);
  });

  it('turns everything, then reshuffles back to just the cover showing', () => {
    const { shell, ui } = mount(europeZh);
    flipAll(shell, ui);
    expect(openCount(cardsOf(shell))).toBe(9);
    expect(shell.querySelector('[data-recap-flip-all]')!.textContent).toBe('重新洗牌');

    flipAll(shell, ui);
    expect(openCount(cardsOf(shell))).toBe(1);
    expect(shell.querySelector('[data-recap-flip-all]')!.textContent).toBe('全部翻开');
  });
});

describe('language', () => {
  it('renders the interface in English when the locale is English', () => {
    setLocale('en');
    const { shell } = mount(europeEn);
    expect(shell.textContent).toContain('Your traveler portrait');
    expect(shell.textContent).toContain('Based on 82 notes');
    expect(shell.querySelector('[data-recap-progress-label]')!.textContent).toBe('1 of 9 turned');
  });
});

describe('states', () => {
  it('shows the locked state with progress below the threshold', () => {
    const { shell } = mount(null, initialRecapUi(), 3);
    expect(shell.querySelector('.recap-locked')!.textContent).toContain('3 / 8');
    expect(shell.querySelector('[data-recap-generate]')).toBeNull();
  });

  it('offers to generate at the threshold', () => {
    expect(mount(null, initialRecapUi(), 30).shell.querySelector('[data-recap-generate]')).not.toBeNull();
  });
});
