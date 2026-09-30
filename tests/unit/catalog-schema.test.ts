import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { titles, seasons, episodes } from '@/lib/db/schema';

test('каталог: сериал, сезон, серия; уникальность серии; каскадное удаление', () => {
  const db = testDb();
  const t = db
    .insert(titles)
    .values({
      tmdbId: 1399,
      kind: 'series',
      nameRu: 'Игра престолов',
      nameOriginal: 'Game of Thrones',
      originalLanguage: 'en',
      status: 'ended',
      createdAt: 1,
      refreshedAt: 1,
    })
    .returning()
    .get();
  expect(t.altNames).toEqual([]);
  expect(t.kindManual).toBe(false);
  db.insert(seasons).values({ titleId: t.id, number: 1, name: 'Сезон 1', episodeCount: 10 }).run();
  db.insert(episodes).values({ titleId: t.id, season: 1, number: 1, name: 'Зима близко', airDate: '2011-04-17' }).run();
  expect(() => db.insert(episodes).values({ titleId: t.id, season: 1, number: 1, name: 'дубль' }).run()).toThrow();
  db.delete(titles).run();
  expect(db.select().from(episodes).all()).toHaveLength(0);
  expect(db.select().from(seasons).all()).toHaveLength(0);
});
