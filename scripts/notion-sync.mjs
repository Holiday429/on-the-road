#!/usr/bin/env node
/**
 * Push exported journal entries to Notion, oldest first, one page per entry.
 *
 *   NOTION_TOKEN=secret_… node scripts/notion-sync.mjs journal-2026-10-07.json \
 *     --parent "https://www.notion.so/…-<32 hex id>" [--dry-run] [--limit 5]
 *
 * Input is the JSON from the journal's "⬇ JSON" export button.
 *
 * Parent can be a page or a database (detected via the API):
 *   page      → each entry becomes a child page titled "YYYY-MM-DD · title".
 *               Created oldest-first, so Notion's creation order == date order.
 *   database  → the title property gets the same title; the first `date`
 *               property gets the date, and a `multi_select` property named
 *               Tags/标签 gets the tags, if those exist.
 *
 * Re-runs are safe: synced ids are recorded in <input>.notion-state.json, and
 * existing child pages whose title already contains the entry's date + title
 * (e.g. the ones you pasted by hand) are skipped.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const API = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';

// ── args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const input = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !['--dry-run'].includes(args[i - 1])));
const dryRun = flag('dry-run');
const limit = opt('limit') ? Number(opt('limit')) : Infinity;
const parentArg = opt('parent') ?? process.env.NOTION_PARENT;
const token = process.env.NOTION_TOKEN;

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

/** Last 32 hex chars of a Notion URL or bare id → dashed UUID. */
export function parseNotionId(s) {
  const hex = (s ?? '').replace(/-/g, '').match(/[0-9a-f]{32}(?![0-9a-f])/i)?.[0];
  if (!hex) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ── block building ───────────────────────────────────────────────────────────
const MOOD = { spark: '⚡', calm: '🌊', wired: '🔥', soft: '🫧' };

/** Notion caps one rich-text object at 2000 chars. */
function richText(text) {
  const parts = [];
  for (let i = 0; i < text.length; i += 1900) parts.push({ type: 'text', text: { content: text.slice(i, i + 1900) } });
  return parts;
}

export function entryTitle(e) {
  const label = e.title || e.body.split(/\s+/).slice(0, 8).join(' ') || 'Untitled';
  return `${e.date} · ${label}`;
}

export function entryBlocks(e) {
  const blocks = [];
  const meta = [e.destination && `📍 ${e.destination}`, MOOD[e.mood], e.tags.map((t) => `#${t}`).join(' ')].filter(Boolean);
  if (meta.length) blocks.push({ type: 'paragraph', paragraph: { rich_text: richText(meta.join(' · ')) } });
  for (const line of e.body.split(/\n+/).filter(Boolean)) {
    blocks.push({ type: 'paragraph', paragraph: { rich_text: richText(line) } });
  }
  for (const url of e.images) {
    if (!/^https?:\/\//.test(url)) continue; // legacy inline data: URLs can't be linked
    blocks.push({ type: 'image', image: { type: 'external', external: { url } } });
  }
  return blocks;
}

// ── Notion client ────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': VERSION, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) {
      await sleep((Number(res.headers.get('retry-after')) || 2) * 1000);
      continue;
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json.code ?? ''} ${json.message ?? ''}`.trim());
    await sleep(350); // stay under ~3 req/s
    return json;
  }
  throw new Error(`${method} ${path} → still rate-limited after retries`);
}

async function resolveParent(id) {
  try {
    await api('GET', `/pages/${id}`);
    return { kind: 'page' };
  } catch (pageErr) {
    try {
      const db = await api('GET', `/databases/${id}`);
      const props = Object.entries(db.properties);
      return {
        kind: 'database',
        titleProp: props.find(([, p]) => p.type === 'title')?.[0],
        dateProp: props.find(([, p]) => p.type === 'date')?.[0],
        tagsProp: props.find(([n, p]) => p.type === 'multi_select' && /^(tags?|标签)$/i.test(n))?.[0],
      };
    } catch {
      throw new Error(`Can't read the parent as a page or database — is it shared with the integration? (${pageErr.message})`);
    }
  }
}

async function existingTitles(id, kind) {
  const titles = [];
  if (kind === 'page') {
    let cursor;
    do {
      const r = await api('GET', `/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
      for (const b of r.results) if (b.type === 'child_page') titles.push(b.child_page.title);
      cursor = r.has_more ? r.next_cursor : undefined;
    } while (cursor);
  }
  return titles;
}

async function createEntryPage(parentId, parent, e) {
  const title = entryTitle(e);
  const blocks = entryBlocks(e);
  const properties =
    parent.kind === 'database'
      ? {
          [parent.titleProp]: { title: richText(title) },
          ...(parent.dateProp && { [parent.dateProp]: { date: { start: e.date } } }),
          ...(parent.tagsProp && e.tags.length && { [parent.tagsProp]: { multi_select: e.tags.map((name) => ({ name: name.replace(/,/g, ' ') })) } }),
        }
      : { title: { title: richText(title) } };

  const page = await api('POST', '/pages', {
    parent: parent.kind === 'database' ? { database_id: parentId } : { page_id: parentId },
    properties,
    children: blocks.slice(0, 100),
  });
  for (let i = 100; i < blocks.length; i += 100) {
    await api('PATCH', `/blocks/${page.id}/children`, { children: blocks.slice(i, i + 100) });
  }
  return page.id;
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!input) die('usage: notion-sync.mjs <journal.json> --parent <notion url|id> [--dry-run] [--limit N]');
  const parentId = parseNotionId(parentArg);
  if (!parentId) die('--parent (or NOTION_PARENT) must be a Notion page/database URL or id');
  if (!dryRun && !token) die('set NOTION_TOKEN (an internal integration secret that the target page is shared with)');

  const entries = JSON.parse(readFileSync(input, 'utf8'));
  const stateFile = `${input}.notion-state.json`;
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};

  let parent = { kind: 'page' };
  let existing = [];
  if (token) {
    parent = await resolveParent(parentId);
    existing = await existingTitles(parentId, parent.kind);
    console.log(`Parent is a ${parent.kind}; ${existing.length} existing child page(s).`);
  }

  const alreadyThere = (e) =>
    existing.some((t) => t.includes(e.date) && (!e.title || t.includes(e.title)) && (e.title || t === entryTitle(e)));

  let done = 0;
  for (const e of entries) {
    if (done >= limit) break;
    const label = entryTitle(e);
    if (state[e.id]) { console.log(`= already synced  ${label}`); continue; }
    if (alreadyThere(e)) { console.log(`= exists in Notion ${label}`); continue; }
    if (dryRun) { console.log(`+ would create    ${label}  (${entryBlocks(e).length} blocks)`); done++; continue; }
    try {
      state[e.id] = await createEntryPage(parentId, parent, e);
      writeFileSync(stateFile, JSON.stringify(state, null, 2));
      console.log(`+ created         ${label}`);
      done++;
    } catch (err) {
      console.error(`✗ failed          ${label}: ${err.message}`);
      process.exitCode = 1;
    }
  }
  console.log(`${dryRun ? 'Would create' : 'Created'} ${done} page(s).`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => die(e.message));
