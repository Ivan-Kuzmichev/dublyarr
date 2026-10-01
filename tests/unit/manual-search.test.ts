import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { testDb } from './helpers';
import { fakeTmdb } from './fake-tmdb';
import { syncTitle } from '@/lib/catalog';
import { seedStudios, findStudioByAlias } from '@/lib/studios';
import { addSource } from '@/lib/sources';
import { builtinProfile } from '@/lib/profile';
import { subscribe } from '@/lib/subscriptions';
import { runManualSearch, assignStudio, answerMatch } from '@/lib/manual-search';
import type { TmdbSeason, TmdbTvDetails } from '@/lib/tmdb/types';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const fx = <T>(n: string) => JSON.parse(readFileSync(`tests/fixtures/tmdb/${n}.json`, 'utf8')) as T;
const xml = readFileSync('tests/fixtures/torznab/search-jackett.xml', 'utf8');
const fetchImpl = (async () => new Response(xml)) as typeof fetch;

async function setup() {
  const db = testDb();
  seedStudios(db);
  const { tmdb } = fakeTmdb({ details: { 1399: fx<TmdbTvDetails>('tv-1399') }, seasons: { '1399:1': fx<TmdbSeason>('tv-1399-season-1') } });
  const t = await syncTitle(db, tmdb, 1399, { now: 1 });
  addSource(db, { name: 'Jackett', url: 'http://j/api', apiKey: 'k' });
  return { db, t };
}

test('ручной поиск по серии: лучший первым, причины у остальных; без подписки — профиль по умолчанию', async () => {
  const { db } = await setup();
  const r = await runManualSearch(db, 1399, { season: 1, episode: 3 }, { fetchImpl, today: '2026-09-30' });
  expect(r.profileSource).toBe('default');
  expect(r.sources[0]).toMatchObject({ name: 'Jackett', ok: true });
  expect(r.rows[0].verdict).toMatchObject({ tone: 'best', reason: 'Лучший · 1-я по приоритету' });
  expect(r.rows[0].release.title).toContain('S1E3 - Lord Snow');
  expect(r.rows[0].dubs).toEqual([{ label: 'LostFilm', studioName: 'LostFilm', by: 'tracker' }]);
  const kinozal = r.rows.find((x) => x.release.trackerName === 'Kinozal')!;
  expect(kinozal.verdict.reason).toBe('Нет сидов');
  const order = r.rows.map((x) => x.verdict.tone);
  expect(order.indexOf('reject')).toBeGreaterThan(order.lastIndexOf('ok'));
});

test('с подпиской — её профиль', async () => {
  const { db, t } = await setup();
  // лимит 1 ГБ на серию: раздачи LostFilm (2 ГБ на серию) отпадают, остаётся пак Кураж-Бамбей (1 ГБ на серию) через «Любую»
  subscribe(db, t.id, { ...builtinProfile(db, 'series'), quality: { target: 720, allowLower: false, preferHdr: false, maxSizeGb: 1 } });
  const r = await runManualSearch(db, 1399, { season: 1 }, { fetchImpl, today: '2026-09-30' });
  expect(r.profileSource).toBe('subscription');
  expect(r.rows.find((x) => x.verdict.best)!.release.title).toContain('Кураж-Бамбей');
  expect(r.rows.find((x) => x.release.title.includes('Lord Snow'))!.verdict.reason).toBe('Больше 1 ГБ');
});

test('назначить студию: вариант написания добавляется в словарь, раздачи переразбираются', async () => {
  const { db, t } = await setup();
  const r = await runManualSearch(db, 1399, { season: 1 }, { fetchImpl, today: '2026-09-30' });
  const kb = r.rows.find((x) => x.release.title.includes('Кураж-Бамбей'))!;
  expect(kb.dubs[0].studioName).toBe('Кураж-Бамбей');
  // нераспознанная подпись → существующая студия
  const lf = findStudioByAlias(db, 'LostFilm')!;
  assignStudio(db, t.id, { label: 'Лостфильм', studioId: lf.id });
  expect(findStudioByAlias(db, 'лостфильм')?.id).toBe(lf.id);
  // новая студия
  assignStudio(db, t.id, { label: 'Paravozik', newName: 'Paravozik' });
  expect(findStudioByAlias(db, 'Paravozik')?.source).toBe('manual');
});

test('«не тот сериал» и «это он» — правила для трекера', async () => {
  const { db, t } = await setup();
  const first = await runManualSearch(db, 1399, { season: 1 }, { fetchImpl, today: '2026-09-30' });
  const kz = first.rows.find((x) => x.release.trackerName === 'Kinozal')!;
  answerMatch(db, t.id, kz.release.id, 'reject');
  const again = await runManualSearch(db, 1399, { season: 1 }, { fetchImpl, today: '2026-09-30' });
  expect(again.rows.find((x) => x.release.trackerName === 'Kinozal')!.verdict.reason).toBe('В чёрном списке');
  answerMatch(db, t.id, kz.release.id, 'match');
  const third = await runManualSearch(db, 1399, { season: 1 }, { fetchImpl, today: '2026-09-30' });
  expect(third.rows.find((x) => x.release.trackerName === 'Kinozal')!.verdict.reason).not.toBe('В чёрном списке');
});
