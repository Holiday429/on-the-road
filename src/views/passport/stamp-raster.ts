/* ==========================================================================
   On the Road · Passport — a stamp as a bitmap
   --------------------------------------------------------------------------
   A stamp is inline SVG that leans on the page's stylesheet (classes, CSS
   variables, a web font, a shared filter). An SVG drawn onto a canvas has none
   of that, so this builds a stand-alone copy: the stamp's own markup, only the
   stamp rules from the page's CSS, the worn-ink filters, and the two fonts it
   uses embedded as data. Always the light-theme ink — the picture leaves the app.

   DOM-dependent by nature (it reads the live stylesheets), so it is checked by
   eye in a browser, not in unit tests.
   ========================================================================== */

import { renderStamp, type StampSpec } from '../../core/paper/stamp.ts';
import { INK_FILTERS } from '../../core/paper/stamp-base.ts';
import { SHARE } from './share-palette.ts';

/** The faces a stamp is set in: the condensed name face and the data face for the date. */
const FONTS: Array<{ family: string; file: string; weight: string }> = [
  { family: 'Oswald', file: 'oswald-normal-latin.woff2', weight: '500 600' },
  { family: 'JetBrains Mono', file: 'jetbrains-mono-normal-latin.woff2', weight: '400 600' },
];

/** Stamp classes in paper.css that the SVG needs; anything for the dark theme is left behind. */
const STAMP_RULE = /\.pp-(line|thick|dash|t|xs|sm|md|lg|xl|name|date|icon|perf|ghost)\b/;

let fontCss: Promise<string> | null = null;
let ruleCss: string | null = null;

function toBase64(buf: ArrayBuffer): string {
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** @font-face rules with the font files inlined; a font that cannot be fetched is skipped (the fallback face is used). */
function embeddedFonts(): Promise<string> {
  fontCss ??= Promise.all(FONTS.map(async (f) => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}fonts/${f.file}`.replace(/\/{2,}/g, '/'));
      if (!res.ok) return '';
      const data = toBase64(await res.arrayBuffer());
      return `@font-face{font-family:'${f.family}';font-weight:${f.weight};src:url(data:font/woff2;base64,${data}) format('woff2');}`;
    } catch { return ''; }
  })).then((parts) => parts.join(''));
  return fontCss;
}

/** The stamp rules of the page's stylesheets, with the CSS variables they use written out. */
function stampRules(): string {
  if (ruleCss !== null) return ruleCss;
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }   // a cross-origin sheet cannot be read
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule && STAMP_RULE.test(rule.selectorText) && !rule.selectorText.includes('data-theme')) out.push(rule.cssText);
    }
  }
  ruleCss = out.join('')
    .replace(/var\(--font-data\)/g, "'JetBrains Mono', ui-monospace, monospace")
    .replace(/var\(--font-stamp\)/g, "'Oswald', 'Arial Narrow', sans-serif");
  return ruleCss;
}

/** The stamp as a stand-alone SVG document string, `px` pixels square. */
export async function standaloneStampSvg(stamp: StampSpec, px: number): Promise<string | null> {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-9999px;top:0;pointer-events:none';
  // eslint-disable-next-line no-restricted-syntax -- audited: renderStamp escapes every interpolation
  host.innerHTML = renderStamp(stamp, { size: px });
  document.body.appendChild(host);
  try {
    const wrap = host.querySelector<HTMLElement>('.pp-stamp');
    const svg = host.querySelector('svg');
    if (!wrap || !svg) return null;
    // A colour that is a token (var(...)) cannot be resolved outside the page: plain ink instead.
    const raw = wrap.style.getPropertyValue('--ink-c').trim();
    const ink = raw && !raw.startsWith('var(') ? raw : SHARE.ink;
    const strength = wrap.style.getPropertyValue('--ink-o').trim() || '0.9';
    const filters = INK_FILTERS.map((id) => document.getElementById(id)?.outerHTML ?? '').join('');
    const css = `${await embeddedFonts()}${stampRules()}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="${px}" height="${px}" style="color:${ink};opacity:${strength}">`
      + `<defs><style>${css}</style>${filters}</defs>${svg.innerHTML}</svg>`;
  } finally {
    host.remove();
  }
}

/** The stamp as an image ready for `drawImage`; null when the browser cannot draw it. */
export async function stampImage(stamp: StampSpec, px = 480): Promise<HTMLImageElement | null> {
  const svg = await standaloneStampSvg(stamp, px);
  if (!svg) return null;
  return new Promise((resolve) => {
    const img = new Image();
    const timer = window.setTimeout(() => resolve(null), 4000);
    img.onload = () => { window.clearTimeout(timer); resolve(img); };
    img.onerror = () => { window.clearTimeout(timer); resolve(null); };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}
