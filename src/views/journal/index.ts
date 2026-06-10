import './journal.css';
import { journalStore, type StoredJournalEntry } from '../../data/stores/journal-store.ts';
import { journalStoryStore, type StoredJournalStory } from '../../data/stores/journal-story-store.ts';
import { journalTemplateStore } from '../../data/stores/journal-template-store.ts';
import { routeStore, type StoredLeg } from '../../data/stores/route-store.ts';
import { createCaptureController } from './capture/capture.ts';
import { createStoryController } from './story/story.ts';
import { setCustomTemplates } from './templates.ts';

type JournalMode = 'capture' | 'story';

let mode: JournalMode = 'capture';
// 'trip' = this trip's entries; 'all' = every trip's memories (calendar scroll).
let entryScope: 'trip' | 'all' = 'trip';
let entries: StoredJournalEntry[] = [];
let stories: StoredJournalStory[] = [];
let legs: StoredLeg[] = [];

let _unsubEntries: (() => void) | null = null;
let _unsubLegs: (() => void) | null = null;
let _unsubStories: (() => void) | null = null;
let _unsubTemplates: (() => void) | null = null;

const capture = createCaptureController({
  getEntries: () => entries,
  getLegs: () => legs,
  requestRender: renderJournal,
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
    renderJournal();
  });
}

function subtitleFor(currentMode: JournalMode) {
  if (currentMode === 'story') {
    return 'AI recap mode turns scattered moments into a shareable reflection page.';
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

function renderJournal() {
  const root = document.getElementById('view-journal');
  const body = root?.querySelector<HTMLElement>('.journal-body');
  if (!root || !body) return;

  const captureHtml = mode === 'capture' ? capture.render() : '';
  const storyHtml   = mode === 'story'   ? story.render()   : '';

  body.innerHTML = `
    <div class="journal-mode-shell">
      <div class="journal-topbar">
        <div class="journal-topbar-left">
          <span class="journal-topbar-title${mode === 'story' ? ' is-story' : ''}">
            ${mode === 'story' ? '📖 Story' : 'Capture'}
          </span>
          ${mode === 'capture' ? `
            <div class="journal-scope">
              <button class="journal-scope-btn ${entryScope === 'trip' ? 'active' : ''}" data-journal-scope="trip" type="button">This trip</button>
              <button class="journal-scope-btn ${entryScope === 'all' ? 'active' : ''}" data-journal-scope="all" type="button">All</button>
            </div>
          ` : ''}
        </div>
        <div class="journal-topbar-right">
          ${mode === 'capture' ? `
            <div class="journal-layout-bar">
              ${(['feed','places','categories','gallery','map','calendar'] as const).map((id) => `
                <button class="journal-layout-tab ${capture.currentView() === id ? 'active' : ''}" data-journal-view="${id}" type="button">${id.charAt(0).toUpperCase() + id.slice(1)}</button>
              `).join('')}
            </div>
          ` : ''}
          <button class="btn journal-story-btn ${mode === 'story' ? 'btn-primary' : 'btn-ghost'}" data-journal-mode="${mode === 'story' ? 'capture' : 'story'}" type="button">
            ${mode === 'story' ? '← Entries' : '📖 Story'}
          </button>
        </div>
      </div>
      ${captureHtml}${storyHtml}
    </div>
  `;

  bindModeSwitch(root);
  bindScopeSwitch(root);
  if (mode === 'capture') {
    capture.bind(root);
    capture.afterRender(root);
  } else {
    story.bind(root);
  }
  updateSubtitle();
}

/**
 * Open the journal capture composer for a specific template, navigating to
 * the journal view if needed. Called from the dashboard quick-entry buttons.
 */
export function openJournalComposerForTemplate(templateId: string): void {
  // Switch to capture mode in case story mode is active
  mode = 'capture';
  capture.openComposerForTemplate(templateId);
  // Render so the composer appears immediately when the view is shown
  renderJournal();
}

/**
 * Open the full journal composer as a floating overlay on top of any view
 * (e.g. dashboard), without navigating away. Uses a dedicated capture
 * controller instance so it doesn't interfere with the main journal view.
 */
export function openJournalComposerOverlay(templateId: string): void {
  // Remove any existing overlay first (idempotent).
  document.getElementById('jco-overlay-root')?.remove();

  const overlayEntries = journalStore.peek();
  const overlayLegs    = routeStore.peek();

  let overlayEl: HTMLElement | null = null;

  const overlayCapture = createCaptureController({
    getEntries: () => overlayEntries,
    getLegs:    () => overlayLegs,
    requestRender: renderOverlay,
  });

  function renderOverlay() {
    if (!overlayEl) return;
    const tmp = document.createElement('div');
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

  overlayCapture.openComposerForTemplate(templateId);
  const html = overlayCapture.render();

  // Extract the overlay+drawer HTML from the full capture render
  const tmp = document.createElement('div');
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
  _unsubTemplates?.();
  entries = []; legs = []; stories = [];

  subscribeEntries(); // honours the current entryScope

  _unsubLegs = routeStore.subscribe((rows) => {
    legs = rows;
    capture.handleDataChange();
    story.handleDataChange();
    renderJournal();
  });

  _unsubStories = journalStoryStore.subscribe((rows) => {
    stories = rows;
    story.handleDataChange();
    renderJournal();
  });

  _unsubTemplates = journalTemplateStore.subscribe((rows) => {
    setCustomTemplates(rows);
    capture.handleDataChange();
    renderJournal();
  });
}
