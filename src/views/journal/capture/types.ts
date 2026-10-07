import type { TemplateId } from '../templates.ts';
import type { TidySuggestions } from '../ai-classify.ts';

export type CaptureView = 'feed' | 'places' | 'albums' | 'gallery' | 'map' | 'calendar';

export interface CaptureFilter {
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

export interface CaptureState {
  view: CaptureView;
  filter: CaptureFilter;
  draft: DraftState;
  composerOpen: boolean;
  /** L3 of the composer — title / tags / mood / linked places, collapsed by default. */
  moreOpen: boolean;
  /** L2 of the composer — false shows the place+date summary line, true its controls. */
  metaEditing: boolean;
  editingId: string | null;
  /** Entry shown in the read-only reader overlay, or null when it's closed.
   *  Tapping a feed/gallery/calendar card opens this, NOT the composer —
   *  editing is a separate action reached from inside the reader. */
  readingId: string | null;
  calendarMonth: string;
  gallerySquare: boolean;
  /** Gallery multi-select: null = off, otherwise the picked entry ids. */
  selection: string[] | null;
  /** Album whose contents are being viewed, or null for the album grid. */
  openAlbumId: string | null;
  /** AI tidy pass: suggestions awaiting the user's yes/no, plus its in-flight flag. */
  tidy: TidySuggestions | null;
  tidyLoading: boolean;
}
