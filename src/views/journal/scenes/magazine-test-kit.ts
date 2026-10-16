/* Test helpers for the magazine: a fake measurer (every character is 15 × 26 px, a drop cap costs six) and article builders. Not shipped: only tests import it. */
import type { Article, PhotoRef } from './magazine-model.ts';
import type { FrameSpec, Measurer } from './magazine-paginate.ts';

export const CHAR_W = 15;
export const LINE_H = 26;

export function fakeMeasurer(): Measurer {
  return {
    fit(text: string, f: FrameSpec) {
      const colW = f.cols === 2 ? (f.w - 24) / 2 : f.w;
      const perCol = Math.floor(f.h / LINE_H) * Math.floor(colW / CHAR_W);
      const room = Math.max(0, f.cols * perCol - (f.dropcap ? 6 : 0));
      return Math.min(text.length, room);
    },
    quote(text, w) {
      return Math.ceil((text.length * 22) / w) * 30 + 40;
    },
    used(text, f) {
      const colW = f.cols === 2 ? (f.w - 24) / 2 : f.w;
      const lines = Math.ceil(text.length / Math.max(1, Math.floor(colW / CHAR_W)));
      // the last frame's columns are balanced, so two columns share the lines
      return Math.min(f.h, Math.ceil(lines / f.cols) * LINE_H);
    },
    head(a, w, size) {
      const per = Math.max(1, Math.floor(w / (size === 'l' ? 26 : 20)));
      return Math.ceil(a.headline.length / per) * (size === 'l' ? 52 : 44) + 30;
    },
  };
}

export const photo = (ratio: PhotoRef['ratio'], i = 0): PhotoRef => ({
  src: `p${ratio.replace(':', 'x')}-${i}.jpg`, ratio,
  orient: ratio === '1:1' ? 'square' : ['4:3', '3:2', '16:9'].includes(ratio) ? 'landscape' : 'portrait',
});

let n = 0;
export function article(over: Partial<Article> & { chars?: number } = {}): Article {
  n++;
  const { chars = 0, ...rest } = over;
  // paragraphs of ~120 characters, so there are real paragraph breaks to cut at
  const paragraphs = rest.paragraphs ?? Array.from({ length: Math.ceil(chars / 120) }, (_, i) => `第${i}段`.padEnd(Math.min(120, chars - i * 120), '字'));
  return { id: `a${n}`, kicker: '06 SEP · TEST', headline: `Article ${n}`, paragraphs, photos: [], caption: 'Test · 06 SEP 2026', quote: null, ...rest };
}
