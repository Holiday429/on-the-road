import { describe, it, expect } from 'vitest';
import { ticksFor } from './prepare-stage.ts';
import { noteVar, NOTE_COUNT } from '../../data/palette.ts';

describe('ticksFor', () => {
  it('maps overall progress onto the three note rows', () => {
    expect(ticksFor(0, 0)).toBe(0);
    expect(ticksFor(0, 10)).toBe(0);
    expect(ticksFor(1, 10)).toBe(1);
    expect(ticksFor(5, 10)).toBe(2);
    expect(ticksFor(9, 10)).toBe(2);
    expect(ticksFor(10, 10)).toBe(3);
  });
});

describe('noteVar', () => {
  it('cycles through the note tints so neighbours differ', () => {
    for (let i = 0; i < NOTE_COUNT * 2; i++) expect(noteVar(i)).not.toBe(noteVar(i + 1));
    expect(noteVar(NOTE_COUNT)).toBe(noteVar(0));
    expect(noteVar(-1)).toBe(`var(--note-${NOTE_COUNT - 1})`);
  });
});
