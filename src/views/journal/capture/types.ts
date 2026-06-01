import type { JournalTemplateKind, TemplateId } from '../templates.ts';

export type CaptureView = 'feed' | 'places' | 'categories' | 'gallery' | 'map' | 'calendar';

export interface CaptureFilter {
  template: TemplateId | 'all';
  destination: string;
  tag: string;
  favoritesOnly: boolean;
}

export interface DraftState {
  body: string;
  title: string;
  template: TemplateId;
  destination: string;
  tagsText: string;
  mood: string;
  happenedOn: string;
  coverImage: string;
  imageRatio: number | undefined;
}

export interface TemplateBuilderState {
  kind: JournalTemplateKind;
  label: string;
  emoji: string;
  placeholder: string;
  promptsText: string;
}

export interface CaptureState {
  view: CaptureView;
  filter: CaptureFilter;
  draft: DraftState;
  templateBuilder: TemplateBuilderState;
  composerOpen: boolean;
  templateBuilderOpen: boolean;
  editingId: string | null;
  promptIndex: number;
  calendarMonth: string;
  gallerySquare: boolean;
}
