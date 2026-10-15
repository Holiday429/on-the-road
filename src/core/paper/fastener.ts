/* ==========================================================================
   On the Road · Paper kit · fasteners
   --------------------------------------------------------------------------
   The small hardware that holds a piece of paper to something else: washi tape,
   a corner strip, a thumbtack, a safety pin, a paperclip, a bulldog clip.

   Pure functions of plain props — no state, no DOM, no page knowledge. Colour
   comes from classes in fastener.css (tokens only), never from literals, so the
   matte palette and dark mode carry over untouched.

       import '../../core/paper/fastener.css';

   `fastenerFor(id)` picks one from a string key, so a given note or card keeps
   the same fastener across re-renders without anything being stored.
   ========================================================================== */

/** Every kind of fastener the kit draws. */
export type FastenerKind = 'tape' | 'corner' | 'pin' | 'safety' | 'clip' | 'bulldog';

/** Thumbtack / clip colours — matte accents, never a literal hex. */
const PIN_COLOURS = ['var(--coral-500)', 'var(--sky-500)', 'var(--sage-500)', 'var(--amber-500)'];

/** Washi tape tints, for the kinds that are a strip of tape. */
const TAPE_COLOURS = ['var(--amber-300)', 'var(--sky-400)', 'var(--sage-400)', 'var(--coral-400)'];

export interface FastenerOpts {
  /** Where on the edge it sits, 0–1 across the top. Default centred. */
  at?: number;
  /** Degrees of extra lean, on top of the kind's own angle. */
  tilt?: number;
  /** Override the picked colour (a token expression, e.g. `var(--sky-500)`). */
  colour?: string;
}

/** A small, stable hash of a string — same id, same fastener, every render. */
export function hashKey(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return h;
}

/**
 * The fastener a given id gets, from a weighted list: tape and pins are the
 * everyday ones, the clips rarer, so a wall of cards does not read as a
 * hardware catalogue.
 */
const ROTATION: FastenerKind[] = ['tape', 'pin', 'corner', 'clip', 'tape', 'safety', 'pin', 'bulldog'];

export function fastenerFor(id: string): FastenerKind {
  return ROTATION[hashKey(id) % ROTATION.length];
}

const SAFETY_SVG = '<svg viewBox="0 0 44 18" aria-hidden="true"><path d="M6 5 H34 a5 5 0 0 1 0 8 H8 a4 4 0 0 1 0 -8 H30"/><circle cx="6" cy="9" r="3.4"/></svg>';
const CLIP_SVG = '<svg viewBox="0 0 20 46" aria-hidden="true"><path d="M14.5 13 V33 a4.5 4.5 0 0 1 -9 0 V11 a6.5 6.5 0 0 1 13 0 V31"/></svg>';
const BULLDOG_SVG = '<svg viewBox="0 0 40 26" aria-hidden="true"><path class="fst-bulldog-jaw" d="M3 7 H37 L31 23 H9 Z"/><path class="fst-bulldog-arm" d="M11 7 L7 2 M29 7 L33 2"/></svg>';

/**
 * One fastener, as a positioned span to drop inside a `position: relative` card.
 *
 * The caller places nothing: each kind knows where it belongs (tape across the
 * top edge, a corner strip over the top-left, a clip hooked over the edge).
 */
export function renderFastener(kind: FastenerKind, opts: FastenerOpts = {}): string {
  const inner = kind === 'safety' ? SAFETY_SVG : kind === 'clip' ? CLIP_SVG : kind === 'bulldog' ? BULLDOG_SVG : '';
  const style = [
    opts.colour ? `--fst-colour:${opts.colour}` : '',
    opts.at !== undefined ? `--fst-at:${Math.round(opts.at * 100)}%` : '',
    opts.tilt !== undefined ? `--fst-tilt:${opts.tilt}deg` : '',
  ].filter(Boolean).join(';');
  return `<span class="fst fst--${kind}"${style ? ` style="${style}"` : ''} aria-hidden="true">${inner}</span>`;
}

/**
 * The fastener for an id, with its colour and lean already chosen from that same
 * id — the one call a card usually wants.
 */
export function renderFastenerFor(id: string, opts: FastenerOpts = {}): string {
  const kind = fastenerFor(id);
  const h = hashKey(id);
  const palette = kind === 'tape' || kind === 'corner' ? TAPE_COLOURS : PIN_COLOURS;
  return renderFastener(kind, {
    colour: palette[(h >> 3) % palette.length],
    // Tape and clips slide along the edge; pins stay where their kind puts them.
    at: kind === 'tape' || kind === 'clip' || kind === 'bulldog' ? 0.22 + ((h >> 5) % 56) / 100 : undefined,
    tilt: ((h >> 7) % 9) - 4,
    ...opts,
  });
}
