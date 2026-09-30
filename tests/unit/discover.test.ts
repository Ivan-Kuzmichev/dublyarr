import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { testDb } from './helpers';
import { loadDiscover, toCard } from '@/lib/discover';
import { TmdbError, type Tmdb } from '@/lib/tmdb/client';
import type { TmdbTvListItem } from '@/lib/tmdb/types';

const trending = JSON.parse(readFileSync('tests/fixtures/tmdb/trending.json', 'utf8')).results as TmdbTvListItem[];
const tmdb = (over: Partial<Tmdb> = {}): Tmdb => ({
  configuration: async () => {},
  details: async () => {
    throw new Error();
  },
  season: async () => {
    throw new Error();
  },
  search: async (q) => trending.filter((t) => t.name.toLowerCase().includes(q.toLowerCase())),
  trending: async () => trending,
  ...over,
});

test('карточка: год и аниме', () => {
  expect(toCard(trending.find((t) => t.id === 1429)!)).toEqual({
    tmdbId: 1429,
    name: 'Атака титанов',
    year: 2013,
    posterPath: '/hTP1DtLGFamjfu8WqjnuQdP1n4i.jpg',
    anime: true,
  });
  expect(toCard(trending.find((t) => t.id === 94605)!).anime).toBe(false); // анимация, но не Япония
});

test('режимы: без ключа, главная, поиск, ошибка TMDB', async () => {
  const db = testDb();
  expect(await loadDiscover(db, null, 'x', '2026-09-30')).toEqual({ mode: 'no-key' });
  const home = await loadDiscover(db, tmdb(), undefined, '2026-09-30');
  expect(home.mode === 'home' && home.trending.length).toBe(trending.length);
  expect((await loadDiscover(db, tmdb(), 'а', '2026-09-30')).mode).toBe('home');
  const s = await loadDiscover(db, tmdb(), ' атака ', '2026-09-30');
  expect(s).toMatchObject({ mode: 'search', query: 'атака' });
  expect(s.mode === 'search' && s.cards.map((c) => c.tmdbId)).toEqual([1429]);
  const broken = await loadDiscover(
    db,
    tmdb({
      search: async () => {
        throw new TmdbError('Неверный ключ TMDB', 'auth');
      },
    }),
    'атака',
    '2026-09-30',
  );
  expect(broken).toEqual({ mode: 'search', query: 'атака', cards: [], error: 'Неверный ключ TMDB' });
});
