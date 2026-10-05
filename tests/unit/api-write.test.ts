import { expect, test } from 'vitest';
import { api } from './api-helpers';
import { getLogSettings } from '@/lib/log-settings';
import { getSchedule } from '@/lib/schedule';
import { downloads, jobs, subscriptions, titles } from '@/lib/db/schema';
import { getDefaultProfile } from '@/lib/profile';
import { seedStudios } from '@/lib/studios';

function title(db: ReturnType<typeof api>['db']) {
  return db.insert(titles).values({ tmdbId: 1399, kind: 'series', tmdbType: 'tv', nameRu: 'Игра престолов', nameOriginal: 'GoT', originalLanguage: 'en', status: 'ended', createdAt: 1, refreshedAt: 1 }).returning().get();
}

test('PATCH settings/logging меняет уровни, неверное значение — 400 с текстом', async () => {
  const { call, db } = api();
  expect((await call('PATCH', 'settings/logging', { level: 'info', 'area.qbit': 'debug' })).status).toBe(200);
  expect(getLogSettings(db)).toEqual({ level: 'info', areas: { qbit: 'debug' } });
  expect(await call('PATCH', 'settings/logging', { level: 'trace' })).toEqual({ status: 400, body: { error: 'Неверный уровень' } });
});

test('PATCH settings/schedule — тот же разбор, что у формы', async () => {
  const { call, db } = api();
  expect((await call('PATCH', 'settings/schedule', { every: '6h', nightFrom: '02:00', nightTo: '06:00', eager: true })).status).toBe(200);
  expect(getSchedule(db)).toMatchObject({ every: '6h', nightFrom: '02:00', nightTo: '06:00', eager: true, packChecks: false });
  expect(await call('PATCH', 'settings/schedule', { every: 'вечно' })).toEqual({ status: 400, body: { error: 'Неизвестная частота' } });
});

test('«Безопасность», доступ к API, ключ TMDB и бот Telegram через API не меняются', async () => {
  const { call } = api();
  for (const s of ['security', 'api', 'tmdb', 'telegram']) expect((await call('PATCH', `settings/${s}`, {})).status, s).toBe(404);
});

test('пауза и продолжение загрузки', async () => {
  const { call, db, fq } = api();
  const t = title(db);
  const d = db.insert(downloads).values({ hash: 'h1', titleId: t.id, season: 1, kind: 'episode', episodes: [], state: 'downloading', name: 'x', size: 1, addedAt: 1 }).returning().get();
  fq.torrents.set('h1', { hash: 'h1', name: 'x', state: 'downloading', progress: 0.1, dlspeed: 0, eta: 0, size: 1, num_seeds: 1, save_path: '/d', content_path: '/d/x', category: 'dublyarr', files: [], paused: false });
  expect((await call('POST', `downloads/${d.id}/pause`)).status).toBe(200);
  expect(db.select().from(downloads).get()).toMatchObject({ state: 'paused', pausedByUser: true });
  expect(await call('POST', `downloads/${d.id}/pause`)).toEqual({ status: 409, body: { error: 'Эту загрузку нельзя поставить на паузу' } });
  expect((await call('POST', `downloads/${d.id}/resume`)).status).toBe(200);
  expect((await call('POST', `downloads/${d.id}/fly`)).status).toBe(404);
});

test('повтор загрузки с ошибкой — серии снова ищутся', async () => {
  const { call, db } = api();
  const t = title(db);
  const d = db.insert(downloads).values({ hash: 'h2', titleId: t.id, season: 1, kind: 'episode', episodes: [{ season: 1, number: 3 }], state: 'error', lastError: 'x', name: 'x', size: 1, addedAt: 1 }).returning().get();
  expect((await call('POST', `downloads/${d.id}/retry`)).status).toBe(200);
  expect(db.select().from(jobs).all().map((j) => j.type)).toContain('subscriptions.search');
});

test('jobs: разрешённая задача ставится, чужая — 404', async () => {
  const { call, db } = api();
  expect((await call('POST', 'jobs/downloads.sync')).status).toBe(200);
  expect(db.select().from(jobs).all().map((j) => j.type)).toContain('downloads.sync');
  expect((await call('POST', 'jobs/rm-rf')).status).toBe(404);
});

test('подписка через API: профиль проверяется как в форме; отписка', async () => {
  const { call, db } = api();
  seedStudios(db);
  title(db);
  expect((await call('POST', 'titles/series/1399/subscription', { profile: { garbage: 1 } })).status).toBe(400);
  expect((await call('POST', 'titles/series/1399/subscription', { profile: getDefaultProfile(db, 'series') })).status).toBe(200);
  expect(db.select().from(subscriptions).all()).toHaveLength(1);
  expect((await call('POST', 'titles/series/1399/subscription', { profile: getDefaultProfile(db, 'series') })).status).toBe(200); // правка
  expect((await call('DELETE', 'titles/series/1399/subscription')).status).toBe(200);
  expect(db.select().from(subscriptions).all()).toHaveLength(0);
});

test('раздача: неизвестная — 404', async () => {
  const { call } = api();
  expect((await call('POST', 'releases/999/answer', { match: true })).status).toBe(404);
  expect((await call('POST', 'releases/999/download', {})).status).toBe(404);
});

test('перерасчёт заставок: сброс сезона (кроме глав релиза) и задача на этот сезон', async () => {
  const { call, db } = api();
  const t = title(db);
  const { episodeFiles } = await import('@/lib/db/schema');
  const ef = (season: number, number: number, introState: 'marked' | 'none' | 'skipped' | 'error') =>
    db.insert(episodeFiles).values({ titleId: t.id, season, number, path: `S${season}E${number}.mkv`, size: 1, method: 'hardlink', importedAt: 1, introState, introNote: 'x' }).run();
  ef(1, 1, 'marked');
  ef(1, 2, 'none');
  ef(1, 3, 'skipped');
  ef(2, 1, 'error');
  const r = await call('POST', 'titles/series/1399/intros', { season: 1 });
  expect(r).toEqual({ status: 200, body: { ok: 'Перерасчёт поставлен', seasons: [1], files: 2 } });
  expect(db.select().from(episodeFiles).all().map((f) => [f.season, f.number, f.introState])).toEqual([[1, 1, null], [1, 2, null], [1, 3, 'skipped'], [2, 1, 'error']]);
  expect(db.select().from(jobs).all().filter((j) => j.type === 'intros.tick').map((j) => JSON.parse(j.payload))).toEqual([{ titleId: t.id, season: 1 }]);
  // без сезона — все сезоны сериала
  expect((await call('POST', 'titles/series/1399/intros', {})).body).toMatchObject({ seasons: [1, 2], files: 1 });
});

test('задача intros.tick ставится и через jobs', async () => {
  const { call } = api();
  expect((await call('POST', 'jobs/intros.tick')).status).toBe(200);
});
