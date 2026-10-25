import { expect, test } from 'vitest';
import { testDbWithChat } from './helpers';
import { checkNotFound, parseNotFoundDays, setNotFoundDays } from '@/lib/not-found';
import { episodes, notifications, subscriptions, titles, wantedState } from '@/lib/db/schema';
import type { Profile } from '@/lib/profile-core';

const profile: Profile = {
  dubs: [
    { kind: 'studio', studioId: 1, waitDays: 0 },
    { kind: 'any', waitDays: 3 },
  ],
  quality: { target: 1080, allowLower: false, preferHdr: false, maxSizeGb: null },
  scope: { mode: 'all' },
  wholeSeasonAfterFinale: false,
  replaceWithHigher: false,
  autoNextSeason: false,
};

function setup(p: Profile = profile) {
  const db = testDbWithChat();
  const t = db.insert(titles).values({ tmdbId: 1399, kind: 'series', nameRu: 'Дэдлок', nameOriginal: 'Deadloch', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  db.insert(subscriptions).values({ titleId: t.id, profile: p, subscribedAt: 1, updatedAt: 1 }).run();
  for (const n of [1, 2, 3]) db.insert(episodes).values({ titleId: t.id, season: 2, number: n, name: `E${n}`, airDate: `2026-10-${String(n).padStart(2, '0')}` }).run();
  const want = (n: number, state: 'missing' | 'ask' | 'waiting', reason = 'Подходящих раздач нет') =>
    db.insert(wantedState).values({ titleId: t.id, season: 2, number: n, state, reason, until: null, checkedAt: 1 }).run();
  const sent = () => db.select().from(notifications).all();
  return { db, t, want, sent };
}

test('не нашлась за 7 дней после выхода — одно сообщение со ссылкой на ручной поиск, повторно не шлётся', () => {
  const { db, want, sent } = setup();
  want(1, 'missing');
  expect(checkNotFound(db, '2026-10-07')).toBe(0); // 6 дней
  expect(checkNotFound(db, '2026-10-08')).toBe(1);
  expect(sent()).toEqual([expect.objectContaining({ kind: 'not-found', text: '🔍 Дэдлок · S02E01: не нашлась за 7 дней после выхода\nПодходящих раздач нет' })]);
  expect(checkNotFound(db, '2026-10-20')).toBe(0);
  expect(sent()).toHaveLength(1);
});

test('серии одного сериала — одним сообщением; ждём ответа — тоже; ждём озвучку (waiting) — нет', () => {
  const { db, want, sent } = setup();
  want(1, 'missing');
  want(2, 'ask', 'Сомнительное совпадение');
  want(3, 'waiting', 'Рано: ждём LostFilm');
  expect(checkNotFound(db, '2026-10-30')).toBe(2);
  expect(sent()).toEqual([expect.objectContaining({ text: '🔍 Дэдлок · S02E01–E02: не нашлись за 7 дней после выхода' })]);
});

test('ожидание профиля дольше N — после конца ожидания; N из настроек', () => {
  const { db, want } = setup({ ...profile, dubs: [profile.dubs[0], { kind: 'any', waitDays: 10 }] });
  want(1, 'missing');
  expect(checkNotFound(db, '2026-10-08')).toBe(0);
  expect(checkNotFound(db, '2026-10-11')).toBe(1);
  const s = setup();
  setNotFoundDays(s.db, 2);
  s.want(1, 'missing');
  expect(checkNotFound(s.db, '2026-10-03')).toBe(0); // ожидание «любой» — 3 дня
  expect(checkNotFound(s.db, '2026-10-04')).toBe(1);
  expect(s.sent()[0].text).toContain('за 2 дня');
});

test('дни — от 1 до 90', () => {
  expect(parseNotFoundDays('7')).toBe(7);
  expect(parseNotFoundDays('0')).toEqual({ error: 'Дней — от 1 до 90' });
  expect(parseNotFoundDays('x')).toEqual({ error: 'Дней — от 1 до 90' });
});
