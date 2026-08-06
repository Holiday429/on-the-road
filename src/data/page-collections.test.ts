import { describe, expect, it } from 'vitest';
import { PAGE_COLLECTIONS, shareablePages, collectionsForPages } from './page-collections.ts';

/* ==========================================================================
   These map a shared page to the Firestore sub-collections a viewer may read,
   so a mistake here either breaks an existing share link or widens access.
   Pack was folded into Prepare (product-restructure P5) — invites created
   before that still carry the old 'pack' page id.
   ========================================================================== */

describe('collectionsForPages', () => {
  it('gives Prepare both the checklist and pack collections', () => {
    const cols = collectionsForPages(['prep']);
    expect(cols).toContain('checklists');
    expect(cols).toContain('packLists');
  });

  it('keeps a pre-P5 invite scoped to "pack" working', () => {
    // Without normalization this returns [] and the viewer silently loses
    // access to the pack data their link was created for.
    expect(collectionsForPages(['pack'])).toContain('packLists');
  });

  it('does not duplicate collections when both old and new ids are present', () => {
    const cols = collectionsForPages(['pack', 'prep']);
    expect(cols.filter((c) => c === 'packLists')).toHaveLength(1);
    expect(cols.filter((c) => c === 'checklists')).toHaveLength(1);
  });

  it('ignores unknown page ids rather than throwing', () => {
    expect(collectionsForPages(['does-not-exist'])).toEqual([]);
  });

  it('grants nothing for an empty page list', () => {
    expect(collectionsForPages([])).toEqual([]);
  });

  it('unions the collections of several pages', () => {
    const cols = collectionsForPages(['route', 'expenses']);
    expect(cols).toEqual(expect.arrayContaining(['legs', 'stays', 'todos', 'expenses', 'expenseCategories']));
  });
});

describe('shareablePages', () => {
  it('no longer offers pack as its own page', () => {
    expect(shareablePages()).not.toContain('pack');
    expect(PAGE_COLLECTIONS.pack).toBeUndefined();
  });

  it('offers prep, and only pages that actually carry data', () => {
    const pages = shareablePages();
    expect(pages).toContain('prep');
    // Aggregator/user-level pages have no collections of their own.
    expect(pages).not.toContain('today');
    expect(pages).not.toContain('calendar');
    expect(pages).not.toContain('profile');
    pages.forEach((p) => expect(PAGE_COLLECTIONS[p].length).toBeGreaterThan(0));
  });
});
