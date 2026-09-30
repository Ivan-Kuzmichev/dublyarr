import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { scheduleDaily } from '@/worker/schedule';
import { jobs } from '@/lib/db/schema';

test('раз в сутки и без дублей в очереди', () => {
  const db = testDb();
  const t = 1_800_000_000_000;
  expect(scheduleDaily(db, 'tmdb.refresh-all', t)).toBe(true);
  expect(scheduleDaily(db, 'tmdb.refresh-all', t + 1000)).toBe(false);
  db.update(jobs).set({ status: 'done' }).run();
  expect(scheduleDaily(db, 'tmdb.refresh-all', t + 23 * 3_600_000)).toBe(false);
  expect(scheduleDaily(db, 'tmdb.refresh-all', t + 24 * 3_600_000)).toBe(true);
  expect(db.select().from(jobs).all()).toHaveLength(2);
});

test('задача ещё в очереди — вторую не ставим, даже если прошли сутки', () => {
  const db = testDb();
  const t = 1_800_000_000_000;
  scheduleDaily(db, 'tmdb.refresh-all', t);
  expect(scheduleDaily(db, 'tmdb.refresh-all', t + 25 * 3_600_000)).toBe(false);
});
