/* ==========================================================================
   On the Road · Recap export — text layout
   --------------------------------------------------------------------------
   Canvas has no text wrapping, so lines are broken here. Pure functions over a
   `measure` callback, so the logic is testable without a canvas and the same
   code lays out both the single-card images and the long image.

   Wrapping follows how Chinese and English actually break:
   · CJK breaks between any two characters;
   · Latin keeps words whole;
   · and a closing punctuation mark never starts a line (避头尾 / kinsoku) — it
     hangs on the end of the previous line instead, as a typeset page would.
   ========================================================================== */

/** A stretch of text sharing one style. `em` marks the highlighted key sentence. */
export interface Run { text: string; em: boolean }

export interface Segment { text: string; em: boolean; width: number }
export interface Line { segments: Segment[]; width: number }

/** Width in px of `text` set in the plain (em=false) or emphasised (em=true) face. */
export type Measure = (text: string, em: boolean) => number;

/** Marks that must not begin a line. */
const NO_LINE_START = new Set('，。、；：！？）】」』”’》〉…—·,.;:!?)]}%'.split(''));
/** Marks that must not end a line (an opening bracket stranded alone). */
const NO_LINE_END = new Set('（【「『“‘《〈([{'.split(''));

/** Latin word (with its trailing punctuation), whitespace run, or a single other character. */
const TOKEN = /[A-Za-z0-9'’@#$€£¥&%+/_-]+(?:[.:][A-Za-z0-9/_-]+)*[.,;:!?)\]}”’…]*|\s+|[^\s]/g;

interface Token { text: string; em: boolean }

function tokenize(runs: Run[]): Token[] {
  const out: Token[] = [];
  for (const run of runs) {
    for (const text of run.text.match(TOKEN) ?? []) out.push({ text, em: run.em });
  }
  return out;
}

/**
 * Break styled text into lines no wider than `maxWidth`.
 *
 * A single token wider than a whole line (a URL, say) is kept on its own line
 * rather than split — an overflow of a few pixels reads better than a broken word.
 */
export function wrapRuns(runs: Run[], measure: Measure, maxWidth: number): Line[] {
  const lines: Line[] = [];
  let segs: Segment[] = [];
  let width = 0;

  const push = (text: string, em: boolean, w: number) => {
    const last = segs[segs.length - 1];
    if (last && last.em === em) { last.text += text; last.width += w; } else segs.push({ text, em, width: w });
    width += w;
  };
  const flush = () => {
    // Trailing spaces never count towards a line's width or its right edge.
    while (segs.length) {
      const last = segs[segs.length - 1];
      const trimmed = last.text.replace(/\s+$/, '');
      if (trimmed === last.text) break;
      if (!trimmed) { width -= last.width; segs.pop(); continue; }
      const w = measure(trimmed, last.em);
      width -= last.width - w;
      last.text = trimmed;
      last.width = w;
      break;
    }
    if (segs.length) lines.push({ segments: segs, width });
    segs = [];
    width = 0;
  };

  for (const token of tokenize(runs)) {
    const isSpace = /^\s+$/.test(token.text);
    if (!segs.length && isSpace) continue; // no leading spaces on a line

    const w = measure(token.text, token.em);
    const fits = width + w <= maxWidth || !segs.length;

    if (fits) { push(token.text, token.em, w); continue; }

    // It doesn't fit. A closing mark hangs on the current line rather than start the next.
    if (NO_LINE_START.has(token.text[0]) && !isSpace) { push(token.text, token.em, w); continue; }

    // Don't strand an opening bracket at the end of a line: carry it down with the token.
    const tail = segs[segs.length - 1];
    const carry = tail && NO_LINE_END.has(tail.text[tail.text.length - 1]) ? tail.text[tail.text.length - 1] : '';
    if (carry) {
      tail.text = tail.text.slice(0, -1);
      tail.width = measure(tail.text, tail.em);
      width = segs.reduce((n, s) => n + s.width, 0);
      flush();
      if (isSpace) continue;
      push(carry + token.text, token.em, measure(carry + token.text, token.em));
      continue;
    }

    flush();
    if (isSpace) continue;
    push(token.text, token.em, w);
  }
  flush();
  avoidOrphan(lines, measure);
  return lines.length ? lines : [{ segments: [], width: 0 }];
}

/**
 * A last line of a single CJK glyph looks like a mistake ("…被设计成这 / 样").
 * Pull one glyph down from the line above so the last line carries two.
 * Only for CJK, only when the line above can spare it, and never moving a mark
 * that must not begin a line.
 */
function avoidOrphan(lines: Line[], measure: Measure): void {
  if (lines.length < 2) return;
  const last = lines[lines.length - 1];
  const prev = lines[lines.length - 2];
  const lastText = last.segments.map((s) => s.text).join('');
  const glyphs = [...lastText];
  if (glyphs.length > 1 || /[A-Za-z0-9]/.test(lastText)) return;

  const tail = prev.segments[prev.segments.length - 1];
  const tailGlyphs = [...tail.text];
  if (!tail || tailGlyphs.length < 3) return;
  const moved = tailGlyphs[tailGlyphs.length - 1];
  if (NO_LINE_START.has(moved) || NO_LINE_END.has(moved) || /[A-Za-z0-9\s]/.test(moved)) return;

  tail.text = tailGlyphs.slice(0, -1).join('');
  tail.width = measure(tail.text, tail.em);
  prev.width = prev.segments.reduce((n, s) => n + s.width, 0);

  const first = last.segments[0];
  if (first && first.em === tail.em) {
    first.text = moved + first.text;
    first.width = measure(first.text, first.em);
  } else {
    last.segments.unshift({ text: moved, em: tail.em, width: measure(moved, tail.em) });
  }
  last.width = last.segments.reduce((n, s) => n + s.width, 0);
}

export interface Fit {
  /** The chosen font size in px. */
  size: number;
  lines: Line[];
  /** Total height of the block in px. */
  height: number;
}

/**
 * Pick the largest font size, from the candidates, whose wrapped text fits
 * `maxHeight`. Falls back to the smallest and TRUNCATES with an ellipsis rather
 * than let text run into the bar beneath it. `measureAt(size)` returns the
 * measure for that size.
 */
export function fitRuns(
  runs: Run[],
  measureAt: (size: number) => Measure,
  maxWidth: number,
  maxHeight: number,
  sizes: number[],
  lineHeight: number,
): Fit {
  let last: Fit | null = null;
  for (const size of sizes) {
    const lines = wrapRuns(runs, measureAt(size), maxWidth);
    const height = lines.length * size * lineHeight;
    last = { size, lines, height };
    if (height <= maxHeight) return last;
  }
  const size = sizes[sizes.length - 1];
  const measure = measureAt(size);
  const maxLines = Math.max(1, Math.floor(maxHeight / (size * lineHeight)));
  const lines = (last as Fit).lines.slice(0, maxLines);
  if ((last as Fit).lines.length > maxLines) ellipsize(lines[lines.length - 1], measure, maxWidth);
  return { size, lines, height: lines.length * size * lineHeight };
}

/** Shorten a line in place until it and an ellipsis fit. */
function ellipsize(line: Line, measure: Measure, maxWidth: number): void {
  const ell = '…';
  const last = line.segments[line.segments.length - 1];
  if (!last) return;
  while (last.text.length > 1 && line.width - last.width + measure(last.text + ell, last.em) > maxWidth) {
    last.text = last.text.slice(0, -1);
    last.width = measure(last.text, last.em);
    line.width = line.segments.reduce((n, s) => n + s.width, 0);
  }
  last.text += ell;
  last.width = measure(last.text, last.em);
  line.width = line.segments.reduce((n, s) => n + s.width, 0);
}
