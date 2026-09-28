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
  // Photos being composed, in display order (max MAX_JOURNAL_IMAGES). Local
  // files are uploaded to Storage on save; `images` holds already-uploaded
  // remote URLs (an entry loaded for editing) plus object-URL previews for
  // files picked in this session, kept index-aligned with `pendingFiles`.
  images: string[];
  /** null at an index = already-uploaded URL; a File = needs uploading on save. */
  pendingFiles: (File | null)[];
  imageRatio: number | undefined;
  uploading: boolean;
  linkedPlaces: string[];
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
