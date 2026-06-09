import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { journalStore, type StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import { cityStore } from '../../../data/stores/city-store.ts';
import type { GuideCard } from '../../../data/schema.ts';
import { journalTemplateStore } from '../../../data/stores/journal-template-store.ts';
import type { StoredLeg } from '../../../data/stores/route-store.ts';
import { coordsFor, primaryCity } from '../../map/geo.ts';
import {
  DEFAULT_TEMPLATE,
  builtinTemplate,
  normalizeTemplateId,
  templates,
  template,
  type JournalTemplateKind,
  type TemplateId,
} from '../templates.ts';
import { renderCapture, type CalendarCell, type MapPoint, type PlaceGroup, type TagGroup, type TemplateGroup } from './render.ts';
import { openCardPreview } from '../card/card-preview.ts';
import type { CaptureState, DraftState } from './types.ts';
import {
  currentCity,
  currentMonthKey,
  monthKeyFromIso,
  parseTags,
  prettyDate,
  shareUrl,
  shiftMonth,
  slugifyEntry,
  sortEntries,
} from '../shared/utils.ts';

interface CaptureControllerDeps {
  getEntries: () => StoredJournalEntry[];
  getLegs: () => StoredLeg[];
  requestRender: () => void;
}

export function createCaptureController(deps: CaptureControllerDeps) {
  const state: CaptureState = {
    view: 'feed',
    filter: { template: 'all', destination: 'all', tag: 'all', favoritesOnly: false },
    draft: defaultDraft(deps.getLegs()),
    templateBuilder: defaultTemplateBuilder('moment'),
    composerOpen: false,
    templateBuilderOpen: false,
    editingId: null,
    promptIndex: 0,
    calendarMonth: currentMonthKey(),
    gallerySquare: false,
  };

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
    const placeGroups = buildPlaceGroups(visibleEntries);
    const templateGroups = buildTemplateGroups(visibleEntries);
    const tagGroups = buildTagGroups(visibleEntries);
    const { points, route } = buildMapData(visibleEntries, deps.getLegs());
    const calendarCells = buildCalendarCells(state.calendarMonth, filteredEntries(allEntries, false));

    return renderCapture({
      state,
      allEntries,
      visibleEntries,
      allTags,
      destinations,
      placeGroups,
      templateGroups,
      tagGroups,
      mapPoints: points,
      mapRoute: route,
      calendarCells,
      currentMonthLabel: new Date(`${state.calendarMonth}-01T00:00:00`).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
      }),
      legs: deps.getLegs(),
      savedGuidePlaces: savedGuideCards(),
    });
  }

  let _boundRoot: HTMLElement | null = null;

  function bind(root: HTMLElement) {
    // Only attach listeners once per root element to prevent accumulation across re-renders.
    if (_boundRoot === root) return;
    _boundRoot = root;

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
        const liveShell = root.querySelector<HTMLElement>('.journal-shell');
        if (liveShell) void saveDraft(liveShell);
        return;
      }

      const cancelBtn = target.closest<HTMLElement>('[data-journal-cancel], [data-journal-close]');
      if (cancelBtn) {
        resetDraft();
        deps.requestRender();
        return;
      }

      const shuffleBtn = target.closest<HTMLElement>('[data-journal-shuffle]');
      if (shuffleBtn) {
        const liveShell = root.querySelector<HTMLElement>('.journal-shell');
        if (liveShell) syncDraftFromDom(liveShell);
        state.promptIndex += 1;
        deps.requestRender();
        focusComposer();
        return;
      }

      const stampBtn = target.closest<HTMLElement>('[data-stamp]');
      if (stampBtn) {
        state.templateBuilderOpen = false;
        openComposer(stampBtn.dataset.stamp as TemplateId);
        deps.requestRender();
        focusComposer();
        return;
      }

      // Close composer when clicking outside the drawer (on the overlay backdrop)
      if (target.matches('[data-journal-overlay]')) {
        resetDraft();
        deps.requestRender();
        return;
      }

      const openTemplateBuilderBtn = target.closest<HTMLElement>('[data-open-template-builder]');
      if (openTemplateBuilderBtn) {
        state.composerOpen = false;
        state.editingId = null;
        state.templateBuilderOpen = true;
        deps.requestRender();
        return;
      }

      const closeTemplateBuilderBtn = target.closest<HTMLElement>('[data-close-template-builder]');
      if (closeTemplateBuilderBtn) {
        state.templateBuilderOpen = false;
        deps.requestRender();
        return;
      }

      const saveTemplateBtn = target.closest<HTMLElement>('[data-save-template]');
      if (saveTemplateBtn) {
        const liveShell = root.querySelector<HTMLElement>('.journal-shell');
        if (liveShell) void saveTemplate(liveShell);
        return;
      }

      const viewBtn = target.closest<HTMLElement>('[data-journal-view]');
      if (viewBtn) {
        state.view = viewBtn.dataset.journalView as CaptureState['view'];
        deps.requestRender();
        return;
      }

      const templateBtn = target.closest<HTMLElement>('[data-filter-template]');
      if (templateBtn) {
        state.filter.template = (templateBtn.dataset.filterTemplate as TemplateId | 'all') ?? 'all';
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

      const galleryToggleBtn = target.closest<HTMLElement>('[data-gallery-square]');
      if (galleryToggleBtn) {
        state.gallerySquare = !state.gallerySquare;
        deps.requestRender();
        return;
      }

      const removeImageBtn = target.closest<HTMLElement>('[data-remove-image]');
      if (removeImageBtn) {
        const liveShell = root.querySelector<HTMLElement>('.journal-shell');
        if (liveShell) syncDraftFromDom(liveShell);
        state.draft.coverImage = '';
        deps.requestRender();
        return;
      }

      const quickChipBtn = target.closest<HTMLElement>('[data-append-body]');
      if (quickChipBtn) {
        const append = quickChipBtn.dataset.appendBody ?? '';
        appendToComposerBody(append);
        return;
      }

      const entryTarget = target.closest<HTMLElement>('[data-open-entry]');
      if (entryTarget) {
        loadEntryIntoDraft(entryTarget.dataset.openEntry!);
        deps.requestRender();
        focusComposer(true);
      }
    });

    root.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement | HTMLSelectElement;
      const liveShell = root.querySelector<HTMLElement>('.journal-shell');
      if (!liveShell) return;

      if (target.matches('[data-filter-destination]')) {
        state.filter.destination = target.value;
        deps.requestRender();
        return;
      }

      if (target.matches('#journal-image-input')) {
        syncDraftFromDom(liveShell);
        void loadDraftImage(target as HTMLInputElement);
        return;
      }

      if (target.matches('input[name="journal-template-kind"]')) {
        syncTemplateBuilderFromDom(liveShell);
        const selectedKind = (target as HTMLInputElement).value as JournalTemplateKind;
        const next = defaultTemplateBuilder(selectedKind);
        state.templateBuilder = {
          ...next,
          label: state.templateBuilder.label,
        };
        deps.requestRender();
        return;
      }

      if (target.name === 'journal-mood') {
        syncDraftFromDom(liveShell);
        deps.requestRender();
      }
    });

    root.addEventListener('keydown', (event) => {
      const keyEvent = event as KeyboardEvent;
      if (
        keyEvent.target instanceof HTMLTextAreaElement &&
        keyEvent.target.id === 'journal-body' &&
        (keyEvent.metaKey || keyEvent.ctrlKey) &&
        keyEvent.key === 'Enter'
      ) {
        keyEvent.preventDefault();
        const liveShell = root.querySelector<HTMLElement>('.journal-shell');
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
    if (state.filter.template !== 'all' && !templateIds.has(state.filter.template)) {
      state.filter.template = 'all';
    }
    if (!templateIds.has(normalizeTemplateId(state.draft.template))) {
      state.draft.template = DEFAULT_TEMPLATE;
    }
    if (state.editingId && !entries.some((entry) => entry.id === state.editingId)) {
      resetDraft();
    }
    if (!state.composerOpen && !state.draft.destination) {
      state.draft.destination = currentCity(deps.getLegs());
    }
  }

  let _leafletMap: L.Map | null = null;
  let _leafletMapEl: HTMLElement | null = null;

  function afterRender(root: HTMLElement) {
    const mapEl = root.querySelector<HTMLElement>('#journal-leaflet-map');
    if (!mapEl) {
      if (_leafletMap) { _leafletMap.remove(); _leafletMap = null; _leafletMapEl = null; }
      return;
    }

    const rawPoints = mapEl.dataset.points ?? '[]';

    // Re-use existing map only if it is attached to the exact same DOM element.
    if (_leafletMap && _leafletMapEl === mapEl) {
      _leafletMap.invalidateSize();
      return;
    }

    if (_leafletMap) { _leafletMap.remove(); _leafletMap = null; _leafletMapEl = null; }

    type RawPoint = { key: string; label: string; lat: number; lng: number; count: number };
    let points: RawPoint[] = [];
    try { points = JSON.parse(rawPoints); } catch { /* empty */ }

    const map = L.map(mapEl, { zoomControl: true, attributionControl: false });
    _leafletMap = map;
    _leafletMapEl = mapEl;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map);

    L.control.attribution({ prefix: '© <a href="https://www.openstreetmap.org/copyright">OSM</a>' }).addTo(map);

    if (points.length === 0) {
      map.setView([48, 6], 4);
      return;
    }

    const markers: L.Marker[] = [];
    for (const point of points) {
      const icon = L.divIcon({
        className: 'journal-lmap-pin',
        html: `<span class="journal-lmap-pin-count">${point.count}</span><span class="journal-lmap-pin-label">${point.label}</span>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });
      const marker = L.marker([point.lat, point.lng], { icon })
        .addTo(map)
        .on('click', () => {
          state.filter.destination = point.label;
          state.view = 'feed';
          deps.requestRender();
        });
      markers.push(marker);
    }

    const group = L.featureGroup(markers);
    map.fitBounds(group.getBounds().pad(0.25));

    // Wire sidebar list buttons to fly-to
    root.querySelectorAll<HTMLElement>('[data-map-focus]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.mapFocus!;
        const pt = points.find((p) => p.key === key);
        if (pt) map.flyTo([pt.lat, pt.lng], 11, { duration: 0.8 });
      });
    });
  }

  return {
    render,
    bind,
    handleDataChange,
    afterRender,
    currentView: () => state.view,
    openComposerForTemplate: (templateId: string) => {
      openComposer(templateId as TemplateId);
      deps.requestRender();
    },
  };

  function filteredEntries(entries: StoredJournalEntry[], applyCalendarMonth = true): StoredJournalEntry[] {
    return entries
      .filter((entry) => state.filter.template === 'all' || template(entry.template).id === state.filter.template)
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
      mood: 'spark',
      happenedOn: new Date().toISOString().slice(0, 10),
      coverImage: '',
      imageRatio: undefined,
      linkedPlaces: [],
    };
  }

  function defaultTemplateBuilder(kind: JournalTemplateKind) {
    const base = builtinTemplate(kind);
    return {
      kind,
      label: '',
      emoji: base.emoji,
      placeholder: base.placeholder,
      promptsText: base.prompts.join('\n'),
    };
  }

  function openComposer(templateId: TemplateId) {
    state.editingId = null;
    state.composerOpen = true;
    state.draft = defaultDraft(deps.getLegs());
    state.draft.template = templateId;
  }

  function resetDraft() {
    state.editingId = null;
    state.composerOpen = false;
    state.draft = defaultDraft(deps.getLegs());
    state.promptIndex += 1;
  }

  function loadEntryIntoDraft(id: string) {
    const entry = deps.getEntries().find((item) => item.id === id);
    if (!entry) return;
    state.editingId = id;
    state.composerOpen = true;
    state.draft = {
      body: entry.body,
      title: entry.title,
      template: template(entry.template).id as TemplateId,
      destination: entry.destination,
      tagsText: entry.tags.join(', '),
      mood: entry.mood ?? 'spark',
      happenedOn: entry.happenedOn,
      coverImage: entry.coverImage ?? '',
      imageRatio: entry.imageRatio,
      linkedPlaces: entry.linkedPlaces ?? [],
    };
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
      coverImage: state.draft.coverImage,
      imageRatio: state.draft.imageRatio,
      linkedPlaces: linkedChecked.length ? linkedChecked : state.draft.linkedPlaces,
    };
  }

  function syncTemplateBuilderFromDom(root: HTMLElement) {
    state.templateBuilder = {
      kind: ((root.querySelector('input[name="journal-template-kind"]:checked') as HTMLInputElement | null)?.value as JournalTemplateKind) ?? state.templateBuilder.kind,
      label: root.querySelector<HTMLInputElement>('#journal-template-label')?.value ?? state.templateBuilder.label,
      emoji: root.querySelector<HTMLInputElement>('#journal-template-emoji')?.value ?? state.templateBuilder.emoji,
      placeholder: root.querySelector<HTMLInputElement>('#journal-template-placeholder')?.value ?? state.templateBuilder.placeholder,
      promptsText: root.querySelector<HTMLTextAreaElement>('#journal-template-prompts')?.value ?? state.templateBuilder.promptsText,
    };
  }

  async function saveDraft(root: HTMLElement) {
    syncDraftFromDom(root);
    if (!state.draft.body.trim()) {
      focusComposer();
      return;
    }

    const currentTemplate = template(state.draft.template);
    const payload: Record<string, unknown> = {
      title: state.draft.title.trim(),
      body: state.draft.body.trim(),
      template: state.draft.template,
      destination: currentTemplate.fields.destination ? state.draft.destination.trim() : '',
      tags: currentTemplate.fields.tags ? parseTags(state.draft.tagsText) : [],
      happenedOn: state.draft.happenedOn || new Date().toISOString().slice(0, 10),
      coverImage: state.draft.coverImage || '',
    };
    if (currentTemplate.fields.mood) payload.mood = state.draft.mood;
    if (state.draft.coverImage && typeof state.draft.imageRatio === 'number') {
      payload.imageRatio = state.draft.imageRatio;
    }
    if (state.draft.linkedPlaces.length) payload.linkedPlaces = state.draft.linkedPlaces;

    try {
      if (state.editingId) await journalStore.update(state.editingId, payload);
      else await journalStore.save({ ...payload, favorite: false, visibility: 'private', slug: '' });
    } catch (error) {
      console.error('Journal save failed:', error);
      toast('Could not save');
      return;
    }

    resetDraft();
    deps.requestRender();
  }

  async function saveTemplate(root: HTMLElement) {
    syncTemplateBuilderFromDom(root);
    const prompts = state.templateBuilder.promptsText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 5);
    if (!state.templateBuilder.label.trim()) {
      toast('Template label needed');
      return;
    }

    try {
      await journalTemplateStore.save({
        label: state.templateBuilder.label.trim(),
        emoji: state.templateBuilder.emoji.trim() || builtinTemplate(state.templateBuilder.kind).emoji,
        kind: state.templateBuilder.kind,
        placeholder: state.templateBuilder.placeholder.trim() || builtinTemplate(state.templateBuilder.kind).placeholder,
        prompts: prompts.length ? prompts : builtinTemplate(state.templateBuilder.kind).prompts,
        tint: builtinTemplate(state.templateBuilder.kind).tint,
      });
      state.templateBuilder = defaultTemplateBuilder(state.templateBuilder.kind);
      state.templateBuilderOpen = false;
      deps.requestRender();
    } catch (error) {
      console.error('Template save failed:', error);
      toast('Could not save template');
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

  async function loadDraftImage(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      state.draft.coverImage = dataUrl;
      state.draft.imageRatio = await measureImageRatio(dataUrl);
      deps.requestRender();
    } catch (error) {
      console.error('Image load failed:', error);
      toast('Could not load image');
    }
  }

  function appendToComposerBody(append: string) {
    const textarea = document.getElementById('journal-body') as HTMLTextAreaElement | null;
    if (!textarea) {
      state.draft.body = state.draft.body ? `${state.draft.body}${append}` : append;
      focusComposer();
      return;
    }

    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const value = textarea.value;
    const nextValue = `${value.slice(0, start)}${append}${value.slice(end)}`;

    textarea.value = nextValue;
    state.draft.body = nextValue;

    const nextCursor = start + append.length;
    textarea.focus();
    textarea.setSelectionRange(nextCursor, nextCursor);
  }
}

function collectTags(entries: StoredJournalEntry[]): string[] {
  return [...new Set(entries.flatMap((entry) => entry.tags))];
}

function buildPlaceGroups(entries: StoredJournalEntry[]): PlaceGroup[] {
  const map = new Map<string, PlaceGroup>();
  for (const entry of entries) {
    const label = entry.destination.trim() || 'No place yet';
    const key = label.toLowerCase();
    const group = map.get(key) ?? { key, label, summary: '', entries: [] };
    group.entries.push(entry);
    map.set(key, group);
  }

  return [...map.values()]
    .map((group) => {
      const sorted = sortEntries(group.entries);
      const oldest = sorted[sorted.length - 1];
      const newest = sorted[0];
      return {
        ...group,
        entries: sorted,
        summary: oldest && newest
          ? oldest.happenedOn === newest.happenedOn
            ? prettyDate(newest.happenedOn)
            : `${prettyDate(oldest.happenedOn)} → ${prettyDate(newest.happenedOn)}`
          : 'No dated entries yet',
      };
    })
    .sort((a, b) => b.entries[0].happenedOn.localeCompare(a.entries[0].happenedOn));
}

function buildTemplateGroups(entries: StoredJournalEntry[]): TemplateGroup[] {
  return templates()
    .map((item) => {
      const groupEntries = entries.filter((entry) => template(entry.template).id === item.id);
      return { templateId: item.id, entries: groupEntries, topTags: topTagsFor(groupEntries).slice(0, 3) };
    })
    .filter((group) => group.entries.length > 0);
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

function topTagsFor(entries: StoredJournalEntry[]): string[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const tag of entry.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);
}

function buildMapData(entries: StoredJournalEntry[], legs: StoredLeg[]) {
  const pointMap = new Map<string, { key: string; label: string; lat: number; lng: number; entries: StoredJournalEntry[] }>();
  for (const entry of entries) {
    const label = entry.destination.trim();
    if (!label) continue;
    const coords = coordsFor(label);
    if (!coords) continue;
    const key = primaryCity(label).toLowerCase();
    const point = pointMap.get(key) ?? { key, label, lat: coords.lat, lng: coords.lng, entries: [] };
    point.entries.push(entry);
    pointMap.set(key, point);
  }

  const routeCoords = legs
    .map((leg) => {
      const coords = coordsFor(leg.city);
      if (!coords) return null;
      return { lat: coords.lat, lng: coords.lng };
    })
    .filter(Boolean) as Array<{ lat: number; lng: number }>;

  const pointSource = [...pointMap.values()];
  const boundsSource = [...pointSource.map((point) => ({ lat: point.lat, lng: point.lng })), ...routeCoords];

  if (!boundsSource.length) return { points: [] as MapPoint[], route: [] as Array<{ left: number; top: number }> };

  const bounds = mapBounds(boundsSource);
  const points = pointSource
    .map((point) => ({
      key: point.key,
      label: point.label,
      count: point.entries.length,
      lat: point.lat,
      lng: point.lng,
      left: projectLng(point.lng, bounds),
      top: projectLat(point.lat, bounds),
      entries: sortEntries(point.entries),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const route = routeCoords.map((coords) => ({
    left: projectLng(coords.lng, bounds),
    top: projectLat(coords.lat, bounds),
  }));

  return { points, route };
}

function mapBounds(points: Array<{ lat: number; lng: number }>) {
  if (points.length === 1) {
    return {
      minLat: points[0].lat - 2,
      maxLat: points[0].lat + 2,
      minLng: points[0].lng - 2,
      maxLng: points[0].lng + 2,
    };
  }
  return {
    minLat: Math.min(...points.map((point) => point.lat)) - 1.5,
    maxLat: Math.max(...points.map((point) => point.lat)) + 1.5,
    minLng: Math.min(...points.map((point) => point.lng)) - 2,
    maxLng: Math.max(...points.map((point) => point.lng)) + 2,
  };
}

function projectLng(lng: number, bounds: ReturnType<typeof mapBounds>) {
  return ((lng - bounds.minLng) / Math.max(0.1, bounds.maxLng - bounds.minLng)) * 100;
}

function projectLat(lat: number, bounds: ReturnType<typeof mapBounds>) {
  return 100 - (((lat - bounds.minLat) / Math.max(0.1, bounds.maxLat - bounds.minLat)) * 100);
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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(String(event.target?.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function measureImageRatio(src: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : undefined);
    img.onerror = () => resolve(undefined);
    img.src = src;
  });
}

function focusComposer(scroll = false) {
  queueMicrotask(() => {
    if (scroll) {
      document.querySelector('.journal-composer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    document.getElementById('journal-body')?.focus();
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
