import { journalStoryStore, type StoredJournalStory } from '../../../data/stores/journal-story-store.ts';
import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import type { StoredLeg } from '../../../data/stores/route-store.ts';
import { generateStoryDraft } from './generator.ts';
import { renderStory } from './render.ts';
import type { StoryUiState } from './types.ts';
import { handleAiError } from '../../../core/paywall.ts';

interface StoryControllerDeps {
  getEntries: () => StoredJournalEntry[];
  getLegs: () => StoredLeg[];
  getStories: () => StoredJournalStory[];
  requestRender: () => void;
}

export function createStoryController(deps: StoryControllerDeps) {
  const ui: StoryUiState = {
    activeStoryId: null,
    generating: false,
    saving: false,
    error: '',
  };

  function render() {
    const stories = sortedStories();
    const activeStory = stories.find((story) => story.id === ui.activeStoryId) ?? stories[0] ?? null;
    if (activeStory && ui.activeStoryId !== activeStory.id) ui.activeStoryId = activeStory.id;

    return renderStory({
      entries: deps.getEntries(),
      stories,
      activeStory,
      ui,
    });
  }

  function bind(root: HTMLElement) {
    const shell = root.querySelector<HTMLElement>('.journal-story-shell');
    if (!shell) return;

    shell.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;

      const generateBtn = target.closest<HTMLElement>('[data-story-generate]');
      if (generateBtn) {
        void generate();
        return;
      }

      const regenerateBtn = target.closest<HTMLElement>('[data-story-regenerate]');
      if (regenerateBtn) {
        void regenerate();
        return;
      }

      const saveBtn = target.closest<HTMLElement>('[data-story-save]');
      if (saveBtn) {
        void saveAnswers(shell);
        return;
      }

      const selectBtn = target.closest<HTMLElement>('[data-story-select]');
      if (selectBtn) {
        ui.activeStoryId = selectBtn.dataset.storySelect ?? null;
        deps.requestRender();
        return;
      }

      const toggleBtn = target.closest<HTMLElement>('[data-story-toggle-status]');
      if (toggleBtn) {
        void toggleStatus();
      }
    });
  }

  function handleDataChange() {
    const stories = sortedStories();
    if (ui.activeStoryId && !stories.some((story) => story.id === ui.activeStoryId)) {
      ui.activeStoryId = stories[0]?.id ?? null;
    }
  }

  return {
    render,
    bind,
    handleDataChange,
  };

  async function generate() {
    if (ui.generating) return;
    ui.error = '';
    ui.generating = true;
    deps.requestRender();

    try {
      const draft = await generateStoryDraft(deps.getEntries(), deps.getLegs());
      const id = await journalStoryStore.save({
        ...draft,
        status: 'draft',
        visibility: 'private',
        slug: '',
      });
      ui.activeStoryId = id;
    } catch (error) {
      if (handleAiError(error)) { ui.generating = false; deps.requestRender(); return; }
      console.error('Story generation failed:', error);
      ui.error = 'Could not generate a recap right now.';
    } finally {
      ui.generating = false;
      deps.requestRender();
    }
  }

  async function regenerate() {
    const story = activeStory();
    if (!story || ui.generating) return;
    ui.error = '';
    ui.generating = true;
    deps.requestRender();

    try {
      const draft = await generateStoryDraft(deps.getEntries(), deps.getLegs());
      const answersByPrompt = new Map(story.questions.map((question) => [question.prompt, question.answer]));
      await journalStoryStore.update(story.id, {
        ...draft,
        questions: draft.questions.map((question) => ({
          ...question,
          answer: answersByPrompt.get(question.prompt) ?? '',
        })),
      });
    } catch (error) {
      console.error('Story regeneration failed:', error);
      ui.error = 'Could not refresh the recap.';
    } finally {
      ui.generating = false;
      deps.requestRender();
    }
  }

  async function saveAnswers(root: HTMLElement) {
    const story = activeStory();
    if (!story || ui.saving) return;
    ui.error = '';
    ui.saving = true;
    deps.requestRender();

    try {
      const questions = story.questions.map((question) => {
        const field = root.querySelector<HTMLTextAreaElement>(`[data-story-answer="${question.id}"]`);
        return { ...question, answer: field?.value.trim() ?? question.answer };
      });
      await journalStoryStore.update(story.id, { questions });
    } catch (error) {
      console.error('Story save failed:', error);
      ui.error = 'Could not save your answers.';
    } finally {
      ui.saving = false;
      deps.requestRender();
    }
  }

  async function toggleStatus() {
    const story = activeStory();
    if (!story) return;
    await journalStoryStore.update(story.id, {
      status: story.status === 'published' ? 'draft' : 'published',
    });
  }

  function activeStory() {
    return sortedStories().find((story) => story.id === ui.activeStoryId) ?? sortedStories()[0] ?? null;
  }

  function sortedStories() {
    return [...deps.getStories()].sort((a, b) => b.updatedAt - a.updatedAt);
  }
}
