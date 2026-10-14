import { describe, expect, it } from 'vitest';
import { overviewMarkup, countryMarkup, emptyMarkup, countryTip, hoverCardText, replayMarkup, hudStatsMarkup, settingsMarkup, nextStopMarkup, lensMarkup, ribbonMarkup, type AtlasSwitch } from './world-panel.ts';
import { buildWorldModel } from './world-model.ts';
import { buildCountryDetail } from './country-model.ts';
import type { PlottedLeg } from '../map/map-stats.ts';

const legs: PlottedLeg[] = [
  { id: '1', city: 'Copenhagen', country: 'Denmark', flag: '🇩🇰', dateFrom: '2026-04-01', dateTo: '2026-04-05', lat: 55, lng: 12, iso: 'DK', tripId: 'a', stops: [{ key: 'copenhagen', name: 'Copenhagen', lat: 55, lng: 12 }] },
  { id: '2', city: 'Rome', country: 'Italy', flag: '🇮🇹', dateFrom: '2026-12-01', dateTo: '2026-12-05', lat: 41, lng: 12, iso: 'IT', tripId: 'b', stops: [{ key: 'rome', name: 'Rome', lat: 41, lng: 12 }] },
];
const trips = [
  { id: 'a', name: 'Spring <b>trip</b>', color: 'rgb(1,2,3)', startDate: '2026-04-01', endDate: '2026-04-05' },
  { id: 'b', name: 'Winter', color: 'rgb(4,5,6)', startDate: '2026-12-01', endDate: '2026-12-05' },
];
const TODAY = '2026-07-10';
const model = buildWorldModel(legs, trips, TODAY);
const base = { model, canReplay: true, onlyTripId: null, currentTripId: 'a', unlocated: [], passport: { earned: 3, countries: 1 }, locale: 'en-US' };

describe('overviewMarkup', () => {
  const html = overviewMarkup(base);
  it('leaves the totals to the header line (no cards, no layer switches)', () => {
    expect(html).not.toContain('map-stat-num');
    expect(html).not.toContain('data-switch');
  });
  it('offers "open current route" only when the current trip has stops', () => {
    expect(html).toContain('data-act="open-route"');
    expect(overviewMarkup({ ...base, currentTripId: 'zzz' })).not.toContain('data-act="open-route"');
    expect(overviewMarkup({ ...base, currentTripId: null })).not.toContain('data-act="open-route"');
  });
  it('lists every trip as a chip and marks the active filter', () => {
    expect(html.match(/data-trip="/g)).toHaveLength(2);
    expect(overviewMarkup({ ...base, onlyTripId: 'b' })).toMatch(/world-trip active[^>]*data-trip="b"/);
  });
  it('lists countries as buttons and tags the planned one', () => {
    expect(html).toContain('data-country="DK"');
    expect(html).toMatch(/world-country planned" data-country="IT"/);
  });
  it('shows the passport card only when there are stamps', () => {
    expect(html).toContain('data-open-passport');
    expect(overviewMarkup({ ...base, passport: null })).not.toContain('data-open-passport');
  });
  it('escapes trip names', () => {
    expect(html).not.toContain('<b>trip</b>');
    expect(html).toContain('&lt;b&gt;');
  });
  it('lists stops that could not be placed', () => {
    expect(overviewMarkup({ ...base, unlocated: [{ legId: 'x', place: 'Nowhere' }] })).toContain('<li>Nowhere</li>');
  });
});

describe('header totals, settings and hover card', () => {
  it('the header line counts only what has been visited, and follows the model', () => {
    const html = hudStatsMarkup(model.summary, 'en-US');
    expect(html).toContain('<b>1</b> Countries');       // Italy is only planned
    expect(html).toContain('Trips');
    expect(html.match(/atlas-stat/g)).toHaveLength(6);
  });
  it('settings mark which switches are on', () => {
    const html = settingsMarkup(new Set<AtlasSwitch>(['routes', 'night']));
    expect(html).toMatch(/map-layer-chip active" data-switch="routes"[^>]*aria-checked="true"/);
    expect(html).toMatch(/map-layer-chip" data-switch="cities"[^>]*aria-checked="false"/);
    expect(html).toMatch(/map-layer-chip active" data-switch="night"/);
    expect(html).toMatch(/map-layer-chip" data-switch="spin"/);
  });
  it('hover card: name, visits and nights; only the name for a planned country', () => {
    const rec = { name: 'Denmark', flag: '🇩🇰', state: 'visited' as const, visits: 2, nights: 27 };
    expect(hoverCardText(rec)).toBe('🇩🇰 Denmark · 2 visits · 27 nights');
    expect(hoverCardText({ ...rec, visits: 1, nights: 1 })).toBe('🇩🇰 Denmark · 1 visit · 1 night');
    expect(hoverCardText({ ...rec, state: 'planned', visits: 0, nights: 0 })).toBe('🇩🇰 Denmark · planned');
  });
});

describe('countryMarkup', () => {
  it('shows header, stats, stamps, trips and the route/back actions', () => {
    const detail = buildCountryDetail('DK', legs, model, TODAY)!;
    const html = countryMarkup({ detail, pending: false, extras: null, locale: 'en-US', stampHtml: (s) => `<i data-stamp="${s.id}"></i>` });
    expect(html).toContain('Denmark');
    expect(html).toContain('data-act="back"');
    expect(html).toContain('data-route-trip="a"');
    expect(html).toContain('data-act="guide"');
    expect(html.match(/data-stamp=/g)!.length).toBe(detail.stamps.length);
    expect(html).not.toContain('world.country');   // every key resolved
  });
  it('says so for a planned country', () => {
    const detail = buildCountryDetail('IT', legs, model, TODAY)!;
    expect(countryMarkup({ detail, pending: false, extras: null, locale: 'en-US', stampHtml: () => '' })).toContain('Planned — not visited yet');
  });
});

describe('replay', () => {
  it('offers replay only when there is a timeline', () => {
    expect(overviewMarkup(base)).toContain('data-act="replay"');
    expect(overviewMarkup({ ...base, canReplay: false })).not.toContain('data-act="replay"');
  });
  it('the replay panel is a title and a way out', () => {
    const html = replayMarkup();
    expect(html).toContain('data-act="replay-close"');
    expect(html).toContain('Replaying all trips');
  });
});

describe('country extras', () => {
  const detail = buildCountryDetail('DK', legs, model, TODAY)!;
  const render = (extras: Parameters<typeof countryMarkup>[0]['extras']) => countryMarkup({ detail, pending: false, extras, locale: 'en-US', stampHtml: () => '' });

  it('shows nothing extra until there is something to show', () => {
    const html = render({ journalCount: 0, entries: [], cityPhotos: [], photos: [], covers: [], spend: [], spendTotal: null, nomadCount: 0, guideCount: 0 });
    expect(html).not.toContain('world-covers');
    expect(html).not.toContain('world-spend');
    expect(html).not.toContain('world-saved');
  });
  it('shows journal count with photos, per-trip spend, and saved places', () => {
    const html = render({
      journalCount: 3, entries: [], cityPhotos: [], photos: [], covers: ['https://x.test/a.jpg', 'javascript:alert(1)'],
      spend: [{ tripId: 'a', currency: 'EUR', total: 150, count: 2 }, { tripId: 'b', currency: 'CNY', total: 900, count: 1 }],
      spendTotal: null, nomadCount: 2, guideCount: 1,
    });
    expect(html).toContain('3 entries');
    expect(html).toContain('src="https://x.test/a.jpg"');
    expect(html).not.toContain('javascript:');          // only http(s) photo URLs are rendered
    expect(html).toContain('€150');
    expect(html).toContain('900');
    expect(html).not.toContain('world-spend-total');    // two currencies → no grand total
    expect(html).toContain('2 work spots');
    expect(html).toContain('1 guide idea');
  });
  it('adds a total line only when several trips share one currency', () => {
    const html = render({
      journalCount: 0, entries: [], cityPhotos: [], photos: [], covers: [],
      spend: [{ tripId: 'a', currency: 'EUR', total: 100, count: 1 }, { tripId: 'b', currency: 'EUR', total: 50, count: 1 }],
      spendTotal: { currency: 'EUR', total: 150 }, nomadCount: 0, guideCount: 0,
    });
    expect(html).toContain('world-spend-total');
    expect(html).toContain('€150');
  });
});

describe('passport link, next stop, empty state', () => {
  const dk = buildCountryDetail('DK', legs, model, TODAY)!;
  const it_ = buildCountryDetail('IT', legs, model, TODAY)!;
  const render = (d: typeof dk, pending: boolean) => countryMarkup({ detail: d, pending, extras: null, locale: 'en-US', stampHtml: () => '' });

  it('a visited country links to the passport; the button invites pressing when a stamp is waiting', () => {
    const idle = render(dk, false);
    expect(idle).toMatch(/btn btn-ghost" data-act="passport" data-iso="DK">See in the passport/);
    const waiting = render(dk, true);
    expect(waiting).toMatch(/btn btn-primary" data-act="passport" data-iso="DK">Press the stamp/);
  });
  it('a country only planned has no passport button (nothing to stamp yet)', () => {
    expect(render(it_, false)).not.toContain('data-act="passport"');
  });
  it('the next-stop line opens the country, and says when', () => {
    const html = nextStopMarkup({ city: 'Lisbon', country: 'Portugal', flag: '🇵🇹', iso: 'PT', inDays: 12 });
    expect(html).toContain('data-country="PT"');
    expect(html).toContain('Next stop');
    expect(html).toContain('in 12 days');
    expect(nextStopMarkup({ city: 'Rome', country: 'Italy', flag: '', iso: 'IT', inDays: 1 })).toContain('tomorrow');
    expect(nextStopMarkup(null)).toBe('');
    expect(nextStopMarkup({ city: 'X', country: 'Y', flag: '', iso: null, inDays: 3 })).not.toContain('data-country');
  });
  it('the empty card points at the Itinerary', () => {
    const html = emptyMarkup();
    expect(html).toContain('data-act="open-itinerary"');
    expect(html).toContain('still blank');
  });
  it('settings include the intro switch', () => {
    expect(settingsMarkup(new Set<AtlasSwitch>(['intro']))).toMatch(/map-layer-chip active" data-switch="intro"/);
  });
});

describe('lenses and the year ribbon', () => {
  it('one chip per lens, the active one pressed', () => {
    const html = lensMarkup('trips');
    expect(html.match(/data-lens="/g)).toHaveLength(3);
    expect(html).toMatch(/atlas-lens active" data-lens="trips" aria-pressed="true"/);
    expect(html).toMatch(/atlas-lens" data-lens="footprint" aria-pressed="false"/);
    expect(html).toContain('Footprint');
  });
  const years = [{ year: 2025, trips: 2, planned: false }, { year: 2026, trips: 1, planned: true }];
  it('the ribbon has All and a button per year; the selected one is pressed; a future year is marked', () => {
    const html = ribbonMarkup(years, 2025, true);
    expect(html).toMatch(/atlas-year" data-year="" aria-pressed="false"/);
    expect(html).toMatch(/atlas-year active" data-year="2025" aria-pressed="true"/);
    expect(html).toMatch(/atlas-year planned" data-year="2026"/);
    expect(html).toContain('data-act="replay"');
    expect(ribbonMarkup(years, null, true)).toMatch(/atlas-year active" data-year="" aria-pressed="true"/);
  });
  it('no play button without a timeline, and no ribbon at all without years', () => {
    expect(ribbonMarkup(years, null, false)).not.toContain('data-act="replay"');
    expect(ribbonMarkup([], null, true)).toBe('');
  });
  it('shows a dot per trip, at most four', () => {
    expect(ribbonMarkup([{ year: 2024, trips: 9, planned: false }], null, false)).toContain('●●●●<');
  });
});

describe('misc', () => {
  it('has an empty state and pluralised tooltips', () => {
    expect(emptyMarkup()).toContain('still blank');
    expect(countryTip('Denmark', '🇩🇰', 1, false)).toBe('🇩🇰 Denmark · 1 visit');
    expect(countryTip('Denmark', '🇩🇰', 3, false)).toBe('🇩🇰 Denmark · 3 visits');
    expect(countryTip('Italy', '', 0, true)).toBe('Italy · planned');
  });
});
