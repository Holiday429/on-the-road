import { describe, expect, it } from 'vitest';
import { bookTone } from './albums.ts';

describe('albums', () => {
  it('a book keeps its colour', () => {
    expect(bookTone('abc')).toBe(bookTone('abc'));
    expect(bookTone('abc')).toBeLessThan(6);
  });
});
