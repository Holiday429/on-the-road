import { describe, expect, it } from 'vitest';
import type { Leg as SchemaLeg, Clip } from '../../data/schema.ts';
import {
  stayPriceLabel, transportPriceLabel, stayBookingHref,
  baggageLabel, clipImages, legPlanTitleSet, coverPosition, cityHue, legStays,
} from './itinerary-utils.ts';

type Accommodation = NonNullable<SchemaLeg['accommodations']>[number];
type Transport = NonNullable<SchemaLeg['arrivalTransport']>;
type Leg = SchemaLeg & { id: string };

const acc = (o: Partial<Accommodation>) => o as Accommodation;
const trn = (o: Partial<Transport>) => o as Transport;

describe('stayPriceLabel', () => {
  it('formats a structured price with the accommodation currency symbol', () => {
    expect(stayPriceLabel(acc({ priceAmount: 120, priceCurrency: 'USD' }), 'EUR')).toBe('$120');
  });
  it('falls back to the trip base currency when the stay has no own currency', () => {
    expect(stayPriceLabel(acc({ priceAmount: 90 }), 'EUR')).toBe('€90');
  });
  it('uses the legacy free-text price when no structured amount exists', () => {
    expect(stayPriceLabel(acc({ price: '~$200/night' }), 'EUR')).toBe('~$200/night');
  });
  it('returns empty string when there is no price at all', () => {
    expect(stayPriceLabel(acc({}), 'EUR')).toBe('');
  });
  it('treats a zero price (structured or legacy text) as no price', () => {
    expect(stayPriceLabel(acc({ priceAmount: 0 }), 'EUR')).toBe('');
    expect(stayPriceLabel(acc({ price: '0' }), 'EUR')).toBe('');
    expect(stayPriceLabel(acc({ price: '€0.00' }), 'EUR')).toBe('');
    expect(stayPriceLabel(acc({ price: '$20' }), 'EUR')).toBe('$20');
    expect(stayPriceLabel(acc({ price: '100' }), 'EUR')).toBe('100');
  });
});

describe('transportPriceLabel', () => {
  it('formats a structured transport price', () => {
    expect(transportPriceLabel(trn({ priceAmount: 39, priceCurrency: 'GBP' }), 'EUR')).toBe('£39');
  });
  it('falls back to the base currency, then to legacy text, then to empty', () => {
    expect(transportPriceLabel(trn({ priceAmount: 39 }), 'EUR')).toBe('€39');
    expect(transportPriceLabel(trn({ price: 'from €19' }), 'EUR')).toBe('from €19');
    expect(transportPriceLabel(trn({}), 'EUR')).toBe('');
  });
});

describe('stayBookingHref', () => {
  it('passes through an absolute http(s) url unchanged', () => {
    expect(stayBookingHref(acc({ bookingUrl: 'https://booking.com/x' }))).toBe('https://booking.com/x');
    expect(stayBookingHref(acc({ bookingUrl: 'http://foo.test' }))).toBe('http://foo.test');
  });
  it('prepends https:// to a bare host', () => {
    expect(stayBookingHref(acc({ bookingUrl: 'airbnb.com/rooms/42' }))).toBe('https://airbnb.com/rooms/42');
  });
  it('trims surrounding whitespace before deciding', () => {
    expect(stayBookingHref(acc({ bookingUrl: '  https://a.test  ' }))).toBe('https://a.test');
  });
  it('returns empty string for a missing/blank url (no "https://" from nothing)', () => {
    expect(stayBookingHref(acc({}))).toBe('');
    expect(stayBookingHref(acc({ bookingUrl: '   ' }))).toBe('');
  });
});

describe('baggageLabel', () => {
  it('lists all three allowances in kg (grams → kg)', () => {
    expect(baggageLabel(trn({ baggagePersonalG: 5000, baggageCarryOnG: 10000, baggageCheckedG: 23000 })))
      .toBe('Personal 5 · Carry-on 10 · Checked 23 kg');
  });
  it('treats a legacy single allowance as carry-on', () => {
    expect(baggageLabel(trn({ baggageAllowanceG: 8000 }))).toBe('Carry-on 8 kg');
  });
  it('prefers the explicit carry-on over the legacy field', () => {
    expect(baggageLabel(trn({ baggageCarryOnG: 12000, baggageAllowanceG: 7000 }))).toBe('Carry-on 12 kg');
  });
  it('returns empty string when no allowances are set', () => {
    expect(baggageLabel(trn({}))).toBe('');
  });
});

describe('clipImages', () => {
  it('returns the multi-image array when present', () => {
    expect(clipImages({ imageUrls: ['a', 'b'] } as Clip)).toEqual(['a', 'b']);
  });
  it('migrates a legacy single imageUrl into a one-element array', () => {
    expect(clipImages({ imageUrl: 'legacy' } as Clip)).toEqual(['legacy']);
  });
  it('prefers imageUrls over the legacy imageUrl', () => {
    expect(clipImages({ imageUrls: ['new'], imageUrl: 'old' } as Clip)).toEqual(['new']);
  });
  it('returns an empty array when a clip has no images', () => {
    expect(clipImages({} as Clip)).toEqual([]);
  });
});

describe('legPlanTitleSet', () => {
  it('slugs plan titles into a set for dedup lookups', () => {
    const leg = { plans: [{ title: 'Eiffel Tower' }, { title: 'Louvre Museum' }] } as Leg;
    const set = legPlanTitleSet(leg);
    expect(set.has('eiffel-tower')).toBe(true);
    expect(set.has('louvre-museum')).toBe(true);
    expect(set.size).toBe(2);
  });
  it('falls back to a trimmed lowercase title when slugging yields empty', () => {
    // A title of only punctuation slugs to '' → falls back to trimmed lowercase.
    const leg = { plans: [{ title: '  !!!  ' }] } as Leg;
    expect(legPlanTitleSet(leg).has('!!!')).toBe(true);
  });
  it('returns an empty set for a leg with no plans', () => {
    expect(legPlanTitleSet({} as Leg).size).toBe(0);
  });
});

describe('coverPosition', () => {
  it('defaults to centre', () => {
    expect(coverPosition({})).toBe('center 50%');
  });
  it('maps and clamps the focal point', () => {
    expect(coverPosition({ coverFocalY: 0.25 })).toBe('center 25%');
    expect(coverPosition({ coverFocalY: -1 })).toBe('center 0%');
    expect(coverPosition({ coverFocalY: 3 })).toBe('center 100%');
  });
});

describe('cityHue', () => {
  it('is stable, case/space-insensitive and in range', () => {
    expect(cityHue(' Berlin ')).toBe(cityHue('berlin'));
    const h = cityHue('Copenhagen');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
  });
});

describe('legStays resilience', () => {
  it('drops null entries rather than letting a caller read .name off one', () => {
    const leg = { accommodations: [null, { name: 'B', order: 1 }, undefined, { name: 'A', order: 0 }] };
    expect(legStays(leg as never).map((s) => s.name)).toEqual(['A', 'B']);
  });
});
