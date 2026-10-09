/**
 * @vitest-environment jsdom
 *
 * The "choose what to share" step. The owner decides; the automatic checks only
 * inform. The tests pin what a person would notice: what is ticked when it opens,
 * that a flagged card can still be ticked, that nothing is exported with nothing
 * ticked, and that the image is made from exactly the ticked cards.
 */
/* eslint-disable no-restricted-syntax -- test harness: the markup under test is authored in this repo, never user input */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setLocale } from '../../../../core/i18n.ts';

const renderLongImage = vi.fn((_input: unknown) => ({ fake: 'canvas' }));
const deliverImage = vi.fn(async (..._a: unknown[]) => 'downloaded' as const);
vi.mock('./long.ts', () => ({ renderLongImage: (i: unknown) => renderLongImage(i) }));
vi.mock('./save.ts', () => ({ deliverImage: (...a: unknown[]) => deliverImage(...a) }));
vi.mock('../../card/card-fonts.ts', () => ({ ensureCardFonts: async () => {} }));

import { openExportSheet } from './sheet.ts';
import { europeZh, flagged } from '../preview/fixture.ts';

function sheet() { return document.querySelector<HTMLElement>('.recap-pick')!; }
function boxes() { return Array.from(sheet().querySelectorAll<HTMLInputElement>('.recap-pick-list input')); }
const ticked = () => boxes().filter((b) => b.checked).map((b) => Number(b.value));
const click = (sel: string) => sheet().querySelector<HTMLElement>(sel)!.click();
const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

beforeEach(() => {
  setLocale('zh');
  document.body.innerHTML = '';
  renderLongImage.mockClear();
  deliverImage.mockClear();
  // jsdom never loads images; resolve the logo as failed so the export proceeds without it.
  vi.stubGlobal('Image', class { onload?: () => void; onerror?: () => void; set src(_v: string) { setTimeout(() => this.onerror?.(), 0); } });
});
afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

describe('opening', () => {
  it('lists all nine cards, each with its question and a preview of the public wording', () => {
    openExportSheet(europeZh);
    expect(boxes()).toHaveLength(9);
    const items = sheet().querySelectorAll('.recap-pick-item');
    expect(items[2].textContent).toContain('你到底在看什么');
    expect(items[2].textContent).toContain('你记下的不是风景');
    expect(items[2].textContent).not.toContain('**');
  });

  it('says plainly that the image uses the public wording', () => {
    openExportSheet(europeZh);
    expect(sheet().textContent).toContain('公开版文案');
  });

  it('starts with every clean card ticked', () => {
    openExportSheet(europeZh);
    expect(ticked()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(sheet().querySelector('[data-count]')!.textContent).toBe('已选 9 / 9');
  });

  it('starts a flagged card unticked, naming what tripped', () => {
    openExportSheet(flagged);
    expect(ticked()).toEqual([0, 1, 2, 3, 6, 7, 8]);
    const item = sheet().querySelectorAll('.recap-pick-item')[4];
    expect(item.classList.contains('is-flagged')).toBe(true);
    expect(item.textContent).toContain('分享前请确认');
    expect(item.textContent).toContain('关系称谓');
    expect(item.textContent).toContain('原话');
  });

  it('lets the owner tick a flagged card anyway', () => {
    openExportSheet(flagged);
    const box = boxes()[4];
    expect(box.disabled).toBe(false);
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(ticked()).toContain(4);
    expect(sheet().querySelector('[data-count]')!.textContent).toBe('已选 8 / 9');
  });

  it('disables a chapter that has no public wording, and says why', () => {
    const bare = { ...europeZh, chapters: europeZh.chapters.map((c, i) => (i === 1 ? { ...c, bodyPublic: '', shareable: false, flags: ['empty'] } : c)) };
    openExportSheet(bare);
    expect(boxes()[3].disabled).toBe(true);
    expect(boxes()[3].checked).toBe(false);
    expect(sheet().querySelectorAll('.recap-pick-item')[3].textContent).toContain('还没有公开版文案');
    expect(sheet().querySelector('[data-count]')!.textContent).toBe('已选 8 / 8');
  });
});

describe('choosing', () => {
  it('selects all and clears — all skips cards that cannot be drawn', () => {
    const bare = { ...europeZh, chapters: europeZh.chapters.map((c, i) => (i === 0 ? { ...c, bodyPublic: '' } : c)) };
    openExportSheet(bare);
    click('[data-act="none"]');
    expect(ticked()).toEqual([]);
    click('[data-act="all"]');
    expect(ticked()).toEqual([0, 1, 3, 4, 5, 6, 7, 8]);
  });

  it('will not make an image with nothing ticked', () => {
    openExportSheet(europeZh);
    click('[data-act="none"]');
    expect(sheet().querySelector<HTMLButtonElement>('[data-act="make"]')!.disabled).toBe(true);
  });

  it('closes on cancel without making anything', () => {
    openExportSheet(europeZh);
    click('[data-act="cancel"]');
    expect(document.querySelector('.recap-pick')).toBeNull();
    expect(renderLongImage).not.toHaveBeenCalled();
  });
});

describe('making the image', () => {
  it('builds it from exactly the ticked cards, in deck order, then delivers and closes', async () => {
    openExportSheet(europeZh);
    click('[data-act="none"]');
    for (const i of [8, 2, 0]) { boxes()[i].checked = true; }
    boxes()[0].dispatchEvent(new Event('change', { bubbles: true }));
    click('[data-act="make"]');
    await vi.waitFor(() => expect(deliverImage).toHaveBeenCalled());
    await flush();

    const input = renderLongImage.mock.calls[0][0] as { cards: Array<{ key: string }> };
    expect(input.cards.map((c) => c.key)).toEqual(['cover', 'attention', 'closing']);
    expect(document.querySelector('.recap-pick')).toBeNull();
  });

  it('includes a flagged card the owner chose to share', async () => {
    openExportSheet(flagged);
    boxes()[4].checked = true;
    boxes()[4].dispatchEvent(new Event('change', { bubbles: true }));
    click('[data-act="make"]');
    await vi.waitFor(() => expect(renderLongImage).toHaveBeenCalled());
    const keys = (renderLongImage.mock.calls[0][0] as { cards: Array<{ key: string }> }).cards.map((c) => c.key);
    expect(keys).toContain('relations');
    expect(keys).not.toContain('friction'); // left unticked
  });

  it('keeps the sheet open if the share sheet was dismissed', async () => {
    deliverImage.mockResolvedValueOnce('cancelled' as never);
    openExportSheet(europeZh);
    click('[data-act="make"]');
    await vi.waitFor(() => expect(deliverImage).toHaveBeenCalled());
    await flush();
    expect(document.querySelector('.recap-pick')).not.toBeNull();
    expect(sheet().querySelector<HTMLButtonElement>('[data-act="make"]')!.disabled).toBe(false);
  });

  it('shows an error and stays open when making the image fails', async () => {
    renderLongImage.mockImplementationOnce(() => { throw new Error('canvas too large'); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    openExportSheet(europeZh);
    click('[data-act="make"]');
    await vi.waitFor(() => expect(sheet().querySelector('[data-error]')!.hasAttribute('hidden')).toBe(false));
    expect(sheet().querySelector<HTMLButtonElement>('[data-act="make"]')!.disabled).toBe(false);
  });
});
