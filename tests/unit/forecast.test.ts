import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { forecastEpisode, formatDelay, studioDelays, type StudioDelay } from '@/lib/forecast';
import { episodes, studioSightings, studios, titles } from '@/lib/db/schema';
import type { Profile } from '@/lib/profile-core';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const at = (d: string, h = 12) => Date.parse(`${d}T${String(h).padStart(2, '0')}:00:00Z`);

function setup() {
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 1, kind: 'series', nameRu: 'A', nameOriginal: 'A', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  const air = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', null];
  air.forEach((airDate, i) => db.insert(episodes).values({ titleId: t.id, season: 1, number: i + 1, name: `E${i + 1}`, airDate }).run());
  const st = (name: string) => db.insert(studios).values({ name, kind: 'both', source: 'manual', createdAt: 1 }).returning().get().id;
  const see = (studioId: number, number: number, seenAt: number, o: { basis?: 'seen' | 'published'; fromPack?: boolean } = {}) =>
    db.insert(studioSightings).values({ titleId: t.id, studioId, season: 1, number, seenAt, basis: o.basis ?? 'seen', fromPack: o.fromPack ?? false }).run();
  return { db, t, st, see };
}

test('медиана задержек и основание «по N сериям»', () => {
  const { db, t, st, see } = setup();
  const a = st('HDrezka');
  see(a, 1, at('2026-09-02')); // +1,5
  see(a, 2, at('2026-09-09')); // +1,5
  see(a, 3, at('2026-09-20')); // +5,5
  expect(studioDelays(db, t.id).get(a)).toMatchObject({ days: 1.5, count: 3, basis: 'seen', basisText: 'по 3 сериям' });
  see(a, 4, at('2026-09-23', 0)); // +1
  expect(studioDelays(db, t.id).get(a)).toMatchObject({ days: 1.5, count: 4 }); // медиана (1,5 и 1,5)
});

test('классы: отдельные «видели» > «по датам раздач» > паки; отрицательные и без даты не учитываются', () => {
  const { db, t, st, see } = setup();
  const a = st('A');
  const b = st('B');
  const c = st('C');
  see(a, 1, at('2026-09-03'), { basis: 'published' });
  see(a, 2, at('2026-09-12'), { fromPack: true });
  expect(studioDelays(db, t.id).get(a)).toMatchObject({ days: 2.5, count: 1, basis: 'published', basisText: '≈ по датам раздач' });
  see(b, 1, at('2026-09-05'), { fromPack: true });
  expect(studioDelays(db, t.id).get(b)).toMatchObject({ days: 4.5, basis: 'packs', basisText: 'только паки' });
  see(c, 1, at('2026-08-30')); // раньше эфира
  see(c, 5, at('2026-09-30')); // серия без даты
  expect(studioDelays(db, t.id).get(c)).toMatchObject({ days: null, count: 0, basis: 'none', basisText: 'нет данных' });
  see(c, 2, at('2026-09-09'));
  expect(studioDelays(db, t.id).get(c)!.basisText).toBe('по 1 серии');
});

test('formatDelay', () => {
  expect(formatDelay(0)).toBe('в день эфира');
  expect(formatDelay(1)).toBe('+1 день');
  expect(formatDelay(1.5)).toBe('+1,5 дня');
  expect(formatDelay(3)).toBe('+3 дня');
  expect(formatDelay(5)).toBe('+5 дней');
});

const profile = (dubs: Profile['dubs']): Profile => ({
  dubs,
  quality: { target: 1080, allowLower: true, preferHdr: false, maxSizeGb: null },
  scope: { mode: 'all' },
  wholeSeasonAfterFinale: false,
  replaceWithHigher: true,
  autoNextSeason: true,
});
const delay = (studioId: number, days: number | null): [number, StudioDelay] => [studioId, { studioId, days, count: days === null ? 0 : 3, basis: days === null ? 'none' : 'seen', basisText: days === null ? 'нет данных' : 'по 3 сериям' }];
const names = new Map([[1, 'HDrezka'], [2, 'LostFilm'], [3, 'RuDub']]);
const name = (id: number) => names.get(id);

test('прогноз: даты по позициям, итог, полоска, запасной вариант', () => {
  const p = profile([{ kind: 'studio', studioId: 1, waitDays: 0 }, { kind: 'studio', studioId: 2, waitDays: 3 }]);
  const f = forecastEpisode(p, { season: 1, number: 4, airDate: '2026-09-29' }, new Map([delay(1, 2), delay(2, 1)]), [{ studioId: 2, season: 1, number: 4, seenAt: at('2026-09-30') }], name, '2026-09-30');
  expect(f.positions).toEqual([
    expect.objectContaining({ label: 'HDrezka', expected: '2026-10-01', observedDays: null }),
    expect.objectContaining({ label: 'LostFilm', expected: '2026-09-30', observedDays: 1 }),
  ]);
  expect(f).toMatchObject({ eta: '2026-10-01', etaText: '≈ завтра', progress: 0.5, fallbackMark: 1 });
  expect(f.fallbackNote).toBe('Если HDrezka не выйдет до пятницы — возьму LostFilm, потом заменю.');
});

test('прогноз: запасная «Любая», без запасной, без данных', () => {
  const any = profile([{ kind: 'studio', studioId: 1, waitDays: 0 }, { kind: 'any', waitDays: 10 }]);
  expect(forecastEpisode(any, { season: 1, number: 4, airDate: '2026-09-29' }, new Map([delay(1, 4)]), [], name, '2026-09-30')).toMatchObject({
    eta: '2026-10-03',
    etaText: '≈ 3 октября',
    fallbackNote: 'Если HDrezka не выйдет до 9 окт — возьму любую, потом заменю.',
  });
  const only = profile([{ kind: 'studio', studioId: 3, waitDays: 0 }]);
  expect(forecastEpisode(only, { season: 1, number: 4, airDate: '2026-09-29' }, new Map([delay(3, null)]), [], name, '2026-09-30')).toMatchObject({
    eta: null,
    etaText: 'прогноза нет',
    progress: null,
    fallbackNote: 'Жду только RuDub — запасная озвучка не задана.',
  });
});

test('строка запасного варианта: сегодня и завтра', () => {
  const p = profile([{ kind: 'studio', studioId: 1, waitDays: 0 }, { kind: 'studio', studioId: 2, waitDays: 2 }]);
  const f = (today: string) => forecastEpisode(p, { season: 1, number: 4, airDate: '2026-09-29' }, new Map([delay(1, 2)]), [], name, today).fallbackNote;
  expect(f('2026-10-01')).toBe('Если HDrezka не выйдет сегодня — возьму LostFilm, потом заменю.');
  expect(f('2026-09-30')).toBe('Если HDrezka не выйдет до завтра — возьму LostFilm, потом заменю.');
});
