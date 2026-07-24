/* Shared utilities — import from here instead of redeclaring per-view. */

/** Escape HTML special characters to prevent XSS in innerHTML templates. */
export function escHtml(s: string | undefined | null): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape a URL for use inside an href / src / CSS url() built from external
 * data. Blocks javascript:/data: and other non-http(s) schemes (which escHtml
 * alone does not — it only stops attribute breakout, not scheme injection),
 * then HTML-escapes so it's also safe inside a quoted attribute. Returns ''
 * for anything that isn't a plain http(s) URL.
 */
export function safeUrl(s: string | undefined | null): string {
  if (!s) return '';
  const trimmed = s.trim();
  if (!/^https?:\/\//i.test(trimmed)) return '';
  return escHtml(trimmed);
}

/** Convert a string to a URL-safe slug (lowercase, hyphens). */
export function slugId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
