import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { DEFAULT_RETENTION, nextRetentionAt, parseRetentionForm, retentionDue } from '@/lib/retention-settings';
import { deletions, subscriptions, titles } from '@/lib/db/schema';
import type { Profile } from '@/lib/profile-core';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m); // 4 октября 2026 — воскресенье

test('исключения у подписки и история удалений', () => {
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 1, kind: 'series', nameRu: 'A', nameOriginal: 'A', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  const s = db.insert(subscriptions).values({ titleId: t.id, profile: {} as Profile, subscribedAt: 1, updatedAt: 1 }).returning().get();
  expect(s).toMatchObject({ keepAll: false, autoDelete: false });
  db.insert(deletions).values({ titleId: t.id, label: 'A · S01', why: 'старше', size: 5, at: 1 }).run();
  db.delete(titles).run();
  expect(db.select().from(deletions).get()!.titleId).toBeNull();
});

test('по умолчанию правило сезонов выключено', () => {
  expect(DEFAULT_RETENTION).toEqual({ seasons: { on: false, keep: 1, ended: 'keep' }, oldCopy: 'now', age: { days: 30 }, overflow: { on: true, warn: 90, pause: 97 }, schedule: 'weekly' });
});

test('расписание уборки: 04:00, неделя — воскресенье, вручную — никогда', () => {
  expect(retentionDue('daily', null, at(1, 3))).toBe(true); // ни разу — первая уборка сразу
  expect(retentionDue('daily', at(1, 4, 5).getTime(), at(1, 23))).toBe(false);
  expect(retentionDue('daily', at(1, 4, 5).getTime(), at(2, 3, 59))).toBe(false);
  expect(retentionDue('daily', at(1, 4, 5).getTime(), at(2, 4, 0))).toBe(true);
  expect(retentionDue('weekly', at(1, 4, 5).getTime(), at(3, 12))).toBe(false); // суббота
  expect(retentionDue('weekly', at(1, 4, 5).getTime(), at(4, 4, 1))).toBe(true); // воскресенье
  expect(retentionDue('manual', null, at(4, 5))).toBe(false);
  expect(nextRetentionAt('weekly', at(1, 4, 5).getTime(), at(2, 12))).toEqual(at(4, 4));
  expect(nextRetentionAt('daily', at(2, 4, 5).getTime(), at(2, 12))).toEqual(at(3, 4));
  expect(nextRetentionAt('manual', null, at(2, 12))).toBeNull();
});

test('разбор формы правил', () => {
  const f = (o: Record<string, string>) => {
    const x = new FormData();
    for (const [k, v] of Object.entries(o)) x.set(k, v);
    return x;
  };
  const ok = { seasonsOn: 'on', keep: '2', ended: 'clean', oldCopy: '3days', days: '14', overflowOn: 'on', warn: '85', pause: '95', schedule: 'daily' };
  expect(parseRetentionForm(f(ok))).toEqual({ seasons: { on: true, keep: 2, ended: 'clean' }, oldCopy: '3days', age: { days: 14 }, overflow: { on: true, warn: 85, pause: 95 }, schedule: 'daily' });
  expect(parseRetentionForm(f({ ...ok, keep: '0' }))).toEqual({ error: 'Хранить сезонов — от 1 до 10' });
  expect(parseRetentionForm(f({ ...ok, days: '400' }))).toEqual({ error: 'Срок — от 1 до 365 дней' });
  expect(parseRetentionForm(f({ ...ok, warn: '97', pause: '95' }))).toEqual({ error: 'Пауза — выше порога предупреждения, не больше 99 %' });
});
