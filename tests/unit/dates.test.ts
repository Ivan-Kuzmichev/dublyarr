import { expect, test } from 'vitest';
import { formatAirDate, pickDefaultSeason } from '@/lib/dates';

test('дата эфира', () => {
  const today = '2026-09-30';
  expect(formatAirDate(null, today)).toBe('—');
  expect(formatAirDate('2026-09-08', today)).toBe('8 сент');
  expect(formatAirDate('2011-04-17', today)).toBe('17 апр 2011');
  expect(formatAirDate('2026-09-30', today)).toBe('сегодня');
  expect(formatAirDate('2026-10-01', today)).toBe('завтра');
  expect(formatAirDate('2026-10-06', today)).toBe('через 6 дн');
  expect(formatAirDate('2026-10-20', today)).toBe('20 окт');
});

test('сезон по умолчанию', () => {
  const today = '2026-09-30';
  expect(
    pickDefaultSeason(
      [
        { number: 0, airDate: '2010-01-01' },
        { number: 1, airDate: '2024-01-01' },
        { number: 2, airDate: '2026-09-01' },
        { number: 3, airDate: '2027-01-01' },
      ],
      today,
    ),
  ).toBe(2);
  expect(pickDefaultSeason([{ number: 1, airDate: null }], today)).toBe(1);
  expect(pickDefaultSeason([{ number: 0, airDate: null }], today)).toBe(0);
});

test('короткая дата', async () => {
  const { formatShortDate, addDays } = await import('@/lib/dates');
  expect(formatShortDate('2026-10-03', '2026-09-30')).toBe('3 окт');
  expect(formatShortDate('2027-01-05', '2026-09-30')).toBe('5 янв 2027');
  expect(addDays('2026-09-28', 5)).toBe('2026-10-03');
  expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
});
