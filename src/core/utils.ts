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

/**
 * Patch `target`'s children in place to match `html`, instead of replacing
 * them wholesale (`target.innerHTML = html`). Views in this codebase render
 * by re-stringifying their whole subtree on every state change; a plain
 * innerHTML swap then tears down and recreates every node, including <img>
 * elements whose src didn't change — forcing a re-decode/re-paint and a
 * blank flash even when the browser has the bytes cached. Morphing by
 * position + tag name reuses unchanged nodes (most importantly <img>, whose
 * src attribute is left untouched when identical) so only what actually
 * differs gets touched.
 *
 * Not a general-purpose vdom: no keyed reordering, no component identity.
 * Good enough for list-like template output where item order is stable
 * across renders (new items append/insert, same items keep the same slot).
 */
export function morphInto(target: Element, html: string): void {
  const next = document.createElement(target.tagName.toLowerCase());
  next.innerHTML = html;
  morphChildren(target, next);
}

function morphChildren(target: Element | DocumentFragment, next: Element): void {
  const targetChildren = Array.from(target.childNodes);
  const nextChildren = Array.from(next.childNodes);
  const max = Math.max(targetChildren.length, nextChildren.length);

  for (let i = 0; i < max; i++) {
    const oldNode = targetChildren[i];
    const newNode = nextChildren[i];

    if (!newNode) {
      oldNode?.remove();
      continue;
    }
    if (!oldNode) {
      target.appendChild(newNode);
      continue;
    }
    morphNode(target, oldNode, newNode);
  }
}

function morphNode(parent: Element | DocumentFragment, oldNode: ChildNode, newNode: ChildNode): void {
  if (oldNode.nodeType !== newNode.nodeType || oldNode.nodeName !== newNode.nodeName) {
    parent.replaceChild(newNode, oldNode);
    return;
  }

  if (oldNode.nodeType === Node.TEXT_NODE || oldNode.nodeType === Node.COMMENT_NODE) {
    if (oldNode.textContent !== newNode.textContent) oldNode.textContent = newNode.textContent;
    return;
  }

  if (!(oldNode instanceof Element) || !(newNode instanceof Element)) {
    parent.replaceChild(newNode, oldNode);
    return;
  }

  morphAttributes(oldNode, newNode);
  morphChildren(oldNode, newNode);
}

function morphAttributes(oldEl: Element, newEl: Element): void {
  const oldAttrs = oldEl.attributes;
  const newAttrs = newEl.attributes;

  for (let i = oldAttrs.length - 1; i >= 0; i--) {
    const name = oldAttrs[i].name;
    if (!newEl.hasAttribute(name)) oldEl.removeAttribute(name);
  }
  for (let i = 0; i < newAttrs.length; i++) {
    const { name, value } = newAttrs[i];
    if (oldEl.getAttribute(name) !== value) oldEl.setAttribute(name, value);
  }
}
