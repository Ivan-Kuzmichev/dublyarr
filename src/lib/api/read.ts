import { desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { downloads, episodeFiles, titles, wantedState, type Title } from '../db/schema';
import { getSetting, tryGetSecretSetting } from '../settings';
import { serviceStatuses } from '../heartbeat';
import { jobsSummary } from '../diagnostics';
import { readLog, type LogLevel } from '../log-read';
import { reconcile } from '../reconcile';
import { CATEGORY, type Paths } from '../downloads';
import { diskUsage } from '../storage';
import { libraryItems, getSubscription } from '../subscriptions';
import { getTitleByTmdbId, listSeasons } from '../catalog';
import { episodeStatuses, todayData } from '../dashboard';
import { movieCard } from '../movie-card';
import { activityQueue } from '../activity';
import { runManualMovieSearch, runManualSearch } from '../manual-search';
import { listSources } from '../sources';
import { trackersTable } from '../trackers';
import { getSchedule, getSpeed } from '../schedule';
import { getCleanup } from '../cleanup';
import { getProcessing } from '../media/tracks';
import { getRetention } from '../retention-settings';
import { getDefaultProfile, getMovieDefault } from '../profile';
import { getLayaSettings } from '../laya/settings';
import { getLogSettings } from '../log-settings';
import { ApiError, type ApiCtx, type Route } from './types';

// Чтение через API: те же функции, что у экранов. Секреты — только «задан / не задан».

const int = (v: string | undefined | null, what = 'Неверный номер') => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, what);
  return n;
};

/** Сериал или фильм по /titles/:kind/:tmdbId; kind — series | movie. */
export function titleOf(c: ApiCtx): Title {
  const kind = c.params.kind;
  if (kind !== 'series' && kind !== 'movie') throw new ApiError(404, 'Нет такого адреса');
  const t = getTitleByTmdbId(c.db, int(c.params.tmdbId), kind === 'movie' ? 'movie' : 'tv');
  if (!t) throw new ApiError(404, 'Не найдено');
  return t;
}

const qbitOf = (c: ApiCtx) => {
  if (!c.deps.qbit) throw new ApiError(409, 'qBittorrent не подключён');
  return c.deps.qbit;
};

const set = (v: unknown) => (v ? 'задан' : 'не задан');

/** Разделы настроек, которые можно читать (и менять — write.ts) через API. «Безопасность» и доступ к API — нет. */
export const SETTINGS_READ: Record<string, (db: Db) => unknown> = {
  schedule: getSchedule,
  speed: getSpeed,
  cleanup: getCleanup,
  processing: getProcessing,
  retention: getRetention,
  paths: (db) => getSetting<Paths>(db, 'paths') ?? null,
  'profile.series': (db) => getDefaultProfile(db, 'series'),
  'profile.anime': (db) => getDefaultProfile(db, 'anime'),
  'profile.movie': getMovieDefault,
  laya: getLayaSettings,
  logging: getLogSettings,
  qbittorrent: (db) => {
    const q = tryGetSecretSetting<{ url: string; username: string; password: string }>(db, 'qbittorrent');
    return q ? { url: q.url, username: q.username, password: set(q.password) } : null;
  },
  tmdb: (db) => {
    const t = tryGetSecretSetting<{ apiKey: string; proxy?: string }>(db, 'tmdb');
    return { apiKey: set(t?.apiKey), proxy: t?.proxy ? set(t.proxy) : 'не задан' };
  },
  telegram: (db) => {
    const t = tryGetSecretSetting<{ token: string; chatId?: string | null }>(db, 'telegram');
    return { token: set(t?.token), chat: t?.chatId ? 'привязан' : 'не привязан' };
  },
};

const titleNames = (db: Db) => new Map(db.select({ id: titles.id, name: titles.nameRu, tmdbId: titles.tmdbId, kind: titles.kind }).from(titles).all().map((t) => [t.id, t]));

export const READ_ROUTES: Route[] = [
  {
    method: 'GET',
    pattern: 'status',
    run: async (c) => {
      const paths = getSetting<Paths>(c.db, 'paths');
      const disk = paths ? await diskUsage(paths.media).catch(() => null) : null;
      return { version: c.deps.version, services: serviceStatuses(c.db, c.deps.now), jobs: jobsSummary(c.db), disk };
    },
  },
  {
    method: 'GET',
    pattern: 'logs',
    run: (c) =>
      readLog(c.deps.logDir, {
        lines: c.query.get('lines') ? Number(c.query.get('lines')) : undefined,
        level: (c.query.get('level') as LogLevel | null) ?? undefined,
        area: c.query.get('area') ?? undefined,
        q: c.query.get('q') ?? undefined,
        since: c.query.get('since') ? Number(c.query.get('since')) : undefined,
      }),
  },
  {
    method: 'GET',
    pattern: 'downloads',
    run: (c) => {
      const names = titleNames(c.db);
      const state = c.query.get('state');
      const rows = c.db
        .select()
        .from(downloads)
        .where(state ? inArray(downloads.state, state.split(',') as (typeof downloads.$inferSelect)['state'][]) : undefined)
        .orderBy(desc(downloads.addedAt))
        .limit(200)
        .all();
      return rows.map(({ files: _f, ...d }) => ({ ...d, title: names.get(d.titleId)?.name ?? null }));
    },
  },
  {
    method: 'GET',
    pattern: 'downloads/:id',
    run: async (c) => {
      const d = c.db.select().from(downloads).where(eq(downloads.id, int(c.params.id))).get();
      if (!d) throw new ApiError(404, 'Не найдено');
      const q = c.deps.qbit;
      const qbit = q ? ((await q.list(CATEGORY)).find((t) => t.hash === d.hash) ?? null) : null;
      return { ...d, title: titleNames(c.db).get(d.titleId)?.name ?? null, qbit, qbitFiles: q && qbit ? await q.files(d.hash) : [] };
    },
  },
  { method: 'GET', pattern: 'qbit/reconcile', run: (c) => reconcile(c.db, qbitOf(c)) },
  { method: 'GET', pattern: 'library', run: (c) => libraryItems(c.db, c.deps.today) },
  {
    method: 'GET',
    pattern: 'titles/:kind/:tmdbId',
    run: (c) => {
      const t = titleOf(c);
      if (t.kind === 'movie') return { title: t, subscription: getSubscription(c.db, t.id) ?? null, card: movieCard(c.db, t, c.deps.today) };
      return {
        title: t,
        subscription: getSubscription(c.db, t.id) ?? null,
        seasons: listSeasons(c.db, t.id),
        episodes: Object.fromEntries(episodeStatuses(c.db, t.id, c.deps.today)),
        files: c.db.select().from(episodeFiles).where(eq(episodeFiles.titleId, t.id)).all(),
        wanted: c.db.select().from(wantedState).where(eq(wantedState.titleId, t.id)).all(),
      };
    },
  },
  {
    method: 'GET',
    pattern: 'wanted',
    run: (c) => {
      const names = titleNames(c.db);
      return c.db
        .select()
        .from(wantedState)
        .all()
        .map((w) => ({ ...w, title: names.get(w.titleId)?.name ?? null, tmdbId: names.get(w.titleId)?.tmdbId ?? null }));
    },
  },
  { method: 'GET', pattern: 'attention', run: (c) => todayData(c.db, c.deps.today, c.deps.now).attention },
  {
    method: 'GET',
    pattern: 'activity',
    run: (c) => {
      const limit = Math.min(200, Math.max(1, Number(c.query.get('limit')) || 50));
      const names = titleNames(c.db);
      const history = c.db
        .select()
        .from(downloads)
        .orderBy(desc(downloads.addedAt))
        .limit(limit)
        .all()
        .map(({ files: _f, ...d }) => ({ ...d, title: names.get(d.titleId)?.name ?? null }));
      return { queue: activityQueue(c.db, c.deps.now), history };
    },
  },
  {
    method: 'GET',
    pattern: 'titles/:kind/:tmdbId/releases',
    run: async (c) => {
      const t = titleOf(c);
      const opts = { fetchImpl: c.deps.fetchImpl, today: c.deps.today };
      if (t.kind === 'movie') return runManualMovieSearch(c.db, t.tmdbId, opts);
      const s = c.query.get('s');
      if (!s) throw new ApiError(400, 'Нужен номер сезона: ?s=1&e=3');
      const e = c.query.get('e');
      return runManualSearch(c.db, t.tmdbId, { season: int(s), ...(e ? { episode: int(e) } : {}) }, opts);
    },
  },
  { method: 'GET', pattern: 'sources', run: (c) => ({ sources: listSources(c.db), trackers: trackersTable(c.db) }) },
  {
    method: 'GET',
    pattern: 'settings/:section',
    run: (c) => {
      const read = SETTINGS_READ[c.params.section];
      if (!read) throw new ApiError(404, 'Нет такого раздела');
      return read(c.db);
    },
  },
];

