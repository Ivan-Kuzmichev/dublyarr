import { and, eq } from 'drizzle-orm';
import { downloads, releases, titles, wantedState } from '../db/schema';
import { getSetting } from '../settings';
import { enqueue } from '../../worker/jobs';
import { getSubscription, subscribe, unsubscribe, updateSubscription, SubscriptionError } from '../subscriptions';
import { validateProfile } from '../profile-core';
import { validateMovieProfile } from '../movie-profile';
import { listStudios, StudioError } from '../studios';
import { deleteSeries } from '../delete-series';
import { searchTitle } from '../search';
import { getTmdb } from '../tmdb';
import { syncTitle } from '../catalog';
import { syncMovie } from '../movies';
import { downloadRelease } from '../manual-download';
import { answerMatch, assignStudio } from '../manual-search';
import { controlDownload } from '../activity';
import { requeueIntros } from '../intros/run';
import type { Paths } from '../downloads';
import { parseSourceForm } from '../source-form';
import { saveSource } from '../source-save';
import { sourcesForSearch } from '../sources';
import { toFormData } from '../form-data';
import { SETTINGS_WRITE } from './settings-sections';
import { titleOf } from './read';
import { ApiError, type ApiCtx, type Route } from './types';

// Изменение через API: те же функции, что у server actions; ошибки — текстом, как на экране.

const JOBS = new Set(['subscriptions.search', 'downloads.sync', 'cleanup.run', 'retention.run', 'tmdb.refresh-all', 'laya.train-now', 'intros.tick']);

const id = (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(404, 'Не найдено');
  return n;
};
const fail = (r: { error: string } | object, status = 400) => {
  if ('error' in r) throw new ApiError(status, (r as { error: string }).error);
  return r;
};

function releaseOf(c: ApiCtx) {
  const r = c.db.select().from(releases).where(eq(releases.id, id(c.params.id))).get();
  if (!r) throw new ApiError(404, 'Раздача не найдена');
  return { release: r, title: c.db.select().from(titles).where(eq(titles.id, r.titleId)).get()! };
}

const posInt = (v: unknown) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);

function control(action: 'pause' | 'resume' | 'remove'): Route['run'] {
  return async (c) => fail(await controlDownload(c.db, c.deps.qbit, id(c.params.id), action), 409);
}

export const WRITE_ROUTES: Route[] = [
  {
    method: 'POST',
    pattern: 'titles/:kind/:tmdbId/subscription',
    run: (c) => {
      const t = titleOf(c);
      const r = t.kind === 'movie' ? validateMovieProfile(c.body.profile) : validateProfile(c.body.profile, new Set(listStudios(c.db).map((s) => s.id)));
      if (!r.ok) throw new ApiError(400, r.error);
      try {
        if (getSubscription(c.db, t.id)) updateSubscription(c.db, t.id, r.profile);
        else subscribe(c.db, t.id, r.profile);
      } catch (e) {
        if (e instanceof SubscriptionError) throw new ApiError(409, e.message);
        throw e;
      }
      return { ok: 'Сохранено', subscription: getSubscription(c.db, t.id) };
    },
  },
  {
    method: 'DELETE',
    pattern: 'titles/:kind/:tmdbId/subscription',
    run: async (c) => {
      const t = titleOf(c);
      const mode = c.query.get('mode') ?? 'sub';
      if (mode !== 'all' && mode !== 'files' && mode !== 'sub') throw new ApiError(400, 'mode — all, files или sub');
      if (mode === 'sub') {
        unsubscribe(c.db, t.id);
        return { ok: 'Подписка удалена' };
      }
      const paths = getSetting<Paths>(c.db, 'paths');
      if (!paths) throw new ApiError(409, 'Не настроены папки');
      return { ok: 'Удалено', ...(await deleteSeries(c.db, { qbit: c.deps.qbit, paths }, t.id, mode)) };
    },
  },
  {
    method: 'POST',
    pattern: 'titles/:kind/:tmdbId/search',
    run: async (c) => {
      const t = titleOf(c);
      const r = await searchTitle(c.db, t.id, { fetchImpl: c.deps.fetchImpl });
      return { releases: r.releases.length, sources: r.sources };
    },
  },
  {
    method: 'POST',
    pattern: 'titles/:kind/:tmdbId/refresh',
    run: async (c) => {
      const t = titleOf(c);
      const tmdb = getTmdb(c.db);
      if (!tmdb) throw new ApiError(409, 'Добавьте ключ TMDB в настройках');
      if (t.kind === 'movie') await syncMovie(c.db, tmdb, t.tmdbId);
      else await syncTitle(c.db, tmdb, t.tmdbId, { allSeasons: true });
      return { ok: 'Обновлено' };
    },
  },
  {
    // перерасчёт заставок и титров: сброс (кроме глав релиза) и разметка этих сезонов в ближайший проход
    method: 'POST',
    pattern: 'titles/:kind/:tmdbId/intros',
    run: (c) => {
      const t = titleOf(c);
      const season = c.body.season === undefined ? undefined : Number(c.body.season);
      if (season !== undefined && !Number.isInteger(season)) throw new ApiError(400, 'season — номер сезона');
      const r = requeueIntros(c.db, t.id, season);
      for (const s of r.seasons) enqueue(c.db, 'intros.tick', { titleId: t.id, season: s });
      return { ok: 'Перерасчёт поставлен', ...r };
    },
  },
  {
    method: 'POST',
    pattern: 'releases/:id/download',
    run: async (c) => {
      const { release, title } = releaseOf(c);
      return fail(
        await downloadRelease(c.db, { qbit: c.deps.qbit, paths: getSetting<Paths>(c.db, 'paths') }, { title, releaseId: release.id, season: posInt(c.body.season), episode: posInt(c.body.episode) }),
        409,
      );
    },
  },
  {
    method: 'POST',
    pattern: 'releases/:id/answer',
    run: (c) => {
      const { release, title } = releaseOf(c);
      if (typeof c.body.match !== 'boolean') throw new ApiError(400, 'Нужно поле match: true или false');
      answerMatch(c.db, title.id, release.id, c.body.match ? 'match' : 'reject');
      return { ok: c.body.match ? 'Это он' : 'Не тот сериал' };
    },
  },
  {
    method: 'POST',
    pattern: 'releases/:id/studio',
    run: (c) => {
      const { title } = releaseOf(c);
      const label = String(c.body.label ?? '').trim();
      if (!label) throw new ApiError(400, 'Нет подписи студии');
      const studioId = posInt(c.body.studioId);
      try {
        if (studioId) assignStudio(c.db, title.id, { label, studioId });
        else assignStudio(c.db, title.id, { label, newName: String(c.body.newName ?? '').trim() || label });
      } catch (e) {
        if (e instanceof StudioError) throw new ApiError(400, e.message);
        throw e;
      }
      return { ok: 'Студия назначена' };
    },
  },
  { method: 'POST', pattern: 'downloads/:id/pause', run: control('pause') },
  { method: 'POST', pattern: 'downloads/:id/resume', run: control('resume') },
  { method: 'POST', pattern: 'downloads/:id/remove', run: control('remove') },
  {
    method: 'POST',
    pattern: 'downloads/:id/retry',
    run: (c) => {
      const d = c.db.select().from(downloads).where(eq(downloads.id, id(c.params.id))).get();
      if (!d) throw new ApiError(404, 'Не найдено');
      if (d.state !== 'error' && d.state !== 'removed') throw new ApiError(409, 'Повторить можно только загрузку с ошибкой или убранную');
      for (const e of d.episodes)
        c.db.delete(wantedState).where(and(eq(wantedState.titleId, d.titleId), eq(wantedState.season, e.season), eq(wantedState.number, e.number))).run();
      enqueue(c.db, 'subscriptions.search');
      return { ok: 'Серии будут найдены заново' };
    },
  },
  {
    method: 'PATCH',
    pattern: 'settings/:section',
    run: async (c) => {
      const write = SETTINGS_WRITE[c.params.section];
      if (!write) throw new ApiError(404, 'Этот раздел через API не меняется');
      return fail(await write(c.db, toFormData(c.body)));
    },
  },
  {
    method: 'POST',
    pattern: 'sources',
    run: async (c) => {
      const input = parseSourceForm(toFormData({ timeout: 15, ...c.body }));
      if ('error' in input) throw new ApiError(400, input.error);
      return fail(await saveSource(c.db, input, null, c.deps.fetchImpl));
    },
  },
  {
    method: 'PATCH',
    pattern: 'sources/:id',
    run: async (c) => {
      const sid = id(c.params.id);
      const cur = sourcesForSearch(c.db).find((s) => s.id === sid);
      if (!cur) throw new ApiError(404, 'Источник не найден');
      const input = parseSourceForm(toFormData({ name: cur.name, url: cur.url, kind: cur.kind, timeout: cur.timeoutMs / 1000, ...c.body }));
      if ('error' in input) throw new ApiError(400, input.error);
      return fail(await saveSource(c.db, input, sid, c.deps.fetchImpl));
    },
  },
  {
    method: 'POST',
    pattern: 'sources/:id/test',
    run: async (c) => {
      const cur = sourcesForSearch(c.db).find((s) => s.id === id(c.params.id));
      if (!cur) throw new ApiError(404, 'Источник не найден');
      const input = parseSourceForm(toFormData({ name: cur.name, url: cur.url, kind: cur.kind, timeout: cur.timeoutMs / 1000 }));
      if ('error' in input) throw new ApiError(400, input.error);
      return fail(await saveSource(c.db, input, cur.id, c.deps.fetchImpl), 502);
    },
  },
  {
    method: 'POST',
    pattern: 'jobs/:name',
    run: (c) => {
      if (!JOBS.has(c.params.name)) throw new ApiError(404, 'Нет такой задачи');
      enqueue(c.db, c.params.name);
      return { ok: 'Задача поставлена' };
    },
  },
];
