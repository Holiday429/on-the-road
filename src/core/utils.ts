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

/** Convert a string to a URL-safe slug (lowercase, hyphens). */
export function slugId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
