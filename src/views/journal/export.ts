import type { StoredJournalEntry } from '../../data/stores/journal-store.ts';
import { entryImages, moodEmoji } from './shared/utils.ts';

/**
 * Plain-data export of journal entries — Markdown for reading/archiving, JSON
 * for tooling (scripts/notion-sync.mjs reads the JSON shape below).
 *
 * Photos are exported as their Storage URLs, not file contents: that keeps the
 * export a single small text file, at the cost of the links living as long as
 * the photos stay in Storage.
 */

export interface ExportedEntry {
  id: string;
  date: string;
  title: string;
  body: string;
  destination: string;
  tags: string[];
  mood: string;
  favorite: boolean;
  images: string[];
  tripId: string | null;
}

/** Oldest first, so an export reads like the trip happened. */
function chronological(entries: StoredJournalEntry[]): StoredJournalEntry[] {
  return [...entries].sort(
    (a, b) => a.happenedOn.localeCompare(b.happenedOn) || (a.createdAt ?? 0) - (b.createdAt ?? 0),
  );
}

export function entriesToJson(entries: StoredJournalEntry[]): ExportedEntry[] {
  return chronological(entries).map((e) => ({
    id: e.id,
    date: e.happenedOn,
    title: e.title.trim(),
    body: e.body.trim(),
    destination: e.destination.trim(),
    tags: e.tags,
    mood: e.mood ?? '',
    favorite: e.favorite,
    images: entryImages(e),
    tripId: e.tripId,
  }));
}

export function entriesToMarkdown(entries: StoredJournalEntry[]): string {
  const rows = entriesToJson(entries);
  if (rows.length === 0) return '# Journal\n\n_No entries._\n';

  const out: string[] = ['# Journal', ''];
  let lastDate = '';
  for (const e of rows) {
    if (e.date !== lastDate) {
      out.push(`## ${e.date}`, '');
      lastDate = e.date;
    }
    if (e.title) out.push(`### ${e.title}`, '');

    const meta = [
      e.destination && `📍 ${e.destination}`,
      moodEmoji(e.mood),
      e.tags.map((t) => `#${t}`).join(' '),
    ].filter(Boolean);
    if (meta.length) out.push(meta.join(' · '), '');

    if (e.body) out.push(e.body, '');
    for (const url of e.images) out.push(`![](${url})`, '');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** Save text as a file through a transient <a download>. */
export function downloadText(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportEntries(entries: StoredJournalEntry[], format: 'md' | 'json'): void {
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'json') {
    downloadText(`journal-${stamp}.json`, JSON.stringify(entriesToJson(entries), null, 2), 'application/json');
  } else {
    downloadText(`journal-${stamp}.md`, entriesToMarkdown(entries), 'text/markdown');
  }
}
