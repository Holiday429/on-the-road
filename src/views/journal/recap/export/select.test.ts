import { describe, it, expect } from 'vitest';
import { chosenCards, defaultSelection, exportCandidates, previewText } from './select.ts';
import { europeZh, flagged, signalsOnly } from '../preview/fixture.ts';

describe('exportCandidates', () => {
  it('lists every card in the deck, in order', () => {
    const c = exportCandidates(europeZh);
    expect(c.map((x) => x.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(c.map((x) => x.key)).toEqual(['cover', 'traits', 'attention', 'method', 'relations', 'friction', 'recording', 'throughline', 'closing']);
  });

  it('carries the reasons a chapter was flagged', () => {
    const c = exportCandidates(flagged);
    expect(c[4].flags).toEqual(['relationship-label', 'quoted-speech']);
    expect(c[0].flags).toEqual([]);
  });

  it('marks a chapter with no public wording as undrawable, but every other card as drawable', () => {
    const bare = { ...europeZh, chapters: europeZh.chapters.map((c, i) => (i === 1 ? { ...c, bodyPublic: '  ' } : c)) };
    const c = exportCandidates(bare);
    expect(c[3].hasPublicText).toBe(false);
    expect(c.filter((x) => !x.hasPublicText)).toHaveLength(1);
  });
});

describe('defaultSelection', () => {
  it('ticks everything when nothing was flagged', () => {
    expect([...defaultSelection(exportCandidates(europeZh))]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('starts a flagged card unticked — advice, not a lock', () => {
    const sel = defaultSelection(exportCandidates(flagged));
    expect(sel.has(4)).toBe(false);
    expect(sel.has(5)).toBe(false);
    expect(sel.size).toBe(7);
  });
});

describe('chosenCards', () => {
  it('lets the owner tick a flagged card anyway', () => {
    const c = exportCandidates(flagged);
    const out = chosenCards(c, new Set([0, 4]));
    expect(out.map((x) => x.key)).toEqual(['cover', 'relations']);
  });

  it('returns cards in deck order whatever order they were ticked in', () => {
    const c = exportCandidates(europeZh);
    expect(chosenCards(c, new Set([8, 2, 0])).map((x) => x.index)).toEqual([0, 2, 8]);
  });

  it('never returns a card that has nothing public to draw, even if ticked', () => {
    const bare = { ...europeZh, chapters: europeZh.chapters.map((c, i) => (i === 0 ? { ...c, bodyPublic: '' } : c)) };
    const c = exportCandidates(bare);
    expect(chosenCards(c, new Set([0, 2])).map((x) => x.index)).toEqual([0]);
  });

  it('returns nothing when nothing is ticked', () => {
    expect(chosenCards(exportCandidates(europeZh), new Set())).toEqual([]);
  });

  it('works for the numbers-only deck', () => {
    expect(chosenCards(exportCandidates(signalsOnly), new Set([0])).map((x) => x.key)).toEqual(['cover']);
  });
});

describe('previewText', () => {
  it('shows the public wording, never the private reading, with the marker removed', () => {
    const c = exportCandidates(europeZh)[2];
    const text = previewText(c, 200);
    expect(text).not.toContain('*');
    expect(text).toContain('你记下的不是风景');
    expect(text).not.toContain(europeZh.chapters[0].body.replace(/\*\*/g, '').slice(0, 15));
  });

  it('is shortened with an ellipsis', () => {
    expect(previewText(exportCandidates(europeZh)[2], 12).endsWith('…')).toBe(true);
  });
});
