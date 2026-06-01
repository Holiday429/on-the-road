import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import type { StoredJournalStory } from '../../../data/stores/journal-story-store.ts';
import { escHtml, excerpt, titleFor } from '../shared/utils.ts';
import type { StoryUiState } from './types.ts';

interface StoryRenderModel {
  entries: StoredJournalEntry[];
  stories: StoredJournalStory[];
  activeStory: StoredJournalStory | null;
  ui: StoryUiState;
}

export function renderStory(model: StoryRenderModel): string {
  const captureCount = model.entries.length;
  const active = model.activeStory;

  return `
    <div class="journal-story-shell">
      <section class="card journal-story-hero">
        <div>
          <span class="journal-section-kicker">AI Travel Recap</span>
          <h3>Story turns capture into a themed recap, not a diary.</h3>
          <p>Generate a draft from your saved fragments, answer a few prompts, and keep refining a recap that feels closer to an annual review than a day-by-day write-up.</p>
        </div>
        <div class="journal-story-stats">
          <div class="journal-story-stat">
            <span class="journal-story-stat-num">${captureCount}</span>
            <span class="journal-story-stat-label">capture entries</span>
          </div>
          <div class="journal-story-stat">
            <span class="journal-story-stat-num">${model.stories.length}</span>
            <span class="journal-story-stat-label">story drafts</span>
          </div>
          <div class="journal-story-stat">
            <span class="journal-story-stat-num">${active?.questions.length ?? 0}</span>
            <span class="journal-story-stat-label">reflection prompts</span>
          </div>
        </div>
      </section>

      <div class="journal-story-toolbar">
        <button class="btn btn-primary" data-story-generate type="button" ${captureCount ? '' : 'disabled'}>${model.ui.generating ? 'Generating…' : 'Generate recap'}</button>
        ${active ? `<button class="btn btn-ghost" data-story-regenerate type="button" ${model.ui.generating ? 'disabled' : ''}>Refresh from capture</button>` : ''}
        ${active ? `<button class="btn btn-ghost" data-story-save type="button" ${model.ui.saving ? 'disabled' : ''}>${model.ui.saving ? 'Saving…' : 'Save answers'}</button>` : ''}
        ${active ? `<button class="btn btn-ghost" data-story-toggle-status type="button">${active.status === 'published' ? 'Mark draft' : 'Mark ready'}</button>` : ''}
      </div>

      ${model.ui.error ? `<div class="journal-story-error">${escHtml(model.ui.error)}</div>` : ''}

      <div class="journal-story-workspace">
        <aside class="journal-story-sidebar">
          <div class="journal-story-sidebar-head">
            <div class="journal-subsection-title">Drafts</div>
            <span>${model.stories.length ? `${model.stories.length} saved` : 'none yet'}</span>
          </div>
          <div class="journal-story-list">
            ${model.stories.length ? model.stories.map((story) => `
              <button class="journal-story-list-item ${story.id === model.ui.activeStoryId ? 'active' : ''}" data-story-select="${story.id}" type="button">
                <span class="journal-story-list-title">${escHtml(story.title)}</span>
                <span class="journal-story-list-meta">${escHtml(story.travelerMode || 'Story draft')} · ${story.modules.length} cards</span>
              </button>
            `).join('') : `
              <div class="journal-story-empty-list">No recap yet. Generate one from capture when you have enough material.</div>
            `}
          </div>
        </aside>

        <div class="journal-story-main">
          ${active ? renderActiveStory(active, model.entries) : renderEmptyState(captureCount)}
        </div>
      </div>
    </div>
  `;
}

function renderActiveStory(story: StoredJournalStory, entries: StoredJournalEntry[]) {
  const entryMap = new Map(entries.map((entry) => [entry.id, entry]));
  return `
    <section class="card journal-story-summary">
      <div class="journal-story-summary-head">
        <div>
          <span class="journal-section-kicker">${escHtml(story.scopeLabel || 'Whole trip')}</span>
          <h4>${escHtml(story.title)}</h4>
          <p>${escHtml(story.subtitle)}</p>
        </div>
        <div class="journal-story-summary-badges">
          <span class="badge badge-amber">${escHtml(story.travelerMode || 'Recap')}</span>
          <span class="badge badge-gray">${story.status}</span>
        </div>
      </div>
      <div class="journal-story-line">${escHtml(story.recapLine)}</div>
    </section>

    <div class="journal-story-panels">
      <section class="card journal-story-panel">
        <div class="journal-story-panel-head">
          <div class="journal-subsection-title">Reflection prompts</div>
          <span>${story.questions.length} prompts</span>
        </div>
        <div class="journal-story-question-list">
          ${story.questions.map((question, index) => {
            const source = question.entryId ? entryMap.get(question.entryId) : null;
            return `
              <div class="journal-story-question-card">
                <div class="journal-story-question-num">Q${index + 1}</div>
                <div class="journal-story-question-prompt">${escHtml(question.prompt)}</div>
                ${source ? `
                  <div class="journal-story-question-source">
                    <span class="journal-story-source-label">From capture</span>
                    <strong>${escHtml(titleFor(source))}</strong>
                    <span>${escHtml(excerpt(source.body, 88))}</span>
                  </div>
                ` : ''}
                <textarea class="journal-story-answer input" data-story-answer="${question.id}" placeholder="Write one or two honest lines.">${escHtml(question.answer)}</textarea>
              </div>
            `;
          }).join('')}
        </div>
      </section>

      <section class="card journal-story-panel">
        <div class="journal-story-panel-head">
          <div class="journal-subsection-title">Preview cards</div>
          <span>${story.modules.length} cards</span>
        </div>
        <div class="journal-story-module-grid">
          ${story.modules.map((module) => `
            <article class="journal-story-module-card">
              <div class="journal-story-module-title">${escHtml(module.title)}</div>
              <p>${escHtml(module.summary)}</p>
              ${module.entryIds.length ? `
                <div class="journal-story-module-sources">
                  ${module.entryIds
                    .map((entryId) => entryMap.get(entryId))
                    .filter(Boolean)
                    .slice(0, 3)
                    .map((entry) => `<span class="journal-story-source-chip">${escHtml(titleFor(entry!))}</span>`)
                    .join('')}
                </div>
              ` : ''}
            </article>
          `).join('')}
        </div>
      </section>
    </div>
  `;
}

function renderEmptyState(captureCount: number) {
  if (!captureCount) {
    return `
      <div class="journal-empty">
        <div class="journal-empty-mark">Story</div>
        <div class="journal-empty-title">Capture needs source material first</div>
        <div class="journal-empty-copy">Add a few moments, interesting notes, or place cards, then come back to generate a recap.</div>
      </div>
    `;
  }

  return `
    <div class="journal-empty">
      <div class="journal-empty-mark">Story</div>
      <div class="journal-empty-title">Generate your first recap</div>
      <div class="journal-empty-copy">Story will pull the strongest fragments from capture, cluster them into a few themed cards, and ask follow-up questions instead of asking for a full travel essay.</div>
    </div>
  `;
}
