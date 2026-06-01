import './journal.css';
import { journalStore, type StoredJournalEntry } from '../../data/stores/journal-store.ts';
import { journalStoryStore, type StoredJournalStory } from '../../data/stores/journal-story-store.ts';
import { journalTemplateStore } from '../../data/stores/journal-template-store.ts';
import { routeStore, type StoredLeg } from '../../data/stores/route-store.ts';
import { createCaptureController } from './capture/capture.ts';
import { createStoryController } from './story/story.ts';
import { setCustomTemplates } from './templates.ts';

type JournalMode = 'capture' | 'story';

let initialized = false;
let mode: JournalMode = 'capture';
let entries: StoredJournalEntry[] = [];
let stories: StoredJournalStory[] = [];
let legs: StoredLeg[] = [];

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

function updateSubtitle() {
  const subtitle = document.querySelector<HTMLElement>('#view-journal .view-subtitle');
  if (subtitle) subtitle.textContent = subtitleFor(mode);
}

function renderJournal() {
  const root = document.getElementById('view-journal');
  const body = root?.querySelector<HTMLElement>('.journal-body');
  if (!root || !body) return;

  body.innerHTML = `
    <div class="journal-mode-shell">
      <div class="journal-mode-tabs">
        <button class="journal-mode-tab ${mode === 'capture' ? 'active' : ''}" data-journal-mode="capture" type="button">Capture</button>
        <button class="journal-mode-tab ${mode === 'story' ? 'active' : ''}" data-journal-mode="story" type="button">Story</button>
      </div>
      ${mode === 'capture' ? capture.render() : story.render()}
    </div>
  `;

  bindModeSwitch(root);
  if (mode === 'capture') {
    capture.bind(root);
    capture.afterRender(root);
  } else {
    story.bind(root);
  }
  updateSubtitle();
}

export function initJournal() {
  if (initialized) {
    renderJournal();
    return;
  }
  initialized = true;

  journalStore.subscribe((rows) => {
    entries = rows;
    capture.handleDataChange();
    renderJournal();
  });

  routeStore.subscribe((rows) => {
    legs = rows;
    capture.handleDataChange();
    story.handleDataChange();
    renderJournal();
  });

  journalStoryStore.subscribe((rows) => {
    stories = rows;
    story.handleDataChange();
    renderJournal();
  });

  journalTemplateStore.subscribe((rows) => {
    setCustomTemplates(rows);
    capture.handleDataChange();
    renderJournal();
  });
}
