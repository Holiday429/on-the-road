import { describe, expect, it } from 'vitest';
import { overviewMarkup, countryMarkup, emptyMarkup, countryTip, hoverCardText, replayMarkup, type WorldLayer } from './world-panel.ts';
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
const base = { model, mode: 'count' as const, layers: new Set<WorldLayer>(['routes', 'cities']), spin: false, canReplay: true, onlyTripId: null, currentTripId: 'a', unlocated: [], passport: { earned: 3, countries: 1 }, locale: 'en-US' };

describe('overviewMarkup', () => {
  const html = overviewMarkup(base);
  it('shows totals that exclude the planned country', () => {
    expect(html).toContain('map-stat-num">1<');   // countries
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
  it('marks the colour mode', () => {
    expect(html).toMatch(/map-scope-btn active" data-color="count"/);
    expect(overviewMarkup({ ...base, mode: 'trip' })).toMatch(/map-scope-btn active" data-color="trip"/);
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

describe('layer toggles and hover card', () => {
  it('marks which layers are on', () => {
    const html = overviewMarkup({ ...base, layers: new Set<WorldLayer>(['routes']) });
    expect(html).toMatch(/map-layer-chip active" data-layer="routes"/);
    expect(html).toMatch(/map-layer-chip" data-layer="cities"/);
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
    const html = countryMarkup({ detail, extras: null, locale: 'en-US', stampHtml: (s) => `<i data-stamp="${s.id}"></i>` });
    expect(html).toContain('Denmark');
    expect(html).toContain('data-act="back"');
    expect(html).toContain('data-route-trip="a"');
    expect(html).toContain('data-act="guide"');
    expect(html.match(/data-stamp=/g)!.length).toBe(detail.stamps.length);
    expect(html).not.toContain('world.country');   // every key resolved
  });
  it('says so for a planned country', () => {
    const detail = buildCountryDetail('IT', legs, model, TODAY)!;
    expect(countryMarkup({ detail, extras: null, locale: 'en-US', stampHtml: () => '' })).toContain('Planned — not visited yet');
  });
});

describe('replay, spin', () => {
  it('offers replay only when there is a timeline, and shows the auto-spin switch state', () => {
    expect(overviewMarkup(base)).toContain('data-act="replay"');
    expect(overviewMarkup({ ...base, canReplay: false })).not.toContain('data-act="replay"');
    expect(overviewMarkup(base)).toMatch(/map-layer-chip" data-spin[^>]*aria-checked="false"/);
    expect(overviewMarkup({ ...base, spin: true })).toMatch(/map-layer-chip active" data-spin[^>]*aria-checked="true"/);
  });
  it('the replay panel shows running totals and a way out', () => {
    const html = replayMarkup(model.summary, 'en-US');
    expect(html).toContain('world-replay-stats');
    expect(html).toContain('data-act="replay-close"');
    expect(html).toContain('Replaying all trips');
  });
});

describe('country extras', () => {
  const detail = buildCountryDetail('DK', legs, model, TODAY)!;
  const render = (extras: Parameters<typeof countryMarkup>[0]['extras']) => countryMarkup({ detail, extras, locale: 'en-US', stampHtml: () => '' });

  it('shows nothing extra until there is something to show', () => {
    const html = render({ journalCount: 0, covers: [], spend: [], spendTotal: null, nomadCount: 0, guideCount: 0 });
    expect(html).not.toContain('world-covers');
    expect(html).not.toContain('world-spend');
    expect(html).not.toContain('world-saved');
  });
  it('shows journal count with photos, per-trip spend, and saved places', () => {
    const html = render({
      journalCount: 3, covers: ['https://x.test/a.jpg', 'javascript:alert(1)'],
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
      journalCount: 0, covers: [],
      spend: [{ tripId: 'a', currency: 'EUR', total: 100, count: 1 }, { tripId: 'b', currency: 'EUR', total: 50, count: 1 }],
      spendTotal: { currency: 'EUR', total: 150 }, nomadCount: 0, guideCount: 0,
    });
    expect(html).toContain('world-spend-total');
    expect(html).toContain('€150');
  });
});

describe('misc', () => {
  it('has an empty state and pluralised tooltips', () => {
    expect(emptyMarkup()).toContain('No stops on the map yet');
    expect(countryTip('Denmark', '🇩🇰', 1, false)).toBe('🇩🇰 Denmark · 1 visit');
    expect(countryTip('Denmark', '🇩🇰', 3, false)).toBe('🇩🇰 Denmark · 3 visits');
    expect(countryTip('Italy', '', 0, true)).toBe('Italy · planned');
  });
});
