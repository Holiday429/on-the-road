// Test fixture for passport-replay.test.ts: nine earned stamps, all pressed, over two pages of one trip.
import { passportFor } from '../../data/passport.ts';
import { passportState } from '../../data/passport-state.ts';

const names = ['Spain', 'France', 'Switzerland', 'Italy', 'Austria', 'Czechia', 'Germany', 'Netherlands', 'Belgium'];
const legs = names.map((country, i) => ({
  id: `l${i}`, city: `City${i}`, country, dateFrom: `2026-08-${String(i * 2 + 1).padStart(2, '0')}`, dateTo: `2026-08-${String(i * 2 + 2).padStart(2, '0')}`, tripId: 't1',
}));
const data = passportFor(legs, '2026-12-01', new Map([['t1', 'Europe 2026']]));
const spots: Array<[number, number]> = [[29, 30], [72, 55], [31, 79], [71, 34], [28, 55], [69, 82]];

export const placements = Object.fromEntries(data.stamps.map((s, i) => [s.id, {
  page: `t1#${Math.floor(i / 6)}`, x: spots[i % 6][0], y: spots[i % 6][1], rot: s.rotation, pressure: 0.8, at: 1,
}]));
export const feed = { ...data, ...passportState(data.stamps, placements as never), warnings: [], visaWarnings: [] };
