import { journalStore, type StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import { journalAlbumStore, type StoredJournalAlbum } from '../../../data/stores/journal-album-store.ts';
import { cityStore } from '../../../data/stores/city-store.ts';
import type { GuideCard } from '../../../data/schema.ts';
import type { StoredLeg } from '../../../data/stores/route-store.ts';
import { buildStops } from '../scenes/places-model.ts';
import { syncPlacesMap, disposePlacesMap } from '../scenes/places-map.ts';
import { syncGalleryFlow, stopGalleryFlow } from '../scenes/gallery-flow.ts';
import { coverDraftFor } from '../scenes/album-cover-edit.ts';
import { albumEntries, coverArtOf, magazineEntries } from '../scenes/albums.ts';
import { currentMode, renderMagazine, syncMagazineView } from '../scenes/magazine.ts';
import { beginFlip, dragDirection, shouldCommit, turnProgress, type Flip, type FlipDir } from '../scenes/magazine-flip.ts';
import { bookIsLoading, cachedBook, loadBook } from '../scenes/magazine-measure.ts';
import { turnTo } from '../scenes/magazine-model.ts';
import { renderCover } from '../scenes/album-cover.ts';
import type { JournalAlbumCover } from '../../../data/schema.ts';
import { currentTrip } from '../../../data/trip-context.ts';
import {
  DEFAULT_TEMPLATE,
  normalizeTemplateId,
  templates,
  template,
  type TemplateId,
} from '../templates.ts';
import { inferTemplate } from '../classify.ts';
import { exportEntries } from '../export.ts';
import { suggestTidy, type AlbumSuggestion } from '../ai-classify.ts';
import { magazineCountries, renderCapture, type CalendarCell, type TagGroup } from './render.ts';
import { openCardPreview } from '../card/card-preview.ts';
import type { CaptureState, DraftState } from './types.ts';
import { uploadJournalImage } from '../../../firebase/storage.ts';
import { openModal } from '../../../core/modal.ts';
import { playOpen, startPost } from '../scenes/letter-motion.ts';
import { envelopeTitle } from '../shared/letter-model.ts';
import { cachedRatio, measureMissing, measureRatio, rememberRatio, storedRatios } from '../shared/ratio-cache.ts';
import {
  MAX_JOURNAL_IMAGES,
  OTHER_DESTINATION,
  currentCity,
  entryImages,
  currentMonthKey,
  monthKeyFromIso,
  parseTags,
  shareUrl,
  shiftMonth,
  slugifyEntry,
  sortEntries,
  escHtml,
} from '../shared/utils.ts';

interface CaptureControllerDeps {
  getEntries: () => StoredJournalEntry[];
  getLegs: () => StoredLeg[];
  getAlbums?: () => StoredJournalAlbum[];
  /** The Dashboard's album drawer: existing albums only, opened as a feed, no editing controls. */
  albumDrawer?: boolean;
  requestRender: () => void;
}

export function createCaptureController(deps: CaptureControllerDeps) {
  const state: CaptureState = {
    view: 'feed',
    filter: { destination: 'all', tag: 'all', favoritesOnly: false },
    draft: defaultDraft(deps.getLegs()),
    composerOpen: false,
    moreOpen: false,
    metaEditing: false,
    editingId: null,
    readingId: null,
    readerTurn: '',
    letter: null,
    opening: false,
    posting: false,
    calendarMonth: currentMonthKey(),
    gallerySquare: false,
    galleryDrift: true,
    placeKey: null,
    placeFlip: false,
    albumLeaf: 0,
    albumTurn: false,
    albumDir: '',
    selection: null,
    openAlbumId: null,
    coverEdit: null,
    tidy: null,
    tidyLoading: false,
  };

  /** A save is in flight (the envelope may or may not be animating). Declared up here: the code below the controller's `return` never runs a `let`. */
  let saving = false;
  /** The picture picked in the cover editor and not yet uploaded. */
  let coverFile: File | null = null;

  function savedGuideCards(): { id: string; title: string; type: string }[] {
    const city = state.draft.destination.trim();
    if (!city) return [];
    const allIntel = cityStore.peek();
    const intel = allIntel.find((c) => c.city.toLowerCase() === city.toLowerCase());
    if (!intel) return [];
    const types: Array<{ cards: GuideCard[]; type: string }> = [
      { cards: intel.attractions, type: 'attraction' },
      { cards: intel.restaurants, type: 'restaurant' },
      { cards: intel.cafes, type: 'cafe' },
      { cards: intel.experiences, type: 'experience' },
    ];
    return types.flatMap(({ cards, type }) =>
      cards.filter((c) => c.saved).map((c) => ({ id: c.id, title: c.title, type }))
    ).slice(0, 8);
  }

  function render(): string {
    const allEntries = sortEntries(deps.getEntries());
    const visibleEntries = filteredEntries(allEntries);
    const allTags = collectTags(allEntries);
    const destinations = [...new Set(allEntries.map((entry) => entry.destination.trim()).filter(Boolean))];
    const stops = buildStops(visibleEntries, deps.getLegs());
    const tagGroups = buildTagGroups(visibleEntries);
    const calendarCells = buildCalendarCells(state.calendarMonth, filteredEntries(allEntries, false));

    return renderCapture({
      state,
      allEntries,
      visibleEntries,
      allTags,
      destinations,
      stops,
      tagGroups,
      galleryTitle: currentTrip()?.name ?? 'On the Road',
      calendarCells,
      currentMonthLabel: new Date(`${state.calendarMonth}-01T00:00:00`).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
      }),
      legs: deps.getLegs(),
      savedGuidePlaces: savedGuideCards(),
      albums: deps.getAlbums?.() ?? [],
      albumDrawer: deps.albumDrawer,
    });
  }

  let _boundRoot: HTMLElement | null = null;

  function bind(root: HTMLElement) {
    // Only attach listeners once per root element to prevent accumulation across re-renders.
    if (_boundRoot === root) return;
    _boundRoot = root;

    root.addEventListener('pointerdown', (e) => dragDown(e));
    root.addEventListener('pointermove', (e) => dragMove(e, root));
    root.addEventListener('pointerup', (e) => { void dragUp(e, root); });
    root.addEventListener('pointercancel', (e) => { void dragUp(e, root); });

    window.addEventListener('resize', () => {
      if (state.openAlbumId && syncMagazineView(root)) deps.requestRender();
    });

    root.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;

      const shareBtn = target.closest<HTMLElement>('[data-share-entry]');
      if (shareBtn) {
        void shareEntry(shareBtn.dataset.shareEntry!);
        return;
      }

      const favoriteBtn = target.closest<HTMLElement>('[data-favorite-entry]');
      if (favoriteBtn) {
        void toggleFavorite(favoriteBtn.dataset.favoriteEntry!);
        return;
      }

      const deleteBtn = target.closest<HTMLElement>('[data-delete-entry]');
      if (deleteBtn) {
        void deleteEntry(deleteBtn.dataset.deleteEntry!);
        return;
      }

      const cardBtn = target.closest<HTMLElement>('[data-card-entry]');
      if (cardBtn) {
        const entry = deps.getEntries().find((item) => item.id === cardBtn.dataset.cardEntry);
        if (entry) void openCardPreview(entry);
        return;
      }

      const saveBtn = target.closest<HTMLElement>('[data-journal-save]');
      if (saveBtn) {
        const liveShell = shellOf(root);
        if (liveShell) void saveDraft(liveShell);
        return;
      }

      const cancelBtn = target.closest<HTMLElement>('[data-journal-cancel], [data-journal-close]');
      if (cancelBtn) {
        resetDraft();
        deps.requestRender();
        return;
      }

      const exportBtn = target.closest<HTMLElement>('[data-journal-export]');
      if (exportBtn) {
        exportEntries(deps.getEntries(), exportBtn.dataset.journalExport === 'json' ? 'json' : 'md');
        return;
      }

      const newBtn = target.closest<HTMLElement>('[data-journal-new]');
      if (newBtn) {
        openComposer();
        deps.requestRender();
        focusComposer();
        return;
      }

      // L2: swap the place+date summary line for its controls.
      const metaEditBtn = target.closest<HTMLElement>('[data-meta-edit]');
      if (metaEditBtn) {
        const liveShell = shellOf(root);
        if (liveShell) syncDraftFromDom(liveShell);
        state.metaEditing = true;
        deps.requestRender();
        return;
      }

      // Close composer when clicking outside the drawer (on the overlay backdrop)
      if (target.matches('[data-journal-overlay]')) {
        resetDraft();
        deps.requestRender();
        return;
      }


      /* ── Albums ───────────────────────────────────────────────────────── */

      // The sticky note of extras opens and closes on its own; remember it so a redraw does not fold it shut.
      const noteTab = target.closest<HTMLElement>('[data-journal-more] > summary');
      if (noteTab) {
        state.moreOpen = !(noteTab.parentElement as HTMLDetailsElement).open;
      }

      const tidyBtn = target.closest<HTMLElement>('[data-album-tidy]');
      if (tidyBtn) {
        void runTidy();
        return;
      }

      const tidyDismiss = target.closest<HTMLElement>('[data-tidy-dismiss]');
      if (tidyDismiss) {
        state.tidy = null;
        deps.requestRender();
        return;
      }

      const tidyAccept = target.closest<HTMLElement>('[data-tidy-accept]');
      if (tidyAccept) {
        void acceptTidyAlbum(Number(tidyAccept.dataset.tidyAccept));
        return;
      }

      const albumCreateBtn = target.closest<HTMLElement>('[data-album-create]');
      if (albumCreateBtn) {
        void createAlbum();
        return;
      }

      const albumOpenBtn = target.closest<HTMLElement>('[data-open-album]');
      if (albumOpenBtn) {
        state.openAlbumId = albumOpenBtn.dataset.openAlbum ?? null;
        state.albumLeaf = 0;
        state.albumDir = '';
        deps.requestRender();
        return;
      }

      const albumBackBtn = target.closest<HTMLElement>('[data-album-back]');
      if (albumBackBtn) {
        state.openAlbumId = null;
        deps.requestRender();
        return;
      }

      const albumPageBtn = target.closest<HTMLElement>('[data-album-page]');
      if (albumPageBtn) {
        void turnAlbumPage(albumPageBtn.dataset.albumPage === 'prev' ? -1 : 1);
        return;
      }

      const albumRenameBtn = target.closest<HTMLElement>('[data-album-rename]');
      if (albumRenameBtn) {
        void renameAlbum(albumRenameBtn.dataset.albumRename ?? '');
        return;
      }

      const albumDeleteBtn = target.closest<HTMLElement>('[data-album-delete]');
      if (albumDeleteBtn) {
        void deleteAlbum(albumDeleteBtn.dataset.albumDelete ?? '');
        return;
      }

      /* ── Designing a cover ────────────────────────────────────────────── */

      const coverBtn = target.closest<HTMLElement>('[data-album-cover]');
      if (coverBtn) {
        const album = deps.getAlbums?.().find((a) => a.id === coverBtn.dataset.albumCover);
        if (album) state.coverEdit = { albumId: album.id, draft: coverDraftFor(album) };
        deps.requestRender();
        return;
      }

      const tplBtn = target.closest<HTMLElement>('[data-cover-template]');
      if (tplBtn && state.coverEdit) {
        state.coverEdit.draft.template = tplBtn.dataset.coverTemplate as JournalAlbumCover['template'];
        deps.requestRender();
        return;
      }

      if (target.closest('[data-cover-photo-clear]') && state.coverEdit) {
        releaseCoverPhoto();
        state.coverEdit.draft.photo = '';
        deps.requestRender();
        return;
      }

      const toneBtn = target.closest<HTMLElement>('[data-cover-tone]');
      if (toneBtn && state.coverEdit) {
        state.coverEdit.draft.tone = toneBtn.dataset.coverTone as JournalAlbumCover['tone'];
        deps.requestRender();
        return;
      }

      if (target.closest('[data-cover-cancel]')) {
        releaseCoverPhoto();
        state.coverEdit = null;
        deps.requestRender();
        return;
      }

      if (target.closest('[data-cover-save]')) {
        void saveCover();
        return;
      }

      const albumRemoveBtn = target.closest<HTMLElement>('[data-album-remove-entry]');
      if (albumRemoveBtn) {
        const [albumId, entryId] = (albumRemoveBtn.dataset.albumRemoveEntry ?? '').split(':');
        void removeFromAlbum(albumId, entryId);
        return;
      }

      /* ── Gallery multi-select ─────────────────────────────────────────── */

      const selectToggle = target.closest<HTMLElement>('[data-gallery-select]');
      if (selectToggle) {
        state.selection = state.selection === null ? [] : null;
        if (state.selection === null) state.galleryDrift = false;
        deps.requestRender();
        return;
      }

      const selectCancel = target.closest<HTMLElement>('[data-gallery-select-cancel]');
      if (selectCancel) {
        state.selection = null;
        deps.requestRender();
        return;
      }

      const pickTile = target.closest<HTMLElement>('[data-gallery-pick]');
      if (pickTile) {
        const id = pickTile.dataset.galleryPick ?? '';
        const picked = state.selection ?? [];
        state.selection = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
        deps.requestRender();
        return;
      }

      const viewBtn = target.closest<HTMLElement>('[data-journal-view]');
      if (viewBtn) {
        state.view = viewBtn.dataset.journalView as CaptureState['view'];
        if (state.view === 'gallery') state.galleryDrift = true;   // the wall starts moving each time you walk in
        deps.requestRender();
        return;
      }

      const tagBtn = target.closest<HTMLElement>('[data-filter-tag]');
      if (tagBtn) {
        state.filter.tag = tagBtn.dataset.filterTag ?? 'all';
        deps.requestRender();
        return;
      }

      const favoritesBtn = target.closest<HTMLElement>('[data-filter-favorites]');
      if (favoritesBtn) {
        state.filter.favoritesOnly = !state.filter.favoritesOnly;
        deps.requestRender();
        return;
      }

      // The feed's one chip: drop whichever filter an album tag group set.
      const clearBtn = target.closest<HTMLElement>('[data-filter-clear]');
      if (clearBtn) {
        state.filter = { tag: 'all', destination: 'all', favoritesOnly: false };
        deps.requestRender();
        return;
      }

      const pickBtn = target.closest<HTMLElement>('[data-place-pick]');
      if (pickBtn) {
        pickPlace(pickBtn.dataset.placePick ?? '');
        return;
      }

      const placeBtn = target.closest<HTMLElement>('[data-place-filter]');
      if (placeBtn) {
        state.filter.destination = placeBtn.dataset.placeFilter ?? 'all';
        state.view = 'feed';
        deps.requestRender();
        return;
      }

      const monthShiftBtn = target.closest<HTMLElement>('[data-calendar-shift]');
      if (monthShiftBtn) {
        state.calendarMonth = shiftMonth(state.calendarMonth, Number(monthShiftBtn.dataset.calendarShift ?? '0'));
        deps.requestRender();
        return;
      }

      const openMapBtn = target.closest<HTMLElement>('[data-open-map-view]');
      if (openMapBtn) {
        window.location.hash = 'map';
        return;
      }

      const driftBtn = target.closest<HTMLElement>('[data-gallery-drift]');
      if (driftBtn) {
        state.galleryDrift = !state.galleryDrift;
        deps.requestRender();
        return;
      }

      const galleryToggleBtn = target.closest<HTMLElement>('[data-gallery-square]');
      if (galleryToggleBtn) {
        state.gallerySquare = !state.gallerySquare;
        deps.requestRender();
        return;
      }

      const removeImageBtn = target.closest<HTMLElement>('[data-remove-image]');
      if (removeImageBtn) {
        removeDraftImage(Number(removeImageBtn.dataset.removeImage ?? '0'));
        deps.requestRender();
        return;
      }

      const moveImageBtn = target.closest<HTMLElement>('[data-move-image]');
      if (moveImageBtn) {
        moveDraftImage(Number(moveImageBtn.dataset.moveImage ?? '0'),
                       moveImageBtn.dataset.moveDir === 'back' ? -1 : 1);
        deps.requestRender();
        return;
      }

      const entryTarget = target.closest<HTMLElement>('[data-open-entry]');
      if (entryTarget) {
        // Opens the read-only reader, not the composer — a tap on a feed
        // card used to drop straight into edit mode, which meant reading an
        // entry required going through an editable textarea. Editing is now
        // a deliberate action from inside the reader (data-open-reader-edit).
        state.readingId = entryTarget.dataset.openEntry!;
        state.readerTurn = '';
        state.letter = null;
        state.opening = true;
        deps.requestRender();
        return;
      }

      // The reader's page arrows: walk the entries without closing the book.
      const turnBtn = target.closest<HTMLElement>('[data-spread-prev], [data-spread-next]');
      if (turnBtn) {
        const back = turnBtn.hasAttribute('data-spread-prev');
        const id = (back ? turnBtn.dataset.spreadPrev : turnBtn.dataset.spreadNext) ?? '';
        if (id) {
          state.readingId = id;
          state.readerTurn = back ? 'prev' : 'next';
          state.letter = null;
          state.opening = false;
          deps.requestRender();
        }
        return;
      }

      // A postcard: in the pile the first tap brings it to the front, the next turns it over;
      // in a row (narrow screens) or spread across the desk a tap just turns it.
      const postcard = target.closest<HTMLElement>('[data-postcard]');
      if (postcard) {
        pressPostcard(Number(postcard.dataset.postcard), postcard);
        return;
      }

      const readerEditBtn = target.closest<HTMLElement>('[data-open-reader-edit]');
      if (readerEditBtn) {
        const id = readerEditBtn.dataset.openReaderEdit!;
        state.readingId = null;
        loadEntryIntoDraft(id);
        deps.requestRender();
        focusComposer(true);
        return;
      }

      // `data-reader-close` is the explicit close (✕) button — closest() is
      // right there, it should fire from anywhere inside that button.
      // `data-journal-reader-overlay` is the backdrop itself: matches(), not
      // closest(), because closest() would also match every click INSIDE the
      // drawer (the overlay div is an ancestor of everything in it,
      // including the Edit button above), which is what made Edit silently
      // close the reader instead of opening the composer.
      const readerCloseBtn = target.closest<HTMLElement>('[data-reader-close]');
      if (readerCloseBtn || target.matches('[data-journal-reader-overlay]')) {
        state.readingId = null;
        deps.requestRender();
        return;
      }
    });

    // The cover's text fields repaint only the proof: a full re-render would
    // rebuild the input under the cursor and lose the caret mid-word.
    root.addEventListener('input', (event) => {
      const el = event.target as HTMLInputElement;
      if (el.id === 'journal-body') autosize(el);
      if (el.id === 'journal-title' || el.id === 'journal-destination') updateEnvelope(el);
      if (!state.coverEdit || !syncCoverField(el)) return;
      const album = albums().find((a) => a.id === state.coverEdit!.albumId);
      const proof = root.querySelector<HTMLElement>('.jce-proof-art');
      if (!album || !proof) return;
      const draft = state.coverEdit.draft;
      // eslint-disable-next-line no-restricted-syntax -- audited: renderCover escapes every field
      proof.innerHTML = renderCover(
        { ...draft, headline: draft.headline.trim() || album.title },
        coverArtOf(album, albumEntries(album, sortEntries(deps.getEntries()))),
      );
    });

    root.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement | HTMLSelectElement;
      const liveShell = shellOf(root);
      if (!liveShell) return;

      if (target.matches('[data-album-target]')) {
        const value = target.value;
        target.value = '';
        void addSelectionToAlbum(value);
        return;
      }

      if (target.matches('[data-album-add-entry]')) {
        const entryId = (target as HTMLSelectElement).dataset.albumAddEntry ?? '';
        const value = target.value;
        target.value = '';
        void addEntriesToAlbum(value, [entryId]);
        return;
      }

      if (target.matches('[data-filter-destination]')) {
        state.filter.destination = target.value;
        deps.requestRender();
        return;
      }

      if (target.matches('#journal-destination-select')) {
        syncDraftFromDom(liveShell);
        const selected = (target as HTMLSelectElement).value;
        state.draft.destination = selected === OTHER_DESTINATION ? '' : selected;
        deps.requestRender();
        return;
      }

      // The dateline reads the date back as a sentence, so it is redrawn when the date changes.
      if (target.matches('#journal-date')) {
        syncDraftFromDom(liveShell);
        deps.requestRender();
        return;
      }

      // A cover picture is only previewed here; it is uploaded when the cover is saved.
      if (target.matches('[data-cover-photo-input]') && state.coverEdit) {
        const file = (target as HTMLInputElement).files?.[0];
        (target as HTMLInputElement).value = '';
        if (!file) return;
        releaseCoverPhoto();
        coverFile = file;
        state.coverEdit.draft.photo = URL.createObjectURL(file);
        deps.requestRender();
        return;
      }

      if (target.matches('#journal-image-input')) {
        void loadDraftImages(target as HTMLInputElement);
        return;
      }

      if (target.name === 'journal-mood') {
        syncDraftFromDom(liveShell);
        deps.requestRender();
      }
    });

    root.addEventListener('keydown', (event) => {
      const keyEvent = event as KeyboardEvent;
      if (state.openAlbumId && state.view === 'albums' && !(keyEvent.target instanceof HTMLInputElement) && !(keyEvent.target instanceof HTMLTextAreaElement)) {
        if (keyEvent.key === 'ArrowRight') { keyEvent.preventDefault(); void turnAlbumPage(1); return; }
        if (keyEvent.key === 'ArrowLeft') { keyEvent.preventDefault(); void turnAlbumPage(-1); return; }
      }
      // Enter / Space on a focused card, page or tile opens it (they are buttons in spirit)
      if ((keyEvent.key === 'Enter' || keyEvent.key === ' ') && keyEvent.target instanceof HTMLElement
          && keyEvent.target.matches('[data-open-entry][role="button"], [data-gallery-pick][role="button"], [data-postcard][role="button"]')) {
        keyEvent.preventDefault();
        keyEvent.target.click();
        return;
      }
      if (
        keyEvent.target instanceof HTMLTextAreaElement &&
        keyEvent.target.id === 'journal-body' &&
        (keyEvent.metaKey || keyEvent.ctrlKey) &&
        keyEvent.key === 'Enter'
      ) {
        keyEvent.preventDefault();
        const liveShell = shellOf(root);
        if (!liveShell) return;
        void saveDraft(liveShell);
      }
    });
  }

  function handleDataChange() {
    const entries = deps.getEntries();
    const destinations = new Set(entries.map((entry) => entry.destination.trim()).filter(Boolean));
    const tags = new Set(collectTags(entries));
    const templateIds = new Set(templates().map((item) => item.id));

    if (state.filter.destination !== 'all' && !destinations.has(state.filter.destination)) {
      state.filter.destination = 'all';
    }
    if (state.filter.tag !== 'all' && !tags.has(state.filter.tag)) {
      state.filter.tag = 'all';
    }
    if (!templateIds.has(normalizeTemplateId(state.draft.template))) {
      state.draft.template = DEFAULT_TEMPLATE;
    }
    // Close the editor if the entry being edited was genuinely deleted — but
    // NOT on an empty result. Every store subscription emits cb([]) before its
    // real rows (cold cache read, signed-out snapshot, trip re-subscribe), and
    // any of those firing while the composer is open would otherwise discard
    // the user's in-progress edit and drop them back on the feed.
    if (state.editingId && entries.length > 0 && !entries.some((entry) => entry.id === state.editingId)) {
      resetDraft();
    }
    if (!state.composerOpen && !state.draft.destination) {
      state.draft.destination = currentCity(deps.getLegs());
    }
  }

  /** After every render: keep the places map and the gallery's drift in step with what is on screen. */
  function afterRender(root: HTMLElement) {
    bindOpenBook();
    // The book is scaled to its desk; a desk that has become phone-wide (or the reverse) shows one page (or two).
    if (syncMagazineView(root)) deps.requestRender();
    measureReading();
    resetReaderScroll();
    playOpening();
    autosize(document.getElementById('journal-body'));
    void syncPlacesMap(root, {
      onPick: (key) => pickPlace(key),
    });
    syncGalleryFlow(root, {
      isDrifting: () => state.view === 'gallery' && state.galleryDrift && state.selection === null,
      onStop: () => { state.galleryDrift = false; deps.requestRender(); },
    });
  }

  /**
   * An entry written before `imageRatios` has photos nobody has measured, and a
   * postcard can't be framed without its shape. Measure the one being read,
   * repaint once if that taught us anything, and let the entry remember the
   * answer (see shared/ratio-cache.ts).
   */
  function measureReading() {
    const id = state.readingId;
    const entry = id ? deps.getEntries().find((e) => e.id === id) : undefined;
    if (!entry || !entryImages(entry).length) return;
    void measureMissing([entry], {
      write: (entryId, imageRatios) => journalStore.update(entryId, { imageRatios }),
    }).then((learned) => {
      if (learned && state.readingId === entry.id) deps.requestRender();
    });
  }

  /** The envelope is addressed as the title is typed. */
  function updateEnvelope(el: HTMLInputElement) {
    const scene = el.closest('[data-letter-scene]');
    if (!scene) return;
    const draft = { title: '', body: '', destination: '' };
    draft.title = scene.querySelector<HTMLInputElement>('#journal-title')?.value ?? '';
    draft.body = scene.querySelector<HTMLTextAreaElement>('#journal-body')?.value ?? '';
    draft.destination = scene.querySelector<HTMLInputElement>('#journal-destination')?.value ?? '';
    const to = scene.querySelector('.ltr-env-title');
    if (to) to.textContent = envelopeTitle(draft);
    const from = scene.querySelector('.ltr-env-place');
    if (from) from.textContent = draft.destination.trim() || '—';
  }

  /** The envelope opens once, when an entry is opened from a list — the page is already drawn, so this only animates. */
  function playOpening() {
    if (!state.opening || !state.readingId) return;
    state.opening = false;
    playOpen(document.querySelector<HTMLElement>('.ltr--read'));
  }

  /** Turning to another entry keeps the same scroller (the markup is morphed, not rebuilt), so start it at the top. */
  let scrolledFor: string | null = null;
  function resetReaderScroll() {
    if (state.readingId === scrolledFor) return;
    scrolledFor = state.readingId;
    const scroller = document.querySelector<HTMLElement>('.ltr-scroll');
    if (scroller) scroller.scrollTop = 0;
  }

  function pressPostcard(index: number, card: HTMLElement) {
    // Writing and reading each have their own pile; they are never open together.
    const id = state.composerOpen ? 'draft' : state.readingId;
    if (!id) return;
    const focus = state.letter?.entryId === id ? state.letter : { entryId: id, picked: 0, flipped: [] as number[] };
    // Fanned in a pile (a wide desk) the cards are absolutely positioned; in a row or spread loose they are not.
    const inPile = getComputedStyle(card).position === 'absolute';
    // A card being written is arranged, not read: picking it brings it forward, nothing turns it over.
    if (state.composerOpen) {
      focus.picked = index;
    } else if (inPile && focus.picked !== index) {
      focus.picked = index;
    } else {
      focus.picked = index;
      focus.flipped = focus.flipped.includes(index) ? focus.flipped.filter((i) => i !== index) : [...focus.flipped, index];
    }
    state.letter = focus;
    deps.requestRender();
  }

  /** The open album's entries, in its order, and its finished book if it has been bound. */
  function openBook() {
    const album = (deps.getAlbums?.() ?? []).find((a) => a.id === state.openAlbumId);
    if (!album) return null;
    const entries = magazineEntries(album, deps.getEntries());
    return { album, entries, book: cachedBook(album, entries) };
  }

  /**
   * An open album needs binding: wait for the fonts and the photos' shapes, paginate, then
   * draw. Cached by the entries' ids and edit times, so this runs once per change, not per page.
   */
  function bindOpenBook() {
    if (!state.openAlbumId || state.view !== 'albums' || state.coverEdit) return;
    const o = openBook();
    if (!o || o.book || bookIsLoading(o.album, o.entries)) return;
    void loadBook(o.album, o.entries, (id, imageRatios) => journalStore.update(id, { imageRatios })).then((book) => {
      if (book && state.openAlbumId === o.album.id) deps.requestRender();
    }).catch((error) => console.error('Binding the album failed:', error));
  }

  /** The pages of the spread (or page) at `leaf`, drawn the way the book will draw it, from a detached copy. */
  function pagesAt(leaf: number): HTMLElement[] {
    const o = openBook();
    if (!o?.book) return [];
    const html = renderMagazine(o.album, o.entries, o.book, { leaf, turn: false, dir: '' }, magazineCountries(o.entries, deps.getLegs()));
    const tmp = document.createElement('div');
    // eslint-disable-next-line no-restricted-syntax -- audited: renderMagazine escapes every field
    tmp.innerHTML = html;
    return [...tmp.querySelectorAll<HTMLElement>('.mag-spread > .mag-page')];
  }

  /** The turn is real: the book is on the new leaf and drawn there. */
  function commitTurn(to: number, delta: FlipDir, fade: boolean) {
    state.albumLeaf = to;
    state.albumDir = fade ? (delta > 0 ? 'next' : 'prev') : '';
    state.albumTurn = !state.albumTurn;
    deps.requestRender();
  }

  /** The one turn in flight (a click's animation, or a drag), so a second cannot start under it. */
  let turning = false;

  /** ‹ › in the open album: the page swings over; a spread at a time (a page on a phone), clamped to the book. */
  async function turnAlbumPage(delta: FlipDir) {
    if (turning) return;
    const o = openBook();
    if (!o?.book) return;
    const mode = currentMode();
    const next = turnTo(state.albumLeaf, delta, o.book.leaves.length, mode);
    if (next === state.albumLeaf) return;
    const spread = document.querySelector<HTMLElement>('.mag-spread');
    const flip = spread ? beginFlip(spread, mode, delta, pagesAt(next)) : null;
    if (!flip) { commitTurn(next, delta, true); return; }      // reduced motion: a fade, as before
    turning = true;
    try {
      await flip.settle(1);
      commitTurn(next, delta, false);
    } finally {
      flip.destroy();
      turning = false;
    }
  }

  /* ── Dragging a page ─────────────────────────────────────────────────────
   * The same sheet, followed by the finger: grab the right page and pull it left
   * to turn forward, the left page and pull right to turn back (a phone: either
   * way). Let go past a third of the way, or with a flick, and it lands; short of
   * that it goes back and the book has not changed. */
  interface Drag { id: number; x0: number; t0: number; dir: FlipDir | 0; flip: Flip | null; to: number; pageW: number; spineX: number; progress: number }
  let drag: Drag | null = null;

  function dragDown(event: PointerEvent) {
    const target = event.target as HTMLElement;
    if (turning || event.button > 0 || !state.openAlbumId || state.view !== 'albums') return;
    const spread = target.closest<HTMLElement>('.mag-spread');
    if (!spread || target.closest('button, a, input, select, textarea')) return;
    const rect = spread.getBoundingClientRect();
    const page = spread.querySelector<HTMLElement>('.mag-page')?.getBoundingClientRect();
    drag = {
      id: event.pointerId, x0: event.clientX, t0: performance.now(), dir: 0, flip: null, to: state.albumLeaf, progress: 0,
      pageW: page?.width ?? rect.width / 2,
      spineX: currentMode() === 'single' ? rect.left : rect.left + rect.width / 2,
    };
  }

  function dragMove(event: PointerEvent, root: HTMLElement) {
    const d = drag;
    if (!d || event.pointerId !== d.id) return;
    const mode = currentMode();
    if (d.dir === 0) {
      if (Math.abs(event.clientX - d.x0) < 8) return;
      const dir = dragDirection(d.x0, event.clientX, d.spineX, mode);
      const o = openBook();
      const spread = document.querySelector<HTMLElement>('.mag-spread');
      const to = o?.book ? turnTo(state.albumLeaf, dir || 1, o.book.leaves.length, mode) : state.albumLeaf;
      const flip = dir && o?.book && spread && to !== state.albumLeaf ? beginFlip(spread, mode, dir, pagesAt(to)) : null;
      if (!dir || !flip) { drag = null; return; }
      d.dir = dir; d.flip = flip; d.to = to;
      try { root.setPointerCapture?.(event.pointerId); } catch { /* a synthetic pointer: nothing to capture */ }
    }
    d.progress = turnProgress(event.clientX - d.x0, d.pageW);
    d.flip!.set(d.progress);
  }

  async function dragUp(event: PointerEvent, root: HTMLElement) {
    const d = drag;
    if (!d || event.pointerId !== d.id) return;
    drag = null;
    try { root.releasePointerCapture?.(event.pointerId); } catch { /* not captured */ }
    if (!d.flip || !d.dir) return;
    const dt = Math.max(1, performance.now() - d.t0);
    const commit = shouldCommit(d.progress, Math.abs(event.clientX - d.x0) / dt);
    turning = true;
    try {
      await d.flip.settle(commit ? 1 : 0);
      if (commit) commitTurn(d.to, d.dir, false);
    } finally {
      d.flip.destroy();
      turning = false;
    }
  }

  function pickPlace(key: string) {
    if (state.placeKey === key) return;
    state.placeKey = key;
    state.placeFlip = !state.placeFlip;
    deps.requestRender();
  }

  /** Leaving the Journal (or switching trip): release the map and the drift loop. */
  function dispose() {
    disposePlacesMap();
    stopGalleryFlow();
  }

  return {
    render,
    bind,
    handleDataChange,
    afterRender,
    dispose,
    currentView: () => state.view,
    /** The envelope is mid-flight: a redraw now would throw the animation away. */
    isPosting: () => state.posting,
    openComposer: () => {
      openComposer();
      deps.requestRender();
    },
    /** Open one entry in the reader — used by the recap deck's evidence chips. */
    openEntry: (id: string) => {
      state.readingId = id;
      state.opening = true;
      deps.requestRender();
    },
  };

  function filteredEntries(entries: StoredJournalEntry[], applyCalendarMonth = true): StoredJournalEntry[] {
    return entries
      .filter((entry) => state.filter.destination === 'all' || entry.destination === state.filter.destination)
      .filter((entry) => state.filter.tag === 'all' || entry.tags.includes(state.filter.tag))
      .filter((entry) => !state.filter.favoritesOnly || entry.favorite)
      .filter((entry) => !applyCalendarMonth || state.view !== 'calendar' || monthKeyFromIso(entry.happenedOn) === state.calendarMonth);
  }

  function defaultDraft(legs: StoredLeg[]): DraftState {
    return {
      body: '',
      title: '',
      template: DEFAULT_TEMPLATE,
      destination: currentCity(legs),
      tagsText: '',
      mood: '',
      happenedOn: new Date().toISOString().slice(0, 10),
      images: [],
      pendingFiles: [],
      imageRatios: [],
      uploading: false,
      linkedPlaces: [],
    };
  }

  function openComposer() {
    state.editingId = null;
    state.composerOpen = true;
    state.moreOpen = false;
    state.metaEditing = false;
    state.letter = null;
    state.draft = defaultDraft(deps.getLegs());
  }

  function resetDraft() {
    state.letter = null;
    state.editingId = null;
    state.composerOpen = false;
    state.moreOpen = false;
    state.metaEditing = false;
    state.draft = defaultDraft(deps.getLegs());
  }

  function loadEntryIntoDraft(id: string) {
    const entry = deps.getEntries().find((item) => item.id === id);
    if (!entry) return;
    state.editingId = id;
    state.composerOpen = true;
    state.letter = null;
    state.draft = {
      body: entry.body,
      title: entry.title,
      template: template(entry.template).id as TemplateId,
      destination: entry.destination,
      tagsText: entry.tags.join(', '),
      mood: entry.mood ?? 'spark',
      happenedOn: entry.happenedOn,
      images: entryImages(entry),
      // Already on Storage — nothing to re-upload unless the user adds more.
      pendingFiles: entryImages(entry).map(() => null),
      // The entry's own shapes if they can be trusted, else whatever was measured
      // while reading it; anything still unknown is measured when it is saved.
      imageRatios: draftRatiosFor(entry),
      uploading: false,
      linkedPlaces: entry.linkedPlaces ?? [],
    };
  }

  /**
   * Sync the draft from whatever composer is currently mounted.
   *
   * The composer renders into a document-level overlay, so helpers that run
   * outside `bind`'s closure can't use its `root`; they look the shell up here
   * instead, the same way focusComposer/appendToComposerBody reach the DOM.
   */
  function syncDraftFromLiveShell() {
    const liveShell = document.querySelector<HTMLElement>('.ltr--write') ?? document.querySelector<HTMLElement>('.journal-shell');
    if (liveShell) syncDraftFromDom(liveShell);
  }

  function syncDraftFromDom(root: HTMLElement) {
    const get = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector);
    const linkedChecked = [...root.querySelectorAll<HTMLInputElement>('input[name="journal-linked-place"]:checked')]
      .map((el) => el.value);
    state.draft = {
      body: get<HTMLTextAreaElement>('#journal-body')?.value ?? state.draft.body,
      title: get<HTMLInputElement>('#journal-title')?.value ?? state.draft.title,
      template: state.draft.template,
      destination: get<HTMLInputElement>('#journal-destination')?.value ?? state.draft.destination,
      tagsText: get<HTMLInputElement>('#journal-tags')?.value ?? state.draft.tagsText,
      mood: ((root.querySelector('input[name="journal-mood"]:checked') as HTMLInputElement | null)?.value as string) ?? state.draft.mood,
      happenedOn: get<HTMLInputElement>('#journal-date')?.value ?? state.draft.happenedOn,
      images: state.draft.images,
      pendingFiles: state.draft.pendingFiles,
      imageRatios: state.draft.imageRatios,
      uploading: state.draft.uploading,
      linkedPlaces: linkedChecked.length ? linkedChecked : state.draft.linkedPlaces,
    };
  }

  async function saveDraft(root: HTMLElement) {
    if (saving) return;                   // already on its way
    syncDraftFromDom(root);
    // A photo with no words is a complete entry — that's the whole point of the
    // one-tap composer. Only a draft with neither text nor photos is empty.
    // Checked against `pendingFiles`, not `images`: the upload happens below.
    const hasPhotos = state.draft.images.length > 0 || state.draft.pendingFiles.some(Boolean);
    if (!state.draft.body.trim() && !hasPhotos) {
      focusComposer();
      return;
    }

    // Category is inferred from what was written, and only for NEW entries —
    // editing preserves whatever the entry carries, so a correction sticks.
    const resolvedTemplate = state.editingId
      ? state.draft.template
      : inferTemplate({
          body: state.draft.body,
          mood: state.draft.mood,
          linkedPlaces: state.draft.linkedPlaces,
        });

    const payload: Record<string, unknown> = {
      title: state.draft.title.trim(),
      body: state.draft.body.trim(),
      template: resolvedTemplate,
      destination: state.draft.destination.trim(),
      tags: parseTags(state.draft.tagsText),
      mood: state.draft.mood,
      happenedOn: state.draft.happenedOn || new Date().toISOString().slice(0, 10),
    };

    // The letter starts folding now. The write below starts at the same moment and does
    // not wait for it; if the write fails the animation is cancelled and the page is as it was.
    const post = startPost(document.querySelector<HTMLElement>('.ltr--write'));
    saving = true;
    state.posting = !!post;
    const abort = (message: string) => {
      post?.cancel();
      saving = false;
      state.posting = false;
      toast(message);
    };

    // Upload any locally-picked photos before writing the doc, so the entry
    // only ever references URLs Storage has actually accepted.
    let images: string[];
    try {
      images = await uploadDraftImages();
    } catch (error) {
      console.error('Journal image upload failed:', error);
      abort('Could not upload photos');
      return;
    }

    payload.images = images;
    // Mirror the first photo into the legacy field so older clients and the
    // share-card renderer still find a cover.
    payload.coverImage = images[0] ?? '';
    // Every photo's shape, index-aligned with `images`. All or nothing: a list
    // with a hole in it would put every later ratio on the wrong picture. The
    // reader measures what is missing, so leaving it out costs nothing.
    const ratios = images.length ? await draftRatios() : null;
    if (ratios) {
      payload.imageRatios = ratios;
      // The feed still reads the first photo's shape from the old field.
      payload.imageRatio = ratios[0];
    }
    if (state.draft.linkedPlaces.length) payload.linkedPlaces = state.draft.linkedPlaces;

    try {
      if (state.editingId) await journalStore.update(state.editingId, payload);
      else await journalStore.save({ ...payload, favorite: false, visibility: 'private', slug: '' });
    } catch (error) {
      console.error('Journal save failed:', error);
      abort('Could not save');
      return;
    }

    // Written. Let the envelope be sealed and sail off before the desk is cleared.
    if (post) {
      await post.sealed;
      await post.fly();
    }
    saving = false;
    state.posting = false;
    resetDraft();
    deps.requestRender();
  }

  /* ── Album operations ───────────────────────────────────────────────────
   * Albums are the user's own grouping, made after the fact — the counterpart
   * to the inferred `template`. Membership lives on the album, so every one of
   * these is a write to a single album document.
   */

  function albums(): StoredJournalAlbum[] {
    return deps.getAlbums?.() ?? [];
  }

  /**
   * Open the "new album" modal and create it. Resolves with the new album's
   * id, or '' if the user cancelled or left the title blank — same contract
   * the old prompt()-based version had, so callers (addEntriesToAlbum, the
   * "new album" button) didn't need to change.
   *
   * `finish` is idempotent and fires from two places — a successful submit,
   * and modal.ts's own `onClose` (which covers ✕, backdrop click, and Esc) —
   * so cancelling by any of those paths still resolves the promise instead of
   * leaving the caller awaiting forever.
   */
  function createAlbum(seedEntryIds: string[] = []): Promise<string> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (id: string) => { if (!settled) { settled = true; resolve(id); } };

      const m = openModal({
        title: 'New album',
        body: `
          <label class="journal-modal-field">
            <span>Album name</span>
            <input id="ja-title" class="input" placeholder="Album name" autocomplete="off">
          </label>`,
        footer: `
          <button class="btn" data-otr-close>Cancel</button>
          <button class="btn btn-primary" id="ja-create">Create</button>`,
        onClose: () => finish(''),
      });

      const input = m.root.querySelector<HTMLInputElement>('#ja-title')!;
      input.focus();

      const submit = async () => {
        const title = input.value.trim();
        if (!title) { input.focus(); return; }
        try {
          const id = await journalAlbumStore.save({
            title,
            entryIds: seedEntryIds,
            coverEntryId: seedEntryIds[0] ?? null,
          });
          deps.requestRender();
          finish(typeof id === 'string' ? id : '');
          m.close();
        } catch (error) {
          console.error('Album create failed:', error);
          toast('Could not create album');
          finish('');
          m.close();
        }
      };

      m.root.querySelector('#ja-create')!.addEventListener('click', () => { void submit(); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } });
    });
  }

  /**
   * Write the designed cover onto the album.
   *
   * The headline is stored exactly as typed — empty means "keep following the
   * album's title", so renaming the album keeps renaming its cover.
   */
  async function saveCover(): Promise<void> {
    const edit = state.coverEdit;
    if (!edit) return;
    const draft = { ...edit.draft };
    // A picture chosen in the editor is still a local preview: put it on Storage first, so the
    // album only ever references a URL Storage has accepted (as entries' photos do).
    if (coverFile) {
      try {
        draft.photo = (await uploadJournalImage(coverFile, 0)).url;
      } catch (error) {
        console.error('Cover upload failed:', error);
        toast('Could not upload the cover photo');
        return;
      }
    }
    releaseCoverPhoto();
    state.coverEdit = null;
    deps.requestRender();
    await journalAlbumStore.update(edit.albumId, {
      cover: { ...draft, lines: draft.lines.map((l) => l.trim()).filter(Boolean) },
    });
  }

  function releaseCoverPhoto() {
    const url = state.coverEdit?.draft.photo;
    if (coverFile && url?.startsWith('blob:')) URL.revokeObjectURL(url);
    coverFile = null;
  }

  /** The cover's text fields, read straight off the input as it is typed. */
  function syncCoverField(el: HTMLInputElement): boolean {
    const edit = state.coverEdit;
    if (!edit) return false;
    if (el.hasAttribute('data-cover-headline')) { edit.draft.headline = el.value; return true; }
    if (el.hasAttribute('data-cover-kicker')) { edit.draft.kicker = el.value; return true; }
    if (el.hasAttribute('data-cover-focal')) { edit.draft.focalY = Number(el.value) / 100; return true; }
    const lineAt = el.dataset.coverLine;
    if (lineAt !== undefined) {
      const lines = [...edit.draft.lines];
      lines[Number(lineAt)] = el.value;
      edit.draft.lines = lines;
      return true;
    }
    return false;
  }

  function renameAlbum(albumId: string): void {
    const album = albums().find((a) => a.id === albumId);
    if (!album) return;

    const m = openModal({
      title: 'Rename album',
      body: `
        <label class="journal-modal-field">
          <span>Album name</span>
          <input id="ja-title" class="input" value="${escHtml(album.title)}" autocomplete="off">
        </label>`,
      footer: `
        <button class="btn" data-otr-close>Cancel</button>
        <button class="btn btn-primary" id="ja-save">Save</button>`,
    });

    const input = m.root.querySelector<HTMLInputElement>('#ja-title')!;
    input.focus();
    input.select();

    const submit = async () => {
      const title = input.value.trim();
      if (!title || title === album.title) { m.close(); return; }
      try {
        await journalAlbumStore.update(albumId, { title });
        deps.requestRender();
      } catch (error) {
        console.error('Album rename failed:', error);
        toast('Could not rename album');
      }
      m.close();
    };

    m.root.querySelector('#ja-save')!.addEventListener('click', () => { void submit(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } });
  }

  function deleteAlbum(albumId: string): void {
    const album = albums().find((a) => a.id === albumId);
    if (!album) return;

    // Deleting an album never deletes its entries — say so, because "delete
    // album" reads as destructive and here it isn't.
    const m = openModal({
      title: 'Delete album',
      body: `<p class="journal-modal-text">Delete “${escHtml(album.title)}”? Its entries are kept — only the album itself goes away.</p>`,
      footer: `
        <button class="btn" data-otr-close>Cancel</button>
        <button class="btn btn-danger" id="ja-delete">Delete</button>`,
    });

    m.root.querySelector('#ja-delete')!.addEventListener('click', async () => {
      try {
        await journalAlbumStore.remove(albumId);
        if (state.openAlbumId === albumId) state.openAlbumId = null;
        deps.requestRender();
      } catch (error) {
        console.error('Album delete failed:', error);
        toast('Could not delete album');
      }
      m.close();
    });
  }

  /** Handle an album <select> value: '' = ignore, '__new__' = create, else add. */
  async function addEntriesToAlbum(value: string, entryIds: string[]) {
    if (!value || entryIds.length === 0) return;
    if (value === '__new__') {
      await createAlbum(entryIds);
      return;
    }
    const album = albums().find((a) => a.id === value);
    if (!album) return;
    try {
      await journalAlbumStore.addEntries(album, entryIds);
      deps.requestRender();
    } catch (error) {
      console.error('Album add failed:', error);
      toast('Could not add to album');
    }
  }

  async function addSelectionToAlbum(value: string) {
    const picked = state.selection ?? [];
    if (!value || picked.length === 0) return;
    await addEntriesToAlbum(value, picked);
    // Leave select mode on success — the batch is done.
    state.selection = null;
    deps.requestRender();
  }

  /**
   * Ask the model to propose albums for the current entries.
   *
   * Nothing is written here — the result lands in `state.tidy` for the user to
   * accept one by one. See ai-classify.ts for why it works that way.
   */
  async function runTidy() {
    if (state.tidyLoading) return;
    state.tidyLoading = true;
    state.tidy = null;
    deps.requestRender();
    try {
      state.tidy = await suggestTidy(deps.getEntries());
    } catch (error) {
      console.error('Journal tidy failed:', error);
      toast('Could not get suggestions');
    } finally {
      state.tidyLoading = false;
      deps.requestRender();
    }
  }

  /** Turn one accepted suggestion into a real album, and drop it from the list. */
  async function acceptTidyAlbum(index: number) {
    const suggestion: AlbumSuggestion | undefined = state.tidy?.albums[index];
    if (!suggestion) return;
    try {
      await journalAlbumStore.save({
        title: suggestion.title,
        emoji: suggestion.emoji,
        entryIds: suggestion.entryIds,
        coverEntryId: suggestion.entryIds[0] ?? null,
      });
      if (state.tidy) {
        state.tidy = {
          ...state.tidy,
          albums: state.tidy.albums.filter((_, i) => i !== index),
        };
      }
      deps.requestRender();
    } catch (error) {
      console.error('Album create from suggestion failed:', error);
      toast('Could not create album');
    }
  }

  async function removeFromAlbum(albumId: string, entryId: string) {
    const album = albums().find((a) => a.id === albumId);
    if (!album || !entryId) return;
    try {
      await journalAlbumStore.removeEntry(album, entryId);
      deps.requestRender();
    } catch (error) {
      console.error('Album remove failed:', error);
      toast('Could not remove from album');
    }
  }

  async function toggleFavorite(id: string) {
    const entry = deps.getEntries().find((item) => item.id === id);
    if (!entry) return;
    await journalStore.update(id, { favorite: !entry.favorite });
  }

  async function deleteEntry(id: string) {
    if (!confirm('Delete this note?')) return;
    if (state.editingId === id) resetDraft();
    if (state.readingId === id) { state.readingId = null; deps.requestRender(); }
    await journalStore.remove(id);
  }

  async function shareEntry(id: string) {
    const entry = deps.getEntries().find((item) => item.id === id);
    if (!entry) return;
    if (entry.visibility === 'public') {
      await copyLink(shareUrl(entry.slug));
      return;
    }
    const slug = entry.slug || slugifyEntry(entry);
    await journalStore.update(entry.id, { visibility: 'public', slug });
    await copyLink(shareUrl(slug));
  }

  /**
   * Add picked files to the draft, up to MAX_JOURNAL_IMAGES.
   *
   * Files are only previewed here (via object URLs) — the actual upload happens
   * on save, so abandoning a draft never leaves orphans in Storage.
   */
  async function loadDraftImages(input: HTMLInputElement) {
    const picked = [...(input.files ?? [])];
    // Clear the input so re-picking the same file still fires a change event.
    input.value = '';
    if (!picked.length) return;

    const room = MAX_JOURNAL_IMAGES - state.draft.images.length;
    if (room <= 0) {
      toast(`Up to ${MAX_JOURNAL_IMAGES} photos`);
      return;
    }
    const files = picked.slice(0, room);
    if (picked.length > room) toast(`Up to ${MAX_JOURNAL_IMAGES} photos`);

    syncDraftFromLiveShell();

    const added: string[] = [];
    for (const file of files) {
      const url = URL.createObjectURL(file);
      added.push(url);
      state.draft.images.push(url);
      state.draft.pendingFiles.push(file);
      state.draft.imageRatios.push(undefined);
    }
    deps.requestRender();
    // Measure the new photos now, while the file is in memory; save only has to
    // fill in whatever failed. Looked up by URL, not index: the user may have
    // removed or reordered photos while this was loading.
    await Promise.all(added.map(async (url) => {
      const ratio = await measureRatio(url);
      const at = state.draft.images.indexOf(url);
      if (ratio && at >= 0) state.draft.imageRatios[at] = ratio;
    }));
  }

  /** The draft's shapes, with the entry's trusted `imageRatios` or the cache filling what it can. */
  function draftRatiosFor(entry: StoredJournalEntry): (number | undefined)[] {
    const own = storedRatios(entry);
    return entryImages(entry).map((url, i) => own?.[i] ?? cachedRatio(url));
  }

  /** Every photo's width / height for the entry being saved, or null if any could not be measured. */
  async function draftRatios(): Promise<number[] | null> {
    const { images, imageRatios } = state.draft;
    if (!images.length) return null;
    const out = await Promise.all(images.map(async (url, i) => {
      const known = imageRatios[i];
      if (known) return known;
      const measured = await measureRatio(url);
      if (measured) rememberRatio(url, measured);
      return measured;
    }));
    return out.every((r): r is number => typeof r === 'number') ? out : null;
  }

  /** Upload every pending file; returns the draft's photos as Storage URLs. */
  async function uploadDraftImages(): Promise<string[]> {
    const { images, pendingFiles } = state.draft;
    if (!pendingFiles.some(Boolean)) return images.filter(Boolean);

    state.draft.uploading = true;
    if (!state.posting) deps.requestRender();      // the envelope is mid-flight: leave the DOM alone
    try {
      const urls = await Promise.all(images.map(async (current, index) => {
        const file = pendingFiles[index];
        if (!file) return current;             // already a Storage URL
        const { url } = await uploadJournalImage(file, index);
        return url;
      }));
      return urls.filter(Boolean);
    } finally {
      state.draft.uploading = false;
    }
  }

  function removeDraftImage(index: number) {
    syncDraftFromLiveShell();
    const [removed] = state.draft.images.splice(index, 1);
    state.draft.pendingFiles.splice(index, 1);
    state.draft.imageRatios.splice(index, 1);
    // Only object URLs are ours to revoke; Storage URLs must survive.
    if (removed?.startsWith('blob:')) URL.revokeObjectURL(removed);
  }

  function moveDraftImage(index: number, delta: number) {
    const next = index + delta;
    const { images, pendingFiles, imageRatios } = state.draft;
    if (next < 0 || next >= images.length) return;
    syncDraftFromLiveShell();
    [images[index], images[next]] = [images[next], images[index]];
    [pendingFiles[index], pendingFiles[next]] = [pendingFiles[next], pendingFiles[index]];
    [imageRatios[index], imageRatios[next]] = [imageRatios[next], imageRatios[index]];
  }

}

function collectTags(entries: StoredJournalEntry[]): string[] {
  return [...new Set(entries.flatMap((entry) => entry.tags))];
}

function buildTagGroups(entries: StoredJournalEntry[]): TagGroup[] {
  const map = new Map<string, StoredJournalEntry[]>();
  for (const entry of entries) {
    for (const tag of entry.tags) {
      const list = map.get(tag) ?? [];
      list.push(entry);
      map.set(tag, list);
    }
  }

  return [...map.entries()]
    .map(([tag, groupEntries]) => ({ tag, entries: sortEntries(groupEntries) }))
    .sort((a, b) => b.entries.length - a.entries.length || a.tag.localeCompare(b.tag))
    .slice(0, 8);
}

function buildCalendarCells(monthKey: string, entries: StoredJournalEntry[]): CalendarCell[] {
  const [year, month] = monthKey.split('-').map(Number);
  const first = new Date(year, month - 1, 1);
  const firstWeekday = (first.getDay() + 6) % 7; // Mon=0 … Sun=6
  const start = new Date(year, month - 1, 1 - firstWeekday);
  const byDate = new Map<string, StoredJournalEntry[]>();

  for (const entry of entries) {
    const list = byDate.get(entry.happenedOn) ?? [];
    list.push(entry);
    byDate.set(entry.happenedOn, sortEntries(list));
  }

  // Build cells week by week; stop after the week that contains the last day of the month.
  const lastDay = new Date(year, month, 0); // last day of this month
  const cells: CalendarCell[] = [];
  for (let index = 0; ; index++) {
    const cell = new Date(start);
    cell.setDate(start.getDate() + index);
    const iso = cell.toISOString().slice(0, 10);
    const inMonth = cell.getMonth() === month - 1;
    cells.push({ iso, day: cell.getDate(), inMonth, entries: byDate.get(iso) ?? [] });
    // Stop at a week boundary once we've passed the last day of the month.
    if (cell >= lastDay && (index + 1) % 7 === 0) break;
  }
  return cells;
}

async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  } catch {
    toast(url);
  }
}

/**
 * Where the form fields are. The Journal view wraps everything in `.journal-shell`; the
 * Dashboard's "write an entry" overlay mounts only the composer, so there the root is the
 * overlay itself. (Without this fallback nothing in that overlay — save, mood, date, photos —
 * did anything.)
 */
function shellOf(root: HTMLElement): HTMLElement {
  return root.querySelector<HTMLElement>('.journal-shell') ?? root;
}

/** The body grows with what is written, so the whole letter scrolls rather than the textarea. */
function autosize(el: HTMLTextAreaElement | HTMLElement | null) {
  if (!(el instanceof HTMLTextAreaElement)) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

function focusComposer(scroll = false) {
  queueMicrotask(() => {
    // The composer renders inside `.journal-composer-overlay`, which is
    // `position: fixed` and already centered in the viewport. Calling
    // scrollIntoView on it doesn't bring it into view (it's never out of
    // view) — it scrolls the PAGE BEHIND the overlay instead, which read as
    // the journal "jumping back to the list" the moment the editor opened.
    // Only scroll when the composer is actually in normal document flow.
    if (scroll) {
      const composer = document.querySelector('.journal-composer');
      const isFixedOverlay = !!composer?.closest('.journal-composer-overlay');
      if (composer && !isFixedOverlay && typeof composer.scrollIntoView === 'function') {
        composer.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
    const body = document.getElementById('journal-body');
    autosize(body);
    body?.focus();
  });
}

let toastTimer: number | undefined;
function toast(message: string) {
  let element = document.getElementById('journal-toast');
  if (!element) {
    element = document.createElement('div');
    element.id = 'journal-toast';
    element.className = 'journal-toast';
    document.body.appendChild(element);
  }
  element.textContent = message;
  element.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => element?.classList.remove('is-visible'), 2200);
}
