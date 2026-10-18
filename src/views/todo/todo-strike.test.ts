/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_MS, LEAVE_MS, STRIKE_MS, captureRects, penPath, playMoves, strikeRow } from './todo-strike.ts';

function mkRow(): { row: HTMLElement; label: HTMLElement } {
  const row = document.createElement('div');
  const label = document.createElement('span');
  label.textContent = 'Buy tickets';
  row.append(label);
  document.body.append(row);
  return { row, label };
}

describe('penPath', () => {
  it('runs the whole width, left to right', () => {
    expect(penPath(200)).toMatch(/^M0 /);
    expect(penPath(200)).toMatch(/200\.0 \d/);
  });
});

describe('strikeRow', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

  it('draws the line first and writes the change only after it', () => {
    const { row, label } = mkRow();
    const commit = vi.fn();
    strikeRow(row, { from: label }, commit);
    expect(row.querySelectorAll('.todo-pen').length).toBeGreaterThan(0);
    expect(row.classList.contains('is-ticking')).toBe(true);
    vi.advanceTimersByTime(STRIKE_MS);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(HOLD_MS + 1);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('lets a leaving row slide away before the write', () => {
    const { row, label } = mkRow();
    const commit = vi.fn();
    strikeRow(row, { from: label, leave: true }, commit);
    vi.advanceTimersByTime(STRIKE_MS + HOLD_MS + 1);
    expect(row.classList.contains('is-leaving')).toBe(true);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(LEAVE_MS);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('ignores a second tick on a row already being crossed off', () => {
    const { row, label } = mkRow();
    const commit = vi.fn();
    strikeRow(row, { from: label }, commit);
    strikeRow(row, { from: label }, commit);
    vi.advanceTimersByTime(STRIKE_MS + HOLD_MS + 1);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('takes the pen marks off again if the write fails', async () => {
    const { row, label } = mkRow();
    strikeRow(row, { from: label }, () => Promise.reject(new Error('Not signed in')));
    await vi.advanceTimersByTimeAsync(STRIKE_MS + HOLD_MS + 1);
    expect(row.querySelector('.todo-pen')).toBeNull();
    expect(row.classList.contains('is-ticking')).toBe(false);
    expect(row.dataset.striking).toBeUndefined();
  });
});

describe('playMoves', () => {
  it('ignores a capture that is too old (the write never came back)', () => {
    const root = document.createElement('div');
    const el = Object.assign(document.createElement('div'), { animate: vi.fn() });
    el.dataset.todoId = 'a';
    root.append(el);
    const stale = captureRects(root);
    stale.at -= 5000;
    playMoves(root, stale);
    expect(el.animate).not.toHaveBeenCalled();
  });
});
