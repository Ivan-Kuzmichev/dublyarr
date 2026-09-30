import { expect, test } from 'vitest';
import { wantedEpisodes } from '@/lib/subscriptions';
import type { Profile } from '@/lib/profile';

const p = (scope: Profile['scope']): Profile => ({
  dubs: [{ kind: 'any', waitDays: 0 }],
  quality: { target: 1080, allowLower: true, preferHdr: false, maxSizeGb: null },
  scope,
  wholeSeasonAfterFinale: false,
  replaceWithHigher: true,
  autoNextSeason: true,
});
const eps = [
  { season: 0, number: 1, airDate: '2020-01-01' },
  { season: 1, number: 1, airDate: '2025-01-01' },
  { season: 1, number: 2, airDate: '2025-01-08' },
  { season: 2, number: 1, airDate: '2026-09-20' },
  { season: 2, number: 2, airDate: '2026-09-27' },
  { season: 2, number: 3, airDate: '2026-09-30' },
  { season: 2, number: 4, airDate: '2026-10-07' },
  { season: 2, number: 5, airDate: null },
];
const today = '2026-09-30';
const sub = (scope: Profile['scope'], subscribedAt = new Date(2026, 8, 27, 12).getTime()) => ({ profile: p(scope), subscribedAt });
const ids = (xs: { season: number; number: number }[]) => xs.map((e) => `S${e.season}E${e.number}`);

test('все сезоны: вышедшие, без спецвыпусков и без даты; сегодняшняя — нужна', () => {
  expect(ids(wantedEpisodes(sub({ mode: 'all' }), eps, today))).toEqual(['S1E1', 'S1E2', 'S2E1', 'S2E2', 'S2E3']);
});

test('только новые: с даты подписки включительно', () => {
  expect(ids(wantedEpisodes(sub({ mode: 'new' }), eps, today))).toEqual(['S2E2', 'S2E3']);
});

test('с серии: до конца сезона и дальше', () => {
  expect(ids(wantedEpisodes(sub({ mode: 'from', season: 1, episode: 2, until: 'season_end' }), eps, today))).toEqual(['S1E2']);
  expect(ids(wantedEpisodes(sub({ mode: 'from', season: 1, episode: 2, until: 'onward' }), eps, today))).toEqual([
    'S1E2',
    'S2E1',
    'S2E2',
    'S2E3',
  ]);
});
