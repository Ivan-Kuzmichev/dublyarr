import { and, eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { releases, wantedState, type Release, type Title } from './db/schema';
import { listEpisodes } from './catalog';
import { listStudios } from './studios';
import type { Qbit } from './qbit';
import { fetchTorrentFile, startRelease, type Paths } from './downloads';
import { todayIso } from './dates';
import { getSubscription } from './subscriptions';
import { isMovieProfile, MOVIE_DUB_LABEL } from './movie-profile';
import { getMovieDefault } from './profile';
import { movieKinds } from './movie-evaluate';
import { MOVIE_EP } from './movies';
import { markFinalAnswer } from './laya/examples';

// «Скачать» из ручного поиска (экран и API): серия — по плану (серия/пак), сезон — пак целиком, фильм — основной файл.

export type ManualDownloadDeps = { qbit: Qbit | null; paths: Paths | undefined; fetchTorrent?: (r: Release) => Promise<Buffer | { magnet: string }> };
type Result = { ok: string } | { error: string };

export async function downloadRelease(db: Db, deps: ManualDownloadDeps, a: { title: Title; releaseId: number; season?: number | null; episode?: number | null }): Promise<Result> {
  const { qbit, paths } = deps;
  if (!qbit || !paths) return { error: 'Подключите qBittorrent и папки в настройках' };
  const release = db.select().from(releases).where(eq(releases.id, a.releaseId)).get();
  if (!release || release.titleId !== a.title.id) return { error: 'Раздача не найдена' };
  const dl = { qbit, fetchTorrent: deps.fetchTorrent ?? ((r: Release) => fetchTorrentFile(r)), paths: { qbitDownloads: paths.qbitDownloads ?? paths.downloads } };
  if (a.title.kind === 'movie') return downloadMovie(db, dl, paths, a.title, release);
  const season = a.season;
  const episode = a.episode ?? null;
  if (!season) return { error: 'Неверные данные' };
  const eps = listEpisodes(db, a.title.id, season).filter((e) => e.airDate && e.airDate <= todayIso());
  if (episode && !eps.some((e) => e.number === episode)) return { error: 'Такой вышедшей серии нет' };
  const p = release.parsed;
  const want = episode
    ? [{ season, number: episode }]
    : eps.filter((e) => !p.episodes || (e.number >= p.episodes.from && e.number <= p.episodes.to)).map((e) => ({ season, number: e.number }));
  if (!want.length) return { error: 'Нет вышедших серий для этой раздачи' };
  const known = p.dubs.find((d) => d.studioId !== null);
  const label = known ? (listStudios(db).find((s) => s.id === known.studioId)?.name ?? known.label) : (p.dubs[0]?.label ?? null);
  try {
    const d = await startRelease(db, dl, release, want, episode ? (p.pack ? 'pack' : 'episode') : 'season', label);
    if (d.state === 'error') return { error: d.lastError ?? 'Ошибка загрузки' };
    markFinalAnswer(db, a.title, release, true); // скачал вручную то, что отклонила Laya, — пример «да»
    for (const e of want)
      db.delete(wantedState).where(and(eq(wantedState.titleId, a.title.id), eq(wantedState.season, e.season), eq(wantedState.number, e.number))).run();
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  return { ok: 'Добавлено в загрузки' };
}

/** Фильм: основной файл раздачи, подпись — тип перевода по профилю. */
async function downloadMovie(db: Db, dl: Parameters<typeof startRelease>[1], paths: Paths, title: Title, release: Release): Promise<Result> {
  if (!paths.movies) return { error: 'Задайте папку фильмов в «Загрузке и папках»' };
  const sub = getSubscription(db, title.id);
  const profile = sub && isMovieProfile(sub.profile) ? sub.profile : getMovieDefault(db);
  const kinds = movieKinds(release.parsed);
  const pos = profile.dubs.findIndex((d) => d.on && kinds.includes(d.kind));
  const kind = pos >= 0 ? profile.dubs[pos].kind : kinds[0];
  const label = kind === 'original' ? 'Оригинал' : kind ? MOVIE_DUB_LABEL[kind] : null;
  try {
    const d = await startRelease(db, dl, release, [MOVIE_EP], 'movie', label, { dubPosition: pos >= 0 ? pos : null });
    if (d.state === 'error') return { error: d.lastError ?? 'Ошибка загрузки' };
    markFinalAnswer(db, title, release, true);
    db.delete(wantedState).where(and(eq(wantedState.titleId, title.id), eq(wantedState.season, 0), eq(wantedState.number, 0))).run();
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  return { ok: 'Добавлено в загрузки' };
}
