import './journal.css';
import { morphInto } from '../../core/utils.ts';
import { t } from '../../core/i18n.ts';
import { escHtml as esc } from './shared/utils.ts';
import { MIN_ENTRIES_FOR_PORTRAIT } from './recap/generator.ts';
import { journalStore, type StoredJournalEntry } from '../../data/stores/journal-store.ts';
import { journalStoryStore, type StoredJournalStory } from '../../data/stores/journal-story-store.ts';
import { journalAlbumStore, type StoredJournalAlbum } from '../../data/stores/journal-album-store.ts';
import { travelerRecapStore, type StoredTravelerRecap } from '../../data/stores/traveler-recap-store.ts';
import { routeStore, type StoredLeg } from '../../data/stores/route-store.ts';
import { createCaptureController } from './capture/capture.ts';
import { createStoryController } from './story/story.ts';
import { createRecapController } from './recap/recap.ts';

type JournalMode = 'capture' | 'story' | 'recap';

let mode: JournalMode = 'capture';
// 'trip' = this trip's entries; 'all' = every trip's memories (calendar scroll).
let entryScope: 'trip' | 'all' = 'trip';
let entries: StoredJournalEntry[] = [];
let stories: StoredJournalStory[] = [];
let albums: StoredJournalAlbum[] = [];
let recaps: StoredTravelerRecap[] = [];
let legs: StoredLeg[] = [];

let _unsubEntries: (() => void) | null = null;
let _unsubLegs: (() => void) | null = null;
let _unsubStories: (() => void) | null = null;
let _unsubAlbums: (() => void) | null = null;
let _unsubRecaps: (() => void) | null = null;

const capture = createCaptureController({
  getEntries: () => entries,
  getLegs: () => legs,
  getAlbums: () => albums,
  requestRender: renderJournal,
});

const recap = createRecapController({
  getEntries: () => entries,
  getRecaps: () => recaps,
  requestRender: renderJournal,
  // A chapter's evidence chip jumps to the entry it was drawn from, which is
  // the one path that turns a claim about the reader back into their own words.
  openEntry: (id) => {
    mode = 'capture';
    capture.openEntry(id);
  },
});

const story = createStoryController({
  getEntries: () => entries,
  getLegs: () => legs,
  getStories: () => stories,
  requestRender: renderJournal,
});

/** (Re)subscribe entries for the active scope (this trip vs all memories). */
function subscribeEntries() {
  _unsubEntries?.();
  const subscribe = entryScope === 'all' ? journalStore.subscribeAll : journalStore.subscribe;
  _unsubEntries = subscribe((rows) => {
    entries = rows;
    capture.handleDataChange();
    story.handleDataChange();
    recap.handleDataChange();
    renderJournal();
  });
}

function subtitleFor(currentMode: JournalMode) {
  if (currentMode === 'story') {
    return 'AI recap mode turns scattered moments into a shareable reflection page.';
  }
  if (currentMode === 'recap') {
    return 'A portrait of how you travel — what you notice, and what you do when a day goes wrong.';
  }
  return 'Quick travel notes, feelings, and little moments you want to keep before they blur together.';
}

function bindModeSwitch(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('[data-journal-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextMode = (button.dataset.journalMode as JournalMode) ?? 'capture';
      if (mode === nextMode) return;
      mode = nextMode;
      renderJournal();
    });
  });
}

function bindScopeSwitch(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('[data-journal-scope]').forEach((button) => {
    button.addEventListener('click', () => {
      const next = (button.dataset.journalScope as 'trip' | 'all') ?? 'trip';
      if (entryScope === next) return;
      entryScope = next;
      subscribeEntries(); // re-subscribe; will repaint via its callback
    });
  });
}

function updateSubtitle() {
  const subtitle = document.querySelector<HTMLElement>('#view-journal .view-subtitle');
  if (subtitle) subtitle.textContent = subtitleFor(mode);
}

const VIEWS = ['feed', 'places', 'albums', 'gallery', 'calendar'] as const;

/**
 * The journal's one bar of chrome: the view tabs on the left, then the scope
 * toggle, Portrait, the overflow menu and the new-entry button on the right.
 *
 * It replaced three stacked rows (mode title + tabs, a full-width compose
 * button with the export pair, and a tag/place filter strip), which together
 * pushed the first entry most of a screen down the page.
 */
function renderToolbar(): string {
  const enough = entries.length >= MIN_ENTRIES_FOR_PORTRAIT;
  const short = MIN_ENTRIES_FOR_PORTRAIT - entries.length;
  return `
    <div class="journal-topbar">
      <div class="journal-layout-bar">
        ${VIEWS.map((id) => `
          <button class="journal-layout-tab ${capture.currentView() === id ? 'active' : ''}" data-journal-view="${id}" type="button">${esc(t(`journal.view.${id}`))}</button>
        `).join('')}
      </div>
      <div class="journal-topbar-right">
        <div class="journal-scope journal-tool-group">
          <button class="journal-scope-btn ${entryScope === 'trip' ? 'active' : ''}" data-journal-scope="trip" type="button">${esc(t('journal.scope.trip'))}</button>
          <button class="journal-scope-btn ${entryScope === 'all' ? 'active' : ''}" data-journal-scope="all" type="button">${esc(t('journal.scope.all'))}</button>
        </div>
        <button class="journal-tool-btn" data-journal-mode="recap" type="button" aria-label="${esc(t('journal.mode.portrait'))}" title="${esc(t('journal.mode.portrait'))}"
          ${enough ? '' : `disabled title="${esc(t('journal.portrait.need', { n: short }))}"`}>🃏<span class="jt-label"> ${esc(t('journal.mode.portrait'))}</span></button>
        <details class="journal-menu">
          <summary class="journal-tool-btn journal-menu-toggle" aria-label="${esc(t('journal.export'))}" title="${esc(t('journal.export.hint'))}">⬇<span class="jt-label"> ${esc(t('journal.export'))}</span></summary>
          <div class="journal-menu-sheet">
            <span class="journal-menu-hint">${esc(t('journal.export.hint'))}</span>
            <button class="journal-menu-item" data-journal-export="md" type="button">Markdown</button>
            <button class="journal-menu-item" data-journal-export="json" type="button">JSON</button>
          </div>
        </details>
        <button class="journal-new-btn" data-journal-new type="button" title="${esc(t('journal.new'))}" aria-label="${esc(t('journal.new'))}">✍️<span class="jt-label"> ${esc(t('journal.new'))}</span></button>
      </div>
    </div>
  `;
}

function renderJournal() {
  const root = document.getElementById('view-journal');
  const body = root?.querySelector<HTMLElement>('.journal-body');
  if (!root || !body) return;

  const captureHtml = mode === 'capture' ? capture.render() : '';
  const storyHtml   = mode === 'story'   ? story.render()   : '';
  const recapHtml   = mode === 'recap'   ? recap.render()   : '';

  const html = `
    <div class="journal-mode-shell">
      ${mode === 'capture' ? renderToolbar() : `
        <div class="journal-topbar">
          <span class="journal-topbar-title is-story">${mode === 'recap' ? `🃏 ${esc(t('journal.mode.portrait'))}` : `📖 ${esc(t('journal.mode.story'))}`}</span>
          ${mode === 'recap' ? recap.actionsHtml() : ''}
          <button class="btn journal-story-btn btn-ghost" data-journal-mode="capture" type="button">← ${esc(t('journal.mode.entries'))}</button>
        </div>
      `}
      ${captureHtml}${storyHtml}${recapHtml}
    </div>
  `;
  morphInto(body, html);

  bindModeSwitch(root);
  bindScopeSwitch(root);
  if (mode === 'capture') {
    capture.bind(root);
    capture.afterRender(root);
  } else {
    capture.dispose();   // the places map and the gallery drift belong to the capture views only
    if (mode === 'recap') recap.bind(root);
    else story.bind(root);
  }
  updateSubtitle();
}

/**
 * Open the journal composer, navigating to the journal view if needed.
 * Called from the dashboard's single quick-entry button.
 */
export function openJournalComposer(): void {
  // Switch to capture mode in case story or portrait mode is active
  mode = 'capture';
  capture.openComposer();
  // Render so the composer appears immediately when the view is shown
  renderJournal();
}

/**
 * Open the full journal composer as a floating overlay on top of any view
 * (e.g. dashboard), without navigating away. Uses a dedicated capture
 * controller instance so it doesn't interfere with the main journal view.
 */
export function openJournalComposerOverlay(): void {
  // Remove any existing overlay first (idempotent).
  document.getElementById('jco-overlay-root')?.remove();

  const overlayEntries = journalStore.peek();
  const overlayLegs    = routeStore.peek();
  const overlayAlbums  = journalAlbumStore.peek();

  let overlayEl: HTMLElement | null = null;

  const overlayCapture = createCaptureController({
    getEntries: () => overlayEntries,
    getLegs:    () => overlayLegs,
    getAlbums:  () => overlayAlbums,
    requestRender: renderOverlay,
  });

  function renderOverlay() {
    if (!overlayEl) return;
    // The envelope is mid-flight; swapping the node would throw the animation away.
    if (overlayCapture.isPosting()) return;
    const tmp = document.createElement('div');
    // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N10)
    tmp.innerHTML = overlayCapture.render();
    const freshOverlay = tmp.querySelector<HTMLElement>('.journal-composer-overlay');
    if (!freshOverlay) {
      // composerOpen became false (save / cancel / close) — tear down
      overlayEl.remove();
      overlayEl = null;
      return;
    }
    // Swap the overlay node in-place to update prompt / state changes
    overlayEl.querySelector('.journal-composer-overlay')?.replaceWith(freshOverlay);
    overlayCapture.bind(overlayEl);
  }

  // Build the overlay wrapper
  overlayEl = document.createElement('div');
  overlayEl.id = 'jco-overlay-root';

  overlayCapture.openComposer();
  const html = overlayCapture.render();

  // Extract the overlay+drawer HTML from the full capture render
  const tmp = document.createElement('div');
  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N10)
  tmp.innerHTML = html;
  const overlayNode = tmp.querySelector<HTMLElement>('.journal-composer-overlay');
  if (!overlayNode) return; // composerOpen was false — nothing to show

  overlayEl.appendChild(overlayNode);
  document.body.appendChild(overlayEl);
  overlayCapture.bind(overlayEl);

  // Focus the textarea
  overlayEl.querySelector<HTMLElement>('#journal-body')?.focus();
}

export function initJournal() {
  // Idempotent: re-runs on trip switch, re-subscribing under the new tripId.
  _unsubEntries?.();
  _unsubLegs?.();
  _unsubStories?.();
  _unsubAlbums?.();
  _unsubRecaps?.();
  entries = []; legs = []; stories = []; albums = []; recaps = [];

  subscribeEntries(); // honours the current entryScope

  _unsubLegs = routeStore.subscribe((rows) => {
    legs = rows;
    capture.handleDataChange();
    story.handleDataChange();
    renderJournal();
  });

  _unsubRecaps = travelerRecapStore.subscribe((rows) => {
    recaps = rows;
    recap.handleDataChange();
    renderJournal();
  });

  _unsubStories = journalStoryStore.subscribe((rows) => {
    stories = rows;
    story.handleDataChange();
    renderJournal();
  });

  _unsubAlbums = journalAlbumStore.subscribe((rows) => {
    albums = rows;
    capture.handleDataChange();
    renderJournal();
  });
}
