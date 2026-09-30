import { describe, expect, it } from 'vitest';
import { inferTemplate } from './classify.ts';

const draft = (over: Partial<Parameters<typeof inferTemplate>[0]> = {}) => ({
  body: '', mood: '', linkedPlaces: [], ...over,
});

describe('inferTemplate', () => {
  it('defaults to moment for an empty draft', () => {
    expect(inferTemplate(draft())).toBe('moment');
  });

  it('reads prices as a note', () => {
    expect(inferTemplate(draft({ body: '手冲 ¥800，老板很酷' }))).toBe('note');
    expect(inferTemplate(draft({ body: '门票 1200 円' }))).toBe('note');
  });

  it('reads clock times and opening hours as a note', () => {
    expect(inferTemplate(draft({ body: '9:30 开门，别太早去' }))).toBe('note');
    expect(inferTemplate(draft({ body: '需要提前预约' }))).toBe('note');
  });

  it('prefers note over place when the body is practical', () => {
    expect(inferTemplate(draft({ body: '门票 ¥800', linkedPlaces: ['p1'] }))).toBe('note');
  });

  it('reads a linked place as place', () => {
    expect(inferTemplate(draft({ body: '很安静', linkedPlaces: ['p1'] }))).toBe('place');
  });

  it('reads a mood as moment', () => {
    expect(inferTemplate(draft({ body: '今天很好', mood: '😄' }))).toBe('moment');
  });

  it('ignores a whitespace-only mood', () => {
    expect(inferTemplate(draft({ body: '今天很好', mood: '  ' }))).toBe('moment');
  });

  it('does not treat a bare year as a price', () => {
    expect(inferTemplate(draft({ body: '走了很久的路' }))).toBe('moment');
  });
});
