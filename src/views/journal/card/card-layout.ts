/* ==========================================================================
   On the Road · Share card — entry → structured card data
   --------------------------------------------------------------------------
   The journal entry stores free text in `body`. For shareable cards we parse
   that text into typed blocks the renderer can lay out. Parsing is best-effort
   and degrades gracefully: anything we can't classify becomes a paragraph, so
   the card is always renderable.

   Conventions recognised in body text (all optional, mix freely):
     ● / • / - / *  ……… list item (a "primary" line; following indented or
                          plain lines until the next marker are its details)
     key: value      ……… a labelled detail line (e.g. "Recommend: Café Crème")
     💡 …             ……… a highlighted tip box
     ✓ / ✔            ……… a checklist "loved" item
     Title:           ……… a section heading when it ends with ':' and is short
   ========================================================================== */

import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import { template } from '../templates.ts';
import { titleFor } from '../shared/utils.ts';

export type CardKind = 'moment' | 'note' | 'interesting' | 'place';

export interface ListItem {
  primary: string;
  details: string[];
}

export interface CardData {
  kind: CardKind;
  emoji: string;
  typeLabel: string;          // "Moments" …
  tint: string;               // hex from MAP_PALETTE
  title: string;              // headline / place name
  destination: string;        // "Cinque Terre, Italy"
  dateLabel: string;          // "Jul 21, 2026"
  tags: string[];
  coverImage?: string;
  // Parsed body
  paragraphs: string[];       // plain prose lines (Moments quote, Interesting note…)
  listItems: ListItem[];      // Notes-style bullet list
  loved: string[];            // "What I loved" ✓ items (Interesting)
  tip?: string;               // 💡 tip box (Notes)
  sections: { heading: string; body: string }[]; // Places "Highlights / Best time…"
  rating?: number;            // 0–5 (Places)
  recommend?: string;         // "Definitely!" style badge (Places)
}

const KIND_FALLBACK_LABEL: Record<CardKind, string> = {
  moment: 'Moments',
  note: 'Notes',
  interesting: 'Interesting',
  place: 'Places',
};

/** Map the four mood values to a rough 0–5 score for the Places star row. */
function ratingFromMood(mood?: string): number | undefined {
  if (!mood) return undefined;
  const map: Record<string, number> = { spark: 5, wired: 4.5, calm: 4, soft: 3.5 };
  return map[mood];
}

function isListMarker(line: string): boolean {
  return /^\s*[●•\-*]\s+/.test(line);
}
function stripListMarker(line: string): string {
  return line.replace(/^\s*[●•\-*]\s+/, '').trim();
}
function isCheckMarker(line: string): boolean {
  return /^\s*[✓✔]\s*/.test(line);
}
function stripCheckMarker(line: string): string {
  return line.replace(/^\s*[✓✔]\s*/, '').trim();
}
function isTip(line: string): boolean {
  return /^\s*💡/.test(line);
}
function stripTip(line: string): string {
  return line.replace(/^\s*💡\s*/, '').trim();
}
/** A short line ending with ':' / '：' and no value after — a section heading. */
function asHeading(line: string): string | null {
  const m = line.match(/^\s*(.{1,24}?)[:：]\s*$/);
  return m ? m[1].trim() : null;
}

export function buildCardData(entry: StoredJournalEntry): CardData {
  const tmpl = template(entry.template);
  const kind = (tmpl.kind as CardKind) ?? 'moment';

  const data: CardData = {
    kind,
    emoji: tmpl.emoji,
    typeLabel: tmpl.label || KIND_FALLBACK_LABEL[kind],
    tint: tmpl.tint,
    title: titleFor(entry),
    destination: entry.destination.trim(),
    dateLabel: prettyDateLong(entry.happenedOn),
    tags: entry.tags.slice(0, 4),
    coverImage: entry.coverImage || undefined,
    paragraphs: [],
    listItems: [],
    loved: [],
    sections: [],
    rating: ratingFromMood(entry.mood),
    recommend: undefined,
  };

  const lines = entry.body.split('\n').map((l) => l.replace(/\s+$/, ''));
  let pendingItem: ListItem | null = null;
  let pendingHeading: string | null = null;

  const flushItem = () => {
    if (pendingItem) { data.listItems.push(pendingItem); pendingItem = null; }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushItem(); pendingHeading = null; continue; }

    if (isTip(line)) {
      flushItem();
      data.tip = data.tip ? `${data.tip} ${stripTip(line)}` : stripTip(line);
      continue;
    }
    if (isCheckMarker(line)) {
      flushItem();
      data.loved.push(stripCheckMarker(line));
      continue;
    }
    if (isListMarker(line)) {
      flushItem();
      pendingItem = { primary: stripListMarker(line), details: [] };
      continue;
    }
    const heading = asHeading(line);
    if (heading) {
      flushItem();
      pendingHeading = heading;
      data.sections.push({ heading, body: '' });
      continue;
    }
    // Plain line: attach to the open list item, the open section, else prose.
    if (pendingItem) {
      pendingItem.details.push(line);
    } else if (pendingHeading && data.sections.length) {
      const sec = data.sections[data.sections.length - 1];
      sec.body = sec.body ? `${sec.body} ${line}` : line;
      // Detect a recommend verdict inside a "Recommend?" section.
      if (/recommend/i.test(pendingHeading) || /推荐|recommend/i.test(line)) {
        data.recommend ??= verdictFrom(line);
      }
    } else {
      data.paragraphs.push(line);
    }
  }
  flushItem();

  // Fallback: if nothing parsed into structure, the whole body is prose.
  if (
    data.paragraphs.length === 0 &&
    data.listItems.length === 0 &&
    data.loved.length === 0 &&
    data.sections.length === 0 &&
    entry.body.trim()
  ) {
    data.paragraphs = [entry.body.trim()];
  }

  if (data.kind !== 'place') {
    data.rating = undefined;
    data.recommend = undefined;
  }

  return data;
}

/** Pull a short "Definitely!" style badge from a recommend line. */
function verdictFrom(line: string): string | undefined {
  if (/强烈|definitely|absolutely|must/i.test(line)) return 'Definitely!';
  if (/不推荐|skip|no\b/i.test(line)) return 'Maybe not';
  if (/推荐|yes|worth|recommend/i.test(line)) return 'Recommend';
  return undefined;
}

function prettyDateLong(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
