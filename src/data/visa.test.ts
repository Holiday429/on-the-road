import { describe, expect, it } from 'vitest';
import { regionCovers, schengenDays, schengenUsage, visaUses, visaWarnings, SCHENGEN } from './visa.ts';
import type { FootprintLeg } from './footprint.ts';
import type { Visa } from './schema/visa.ts';

const leg = (id: string, country: string, from: string, to: string, tripId = 't1'): FootprintLeg =>
  ({ id, city: country, country, dateFrom: from, dateTo: to, tripId });

const visa = (over: Partial<Visa> = {}): Visa => ({
  id: 'v1', region: 'SCHENGEN', type: 'tourist', number: '', validFrom: '2026-06-01', validTo: '2026-09-30', notes: '', photoURL: '',
  createdAt: 0, updatedAt: 0, schemaVersion: 1, ...over,
});

describe('regionCovers', () => {
  it('a country covers itself; Schengen covers its 29 states and nothing else', () => {
    expect(regionCovers('JP', 'JP')).toBe(true);
    expect(regionCovers('jp', 'JP')).toBe(true);
    expect(regionCovers('JP', 'KR')).toBe(false);
    expect(SCHENGEN.size).toBe(29);
    expect(regionCovers('SCHENGEN', 'DE')).toBe(true);
    expect(regionCovers('SCHENGEN', 'GB')).toBe(false);
    expect(regionCovers('SCHENGEN', '')).toBe(false);
  });
});

describe('visaUses', () => {
  const legs = [
    leg('a', 'Denmark', '2026-06-25', '2026-07-05'),
    leg('b', 'United Kingdom', '2026-07-05', '2026-07-09'),
    leg('c', 'Germany', '2026-07-09', '2026-07-12'),
    leg('d', 'France', '2027-03-01', '2027-03-04', 't2'),
  ];
  it('lists the trips whose Schengen stops fall in the validity, with their countries', () => {
    expect(visaUses(visa(), legs)).toEqual([{ tripId: 't1', isos: ['DK', 'DE'] }]);
  });
  it('a visa with no dates covers nothing yet', () => {
    expect(visaUses(visa({ validFrom: '', validTo: '' }), legs)).toEqual([]);
  });
});

describe('visaWarnings', () => {
  it('a stay that starts inside the visa and ends after it', () => {
    const w = visaWarnings(visa({ validTo: '2026-07-01' }), [leg('a', 'Denmark', '2026-06-25', '2026-07-05')], '2026-06-01');
    expect(w).toMatchObject([{ kind: 'outlasts', date: '2026-07-01', tripId: 't1' }]);
  });
  it('stays that are already over, or that start after the visa, are not its business', () => {
    expect(visaWarnings(visa({ validTo: '2026-07-01' }), [leg('a', 'Denmark', '2026-06-25', '2026-07-05')], '2026-08-01')).toEqual([]);
    expect(visaWarnings(visa({ validTo: '2026-07-01' }), [leg('a', 'Denmark', '2026-08-25', '2026-09-05')], '2026-06-01')).toEqual([]);
  });
  it('back-to-back stops longer than one entry allows', () => {
    const legs = [leg('a', 'Denmark', '2026-07-01', '2026-07-20'), leg('b', 'Germany', '2026-07-20', '2026-08-10')];
    const w = visaWarnings(visa({ stayDays: 30 }), legs, '2026-06-01');
    expect(w).toMatchObject([{ kind: 'longStay', days: 41, date: '2026-07-01' }]);
    expect(visaWarnings(visa({ stayDays: 60 }), legs, '2026-06-01')).toEqual([]);
  });
  it('separate trips are separate stays', () => {
    const legs = [leg('a', 'Denmark', '2026-07-01', '2026-07-20', 't1'), leg('b', 'Germany', '2026-07-20', '2026-08-10', 't2')];
    expect(visaWarnings(visa({ stayDays: 30 }), legs, '2026-06-01')).toEqual([]);
  });
});

describe('Schengen 90/180', () => {
  it('counts arrival and departure days', () => {
    expect(schengenDays([leg('a', 'Denmark', '2026-07-01', '2026-07-03')]).size).toBe(3);
  });
  it('nothing without a Schengen stop', () => {
    expect(schengenUsage([leg('a', 'United Kingdom', '2026-07-01', '2026-07-30')], '2026-08-01')).toBeNull();
  });
  it('days used in the last 180, days left', () => {
    const u = schengenUsage([leg('a', 'Denmark', '2026-06-01', '2026-06-30')], '2026-07-15')!;
    expect(u).toMatchObject({ used: 30, remaining: 60, overstayOn: '' });
  });
  it('days older than 180 days drop out of the window', () => {
    const u = schengenUsage([leg('a', 'Denmark', '2026-01-01', '2026-01-20')], '2026-08-01')!;
    expect(u.used).toBe(0);
  });
  it('a planned stay that takes the count past 90 is flagged on the day it does', () => {
    const legs = [leg('a', 'Denmark', '2026-05-01', '2026-06-29'), leg('b', 'Germany', '2026-08-01', '2026-08-31')];
    const u = schengenUsage(legs, '2026-07-01')!;
    expect(u.used).toBe(60);
    expect(u.peak).toBe(91);
    expect(u.overstayOn).toBe('2026-08-31');
  });
});
