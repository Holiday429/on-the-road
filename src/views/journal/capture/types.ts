import type { TemplateId } from '../templates.ts';
import type { TidySuggestions } from '../ai-classify.ts';
import type { JournalAlbumCover } from '../../../data/schema.ts';

/** Places and Map are one view: the map, the line of places and their entries. */
export type CaptureView = 'feed' | 'places' | 'albums' | 'gallery' | 'calendar';

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
  /** width / height of each photo, index-aligned with `images`; undefined = not measured yet. */
  imageRatios: (number | undefined)[];
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
  /** Which way the reader last turned a page, so the spread animates from that edge. */
  readerTurn: '' | 'next' | 'prev';
  calendarMonth: string;
  gallerySquare: boolean;
  /** Whether the gallery wall is drifting by itself. */
  galleryDrift: boolean;
  /** The place picked on the Places line / map (a stop key), or null for the latest. */
  placeKey: string | null;
  /** Flips on every pick so the cards are dealt again. */
  placeFlip: boolean;
  /** Which spread of the open album is showing, and how it was reached. */
  albumSpread: number;
  albumTurn: boolean;
  albumDir: '' | 'next' | 'prev';
  /** True just after an album is opened, so its cover swings open once. */
  albumOpening: boolean;
  /** Gallery multi-select: null = off, otherwise the picked entry ids. */
  selection: string[] | null;
  /** Album whose contents are being viewed, or null for the album grid. */
  openAlbumId: string | null;
  /** The cover being designed: the album's id and the unsaved draft, or null when closed. */
  coverEdit: { albumId: string; draft: JournalAlbumCover } | null;
  /** AI tidy pass: suggestions awaiting the user's yes/no, plus its in-flight flag. */
  tidy: TidySuggestions | null;
  tidyLoading: boolean;
}
