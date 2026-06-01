/* ==========================================================================
   On the Road · Journal (feed mode)
   --------------------------------------------------------------------------
   A feed of quick-capture cards. The template stamps sit right on the page —
   tapping one opens the composer already set to that template, so a note is
   one click + one line away. Each template renders as a distinct card format
   (polaroid, postcard, sticky, IG-style post, ticket).

   Everything is stored in the cloud via journalStore (Firestore is the source
   of truth; localStorage is only an instant-paint cache in the store layer).
   Templates live in ./templates.ts — adding one there surfaces it everywhere.
   ========================================================================== */

import './journal.css';
import { journalStore, type StoredJournalEntry } from '../../data/stores/journal-store.ts';
import { routeStore, type StoredLeg } from '../../data/stores/route-store.ts';
import {
  JOURNAL_TEMPLATES,
  DEFAULT_TEMPLATE,
  template,
  type TemplateId,
} from './templates.ts';

type Filter = { template: TemplateId | 'all'; destination: string; favoritesOnly: boolean };

interface DraftState {
  body: string;
  title: string;
  template: TemplateId;
  destination: string;
  tagsText: string;
  mood: string;
  happenedOn: string;
}

const MOODS: { value: string; emoji: string }[] = [
  { value: 'spark', emoji: '⚡' },
  { value: 'calm', emoji: '🌊' },
  { value: 'wired', emoji: '🔥' },
  { value: 'soft', emoji: '🫧' },
];

let entries: StoredJournalEntry[] = [];
let legs: StoredLeg[] = [];
let editingId: string | null = null;
let composerOpen = false;
let promptIndex = 0;

let filter: Filter = { template: 'all', destination: 'all', favoritesOnly: false };
let draft: DraftState = defaultDraft();

/* ── Draft helpers ───────────────────────────────────────────────────────── */

function defaultDraft(templateId: TemplateId = DEFAULT_TEMPLATE): DraftState {
  return {
    body: '',
    title: '',
    template: templateId,
    destination: currentCity(),
    tagsText: '',
    mood: 'spark',
    happenedOn: new Date().toISOString().slice(0, 10),
  };
}

function resetDraft() {
  editingId = null;
  composerOpen = false;
  draft = defaultDraft();
  promptIndex += 1;
}

function openComposer(templateId: TemplateId) {
  editingId = null;
  composerOpen = true;
  draft = defaultDraft(templateId);
}

function loadEntryIntoDraft(id: string) {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  editingId = id;
  composerOpen = true;
  draft = {
    body: entry.body,
    title: entry.title,
    template: template(entry.template).id as TemplateId,
    destination: entry.destination,
    tagsText: entry.tags.join(', '),
    mood: entry.mood ?? 'spark',
    happenedOn: entry.happenedOn,
  };
}

function syncDraftFromDom(root: HTMLElement) {
  const get = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel);
  draft = {
    body: get<HTMLTextAreaElement>('#journal-body')?.value ?? draft.body,
    title: get<HTMLInputElement>('#journal-title')?.value ?? draft.title,
    template: draft.template,
    destination: get<HTMLInputElement>('#journal-destination')?.value ?? draft.destination,
    tagsText: get<HTMLInputElement>('#journal-tags')?.value ?? draft.tagsText,
    mood: ((root.querySelector('input[name="journal-mood"]:checked') as HTMLInputElement | null)?.value as string) ?? draft.mood,
    happenedOn: get<HTMLInputElement>('#journal-date')?.value ?? draft.happenedOn,
  };
}

/* ── Pure helpers ────────────────────────────────────────────────────────── */

function escHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function parseTags(text: string): string[] {
  return text
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .filter((t, i, list) => list.indexOf(t) === i)
    .slice(0, 6);
}

/** Best guess at "where you are now" from the itinerary, for auto-fill. */
function currentCity(): string {
  const today = new Date().toISOString().slice(0, 10);
  const active = legs.find((l) => l.dateFrom <= today && l.dateTo >= today);
  return (active ?? [...legs].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom))[0])?.city ?? '';
}

function suggestedDestinations(): string[] {
  const fromLegs = legs.map((l) => l.city.trim()).filter(Boolean);
  const fromEntries = entries.map((e) => e.destination.trim()).filter(Boolean);
  return [...new Set([...fromLegs, ...fromEntries])].slice(0, 10);
}

function visibleEntries(): StoredJournalEntry[] {
  return [...entries]
    .sort((a, b) => b.happenedOn.localeCompare(a.happenedOn) || b.updatedAt - a.updatedAt)
    .filter((e) => filter.template === 'all' || template(e.template).id === filter.template)
    .filter((e) => filter.destination === 'all' || e.destination === filter.destination)
    .filter((e) => !filter.favoritesOnly || e.favorite);
}

function excerpt(text: string, length = 200): string {
  const trimmed = text.trim();
  if (trimmed.length <= length) return trimmed;
  return `${trimmed.slice(0, length).trim()}…`;
}

function titleFor(entry: StoredJournalEntry): string {
  if (entry.title.trim()) return entry.title.trim();
  const fallback = entry.body.trim().split(/\s+/).slice(0, 6).join(' ');
  return fallback || template(entry.template).label;
}

function prettyDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function moodEmoji(mood?: string): string {
  return MOODS.find((m) => m.value === mood)?.emoji ?? '';
}

function slugify(entry: StoredJournalEntry): string {
  const base = titleFor(entry)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'note';
  return `${base}-${entry.id.slice(0, 6)}`;
}

function shareUrl(slug: string): string {
  return `${location.origin}${location.pathname}#/s/${slug}`;
}

/* ── Render: template stamps (always visible entry points) ───────────────── */

function renderStamps(): string {
  return `
    <div class="journal-stamps">
      ${JOURNAL_TEMPLATES.map((t) => `
        <button class="journal-stamp journal-fmt-${t.format} ${composerOpen && !editingId && draft.template === t.id ? 'active' : ''}"
                style="--tint:${t.tint}" data-stamp="${t.id}" type="button" title="${escHtml(t.label)}">
          <span class="journal-stamp-emoji">${t.emoji}</span>
          <span class="journal-stamp-label">${escHtml(t.label)}</span>
        </button>
      `).join('')}
    </div>
  `;
}

/* ── Render: composer ────────────────────────────────────────────────────── */

function renderComposer(): string {
  const t = template(draft.template);
  const prompt = t.prompts[promptIndex % t.prompts.length];
  const destinations = suggestedDestinations();

  // Field labels adapt to the template so the composer reads differently per
  // format — a Note asks for "Tip", a Place asks "Where", etc.
  const placeLabel = draft.template === 'interesting' ? 'Where' : 'Place';
  const bodyLabel: Record<string, string> = {
    polaroid: 'Caption',
    postcard: 'Message',
    ticket: 'Details',
    sticky: 'Note to self',
    post: 'Caption',
  };

  return `
    <section class="journal-composer journal-fmt-${t.format}" style="--tint:${t.tint}">
      <div class="journal-composer-head">
        <span class="journal-composer-emoji">${t.emoji}</span>
        <div class="journal-composer-headings">
          <span class="journal-composer-format">${escHtml(t.label)}</span>
          <span class="journal-composer-prompt">${escHtml(prompt)}</span>
        </div>
        <button class="journal-icon-btn" id="journal-shuffle" type="button" title="Another prompt">↻</button>
        <button class="journal-icon-btn" id="journal-close-composer" type="button" title="Close">✕</button>
      </div>

      <div class="journal-write-area">
        <label class="journal-body-label" for="journal-body">${escHtml(bodyLabel[t.format] ?? 'Note')}</label>
        <textarea class="journal-textarea" id="journal-body" placeholder="${escHtml(t.placeholder)}">${escHtml(draft.body)}</textarea>
      </div>

      <div class="journal-meta-row">
        <input class="input journal-meta-title" id="journal-title" maxlength="80" placeholder="Title (optional)" value="${escHtml(draft.title)}">
        <input class="input journal-meta-date" type="date" id="journal-date" value="${escHtml(draft.happenedOn)}">
      </div>

      <div class="journal-meta-grid">
        ${t.fields.destination ? `
          <input class="input" id="journal-destination" list="journal-dest-list" placeholder="${placeLabel}" value="${escHtml(draft.destination)}">
          <datalist id="journal-dest-list">
            ${destinations.map((d) => `<option value="${escHtml(d)}"></option>`).join('')}
          </datalist>` : ''}
        ${t.fields.tags ? `
          <input class="input" id="journal-tags" placeholder="Tags, comma separated" value="${escHtml(draft.tagsText)}">` : ''}
        ${t.fields.mood ? `
          <div class="journal-mood-field">
            <span class="journal-mood-label">Mood</span>
            <div class="journal-mood-row">
              ${MOODS.map((m) => `
                <label class="journal-mood-chip ${draft.mood === m.value ? 'active' : ''}" title="${m.value}">
                  <input type="radio" name="journal-mood" value="${m.value}" ${draft.mood === m.value ? 'checked' : ''}>
                  <span>${m.emoji}</span>
                </label>
              `).join('')}
            </div>
          </div>` : ''}
      </div>

      <div class="journal-composer-actions">
        <button class="btn btn-primary" id="journal-save" type="button">${editingId ? 'Save' : 'Add to feed'}</button>
        <button class="btn btn-ghost" id="journal-cancel" type="button">Cancel</button>
        <span class="journal-shortcut">⌘↵ to save</span>
      </div>
    </section>
  `;
}

/* ── Render: feed ────────────────────────────────────────────────────────── */

function renderFilters(): string {
  const destinations = [...new Set(entries.map((e) => e.destination).filter(Boolean))];
  if (entries.length === 0) return '';
  return `
    <div class="journal-filter-bar">
      <div class="journal-filter-group">
        <button class="journal-filter-chip ${filter.template === 'all' ? 'active' : ''}" data-filter-template="all" type="button">All</button>
        ${JOURNAL_TEMPLATES.map((t) => `
          <button class="journal-filter-chip ${filter.template === t.id ? 'active' : ''}" style="--tint:${t.tint}" data-filter-template="${t.id}" type="button">
            <span class="journal-filter-emoji">${t.emoji}</span>${escHtml(t.label)}
          </button>
        `).join('')}
        <button class="journal-filter-chip journal-filter-pin ${filter.favoritesOnly ? 'active' : ''}" data-filter-favorites type="button" title="Pinned only">📌</button>
      </div>
      ${destinations.length ? `
        <select class="select input journal-dest-select" data-filter-destination>
          <option value="all" ${filter.destination === 'all' ? 'selected' : ''}>All places</option>
          ${destinations.map((d) => `<option value="${escHtml(d)}" ${filter.destination === d ? 'selected' : ''}>${escHtml(d)}</option>`).join('')}
        </select>` : ''}
    </div>
  `;
}

/** Body block, rendered with the chrome each card format calls for. */
function renderCardFrame(entry: StoredJournalEntry, format: string): string {
  const body = escHtml(excerpt(entry.body));
  const where = escHtml(entry.destination || titleFor(entry));

  if (format === 'postcard') {
    // Right side is the "address/stamp" panel; left side the handwritten note.
    const initials = where.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || 'OTR';
    return `
      <div class="journal-postcard-grid">
        <div class="journal-postcard-msg">${body}</div>
        <div class="journal-postcard-side">
          <div class="journal-postcard-stamp">${initials}</div>
          <div class="journal-postcard-lines"><span></span><span></span><span></span></div>
        </div>
      </div>`;
  }

  if (format === 'ticket') {
    return `
      <div class="journal-ticket-grid">
        <div class="journal-ticket-stub">
          <span class="journal-ticket-stub-label">Note</span>
          <span class="journal-ticket-stub-date">${prettyDate(entry.happenedOn)}</span>
        </div>
        <div class="journal-ticket-body">${body}</div>
      </div>`;
  }

  // polaroid / sticky / post all use a simple framed body; CSS gives texture.
  return `<div class="journal-card-frame"><p class="journal-card-body">${body}</p></div>`;
}

function renderCard(entry: StoredJournalEntry, index: number): string {
  const t = template(entry.template);
  const tilt = [-1.2, 0.9, -0.5, 1.1, 0.4][index % 5];
  const isEditing = entry.id === editingId;
  const isPublic = entry.visibility === 'public';
  const showFoot = t.format !== 'ticket'; // ticket carries its date in the stub

  return `
    <article class="journal-card journal-fmt-${t.format} ${isEditing ? 'is-editing' : ''}"
             data-open-entry="${entry.id}" style="--tint:${t.tint}; --card-tilt:${tilt}deg">
      <div class="journal-card-actions">
        <button class="journal-icon-btn ${isPublic ? 'is-on' : ''}" data-share-entry="${entry.id}" type="button" title="${isPublic ? 'Copy link' : 'Share'}">↗</button>
        <button class="journal-icon-btn ${entry.favorite ? 'is-on' : ''}" data-favorite-entry="${entry.id}" type="button" title="Pin">📌</button>
        <button class="journal-icon-btn" data-delete-entry="${entry.id}" type="button" title="Delete">✕</button>
      </div>

      ${renderCardFrame(entry, t.format)}

      ${showFoot ? `
        <div class="journal-card-foot">
          <span class="journal-card-emoji">${t.emoji}</span>
          <span class="journal-card-where">${escHtml(entry.destination || titleFor(entry))}</span>
          ${entry.mood ? `<span class="journal-card-mood">${moodEmoji(entry.mood)}</span>` : ''}
          <span class="journal-card-date">${prettyDate(entry.happenedOn)}</span>
        </div>` : `
        <div class="journal-card-foot journal-ticket-foot">
          <span class="journal-card-emoji">${t.emoji}</span>
          <span class="journal-card-where">${escHtml(entry.destination || titleFor(entry))}</span>
        </div>`}

      ${entry.tags.length ? `<div class="journal-card-tags">${entry.tags.map((tag) => `<span class="journal-tag">#${escHtml(tag)}</span>`).join('')}</div>` : ''}
    </article>
  `;
}

function renderFeed(): string {
  const rows = visibleEntries();
  if (rows.length === 0) {
    const empty = entries.length === 0
      ? { mark: 'Journal', title: 'Nothing yet', copy: 'Pick a card above and drop one line.' }
      : { mark: 'Filtered', title: 'No matches', copy: 'Try “All” or clear the filters.' };
    return `
      <div class="journal-empty">
        <div class="journal-empty-mark">${empty.mark}</div>
        <div class="journal-empty-title">${empty.title}</div>
        <div class="journal-empty-copy">${empty.copy}</div>
      </div>
    `;
  }
  return `<section class="journal-feed">${rows.map(renderCard).join('')}</section>`;
}

/* ── Bindings ────────────────────────────────────────────────────────────── */

function bindStamps(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('[data-stamp]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openComposer(btn.dataset.stamp as TemplateId);
      promptIndex = 0;
      render();
      document.getElementById('journal-body')?.focus();
    });
  });
}

function bindComposer(root: HTMLElement) {
  root.querySelector('#journal-close-composer')?.addEventListener('click', () => {
    resetDraft();
    render();
  });

  root.querySelector('#journal-shuffle')?.addEventListener('click', () => {
    syncDraftFromDom(root);
    promptIndex += 1;
    render();
    document.getElementById('journal-body')?.focus();
  });

  const save = async () => {
    syncDraftFromDom(root);
    if (!draft.body.trim()) {
      document.getElementById('journal-body')?.focus();
      return;
    }
    const t = template(draft.template);
    // Build without `undefined` fields — Firestore's setDoc rejects undefined
    // values, so an optional field (mood) is omitted entirely when unused.
    const payload: Record<string, unknown> = {
      title: draft.title.trim(),
      body: draft.body.trim(),
      template: draft.template,
      destination: t.fields.destination ? draft.destination.trim() : '',
      tags: t.fields.tags ? parseTags(draft.tagsText) : [],
      happenedOn: draft.happenedOn || new Date().toISOString().slice(0, 10),
    };
    if (t.fields.mood) payload.mood = draft.mood;

    try {
      if (editingId) await journalStore.update(editingId, payload);
      else await journalStore.save({ ...payload, favorite: false, visibility: 'private', slug: '' });
    } catch (error) {
      console.error('Journal save failed:', error);
      toast('Could not save — check your connection');
      return;
    }

    resetDraft();
    render();
  };

  const saveBtn = root.querySelector<HTMLButtonElement>('#journal-save');
  saveBtn?.addEventListener('click', () => void save());
  root.querySelector('#journal-cancel')?.addEventListener('click', () => {
    resetDraft();
    render();
  });

  root.querySelector('#journal-body')?.addEventListener('keydown', (event) => {
    const e = event as KeyboardEvent;
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void save();
    }
  });
}

function bindFilters(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('[data-filter-template]').forEach((btn) => {
    btn.addEventListener('click', () => {
      filter.template = (btn.dataset.filterTemplate as TemplateId | 'all') ?? 'all';
      render();
    });
  });
  root.querySelector('[data-filter-favorites]')?.addEventListener('click', () => {
    filter.favoritesOnly = !filter.favoritesOnly;
    render();
  });
  root.querySelector<HTMLSelectElement>('[data-filter-destination]')?.addEventListener('change', (e) => {
    filter.destination = (e.target as HTMLSelectElement).value;
    render();
  });
}

function bindCards(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('[data-open-entry]').forEach((card) => {
    card.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('[data-share-entry], [data-favorite-entry], [data-delete-entry]')) return;
      loadEntryIntoDraft(card.dataset.openEntry!);
      render();
      document.querySelector('.journal-composer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  root.querySelectorAll<HTMLElement>('[data-favorite-entry]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const entry = entries.find((e) => e.id === btn.dataset.favoriteEntry);
      if (entry) await journalStore.update(entry.id, { favorite: !entry.favorite });
    });
  });

  root.querySelectorAll<HTMLElement>('[data-delete-entry]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.deleteEntry!;
      if (!confirm('Delete this note?')) return;
      if (editingId === id) resetDraft();
      await journalStore.remove(id);
    });
  });

  root.querySelectorAll<HTMLElement>('[data-share-entry]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const entry = entries.find((e) => e.id === btn.dataset.shareEntry);
      if (!entry) return;
      if (entry.visibility === 'public') {
        await copyLink(shareUrl(entry.slug));
        return;
      }
      const slug = entry.slug || slugify(entry);
      await journalStore.update(entry.id, { visibility: 'public', slug });
      await copyLink(shareUrl(slug));
    });
  });
}

async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast('🔗 Link copied');
  } catch {
    toast(url);
  }
}

let toastTimer: number | undefined;
function toast(message: string) {
  let el = document.getElementById('journal-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'journal-toast';
    el.className = 'journal-toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el?.classList.remove('is-visible'), 2200);
}

/* ── Render root ─────────────────────────────────────────────────────────── */

function render() {
  const root = document.getElementById('view-journal');
  const body = root?.querySelector<HTMLElement>('.journal-body');
  if (!root || !body) return;

  body.innerHTML = `
    <div class="journal-shell">
      ${renderStamps()}
      ${composerOpen ? renderComposer() : ''}
      ${renderFilters()}
      ${renderFeed()}
    </div>
  `;

  bindStamps(root);
  if (composerOpen) bindComposer(root);
  bindFilters(root);
  bindCards(root);
}

export function initJournal() {
  journalStore.subscribe((rows) => {
    entries = rows;
    render();
  });
  routeStore.subscribe((rows) => {
    legs = rows;
    if (!editingId && !composerOpen && !draft.destination) draft.destination = currentCity();
    render();
  });
}
