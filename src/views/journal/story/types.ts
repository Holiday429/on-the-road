import type { JournalStoryModule, JournalStoryQuestion } from '../../../data/schema.ts';

export interface GeneratedStoryDraft {
  title: string;
  subtitle: string;
  recapLine: string;
  travelerMode: string;
  scopeLabel: string;
  entryIds: string[];
  modules: JournalStoryModule[];
  questions: JournalStoryQuestion[];
}

export interface StoryUiState {
  activeStoryId: string | null;
  generating: boolean;
  saving: boolean;
  error: string;
}
