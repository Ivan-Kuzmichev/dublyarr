'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { requireSession } from '@/lib/auth/current';
import { getTitleByTmdbId } from '@/lib/catalog';
import { answerMatch, assignStudio } from '@/lib/manual-search';
import { StudioError, listStudios } from '@/lib/studios';
import { and, eq } from 'drizzle-orm';
import { releases, wantedState } from '@/lib/db/schema';
import { listEpisodes } from '@/lib/catalog';
import { getQbit } from '@/lib/qbit';
import { getSetting } from '@/lib/settings';
import { fetchTorrentFile, startRelease, type Paths } from '@/lib/downloads';
import { todayIso } from '@/lib/dates';
import type { Title } from '@/lib/db/schema';
import { getSubscription } from '@/lib/subscriptions';
import { isMovieProfile, MOVIE_DUB_LABEL } from '@/lib/movie-profile';
import { getMovieDefault } from '@/lib/profile';
import { movieKinds } from '@/lib/movie-evaluate';
import { MOVIE_EP } from '@/lib/movies';
import { markFinalAnswer } from '@/lib/laya/examples';
import { correctAnime } from '@/lib/laya/review';

export type AssignState = { ok?: boolean; error?: string };

const positive = (v: FormDataEntryValue | null) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

function titleOf(form: FormData) {
  const tmdbId = positive(form.get('tmdbId'));
  const title = tmdbId ? getTitleByTmdbId(getDb(), tmdbId, form.get('type') === 'movie' ? 'movie' : 'tv') : undefined;
  return title ? { tmdbId: tmdbId!, title } : null;
}

export async function assignStudioAction(_prev: AssignState, form: FormData): Promise<AssignState> {
  await requireSession();
  const t = titleOf(form);
  if (!t) return { error: 'Сериал не найден' };
  const label = String(form.get('label') ?? '').trim();
  if (!label) return { error: 'Нет подписи студии' };
  const choice = String(form.get('studio') ?? '');
  try {
    if (choice === 'new') {
      const newName = String(form.get('newName') ?? '').trim() || label;
      assignStudio(getDb(), t.title.id, { label, newName });
    } else {
      const studioId = positive(choice);
      if (!studioId) return { error: 'Выберите студию' };
      assignStudio(getDb(), t.title.id, { label, studioId });
    }
  } catch (e) {
    if (e instanceof StudioError || e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath(`/search/${t.tmdbId}`);
  return { ok: true };
}

export async function answerMatchAction(form: FormData) {
  await requireSession();
  const t = titleOf(form);
  const releaseId = positive(form.get('releaseId'));
  const verdict = form.get('verdict');
  if (!t || !releaseId || (verdict !== 'match' && verdict !== 'reject')) return;
  answerMatch(getDb(), t.title.id, releaseId, verdict);
  revalidatePath(`/search/${t.tmdbId}`);
}

export type DownloadState = { ok?: string; error?: string };

/** «Скачать» из ручного поиска: серия — по плану (серия/пак), сезон — пак целиком. */
export async function downloadAction(_prev: DownloadState, form: FormData): Promise<DownloadState> {
  await requireSession();
  const t = titleOf(form);
  const releaseId = positive(form.get('releaseId'));
  const season = positive(form.get('season'));
  const episode = positive(form.get('episode'));
  if (t?.title.kind === 'movie' && releaseId) return downloadMovie(t.title, releaseId);
  if (!t || !releaseId || !season) return { error: 'Неверные данные' };
  const db = getDb();
  const qbit = getQbit(db);
  const paths = getSetting<Paths>(db, 'paths');
  if (!qbit || !paths) return { error: 'Подключите qBittorrent и папки в настройках' };
  const release = db.select().from(releases).where(eq(releases.id, releaseId)).get();
  if (!release || release.titleId !== t.title.id) return { error: 'Раздача не найдена' };
  const eps = listEpisodes(db, t.title.id, season).filter((e) => e.airDate && e.airDate <= todayIso());
  if (episode && !eps.some((e) => e.number === episode)) return { error: 'Такой вышедшей серии нет' };
  const p = release.parsed;
  const want = episode
    ? [{ season, number: episode }]
    : eps.filter((e) => !p.episodes || (e.number >= p.episodes.from && e.number <= p.episodes.to)).map((e) => ({ season, number: e.number }));
  if (!want.length) return { error: 'Нет вышедших серий для этой раздачи' };
  const known = p.dubs.find((d) => d.studioId !== null);
  const label = known ? (listStudios(db).find((s) => s.id === known.studioId)?.name ?? known.label) : (p.dubs[0]?.label ?? null);
  try {
    const d = await startRelease(
      db,
      { qbit, fetchTorrent: (r) => fetchTorrentFile(r), paths: { qbitDownloads: paths.qbitDownloads ?? paths.downloads } },
      release,
      want,
      episode ? (p.pack ? 'pack' : 'episode') : 'season',
      label,
    );
    if (d.state === 'error') return { error: d.lastError ?? 'Ошибка загрузки' };
    markFinalAnswer(db, t.title, release, true); // скачал вручную то, что отклонила Laya, — пример «да»
    for (const e of want)
      db.delete(wantedState).where(and(eq(wantedState.titleId, t.title.id), eq(wantedState.season, e.season), eq(wantedState.number, e.number))).run();
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath('/activity');
  return { ok: 'Добавлено в загрузки' };
}

/** «Скачать» фильм из ручного поиска: основной файл раздачи, подпись — тип перевода по профилю. */
async function downloadMovie(title: Title, releaseId: number): Promise<DownloadState> {
  const db = getDb();
  const qbit = getQbit(db);
  const paths = getSetting<Paths>(db, 'paths');
  if (!qbit || !paths) return { error: 'Подключите qBittorrent и папки в настройках' };
  if (!paths.movies) return { error: 'Задайте папку фильмов в «Загрузке и папках»' };
  const release = db.select().from(releases).where(eq(releases.id, releaseId)).get();
  if (!release || release.titleId !== title.id) return { error: 'Раздача не найдена' };
  const sub = getSubscription(db, title.id);
  const profile = sub && isMovieProfile(sub.profile) ? sub.profile : getMovieDefault(db);
  const kinds = movieKinds(release.parsed);
  const pos = profile.dubs.findIndex((d) => d.on && kinds.includes(d.kind));
  const kind = pos >= 0 ? profile.dubs[pos].kind : kinds[0];
  const label = kind === 'original' ? 'Оригинал' : kind ? MOVIE_DUB_LABEL[kind] : null;
  try {
    const d = await startRelease(db, { qbit, fetchTorrent: (r) => fetchTorrentFile(r), paths: { qbitDownloads: paths.qbitDownloads ?? paths.downloads } }, release, [MOVIE_EP], 'movie', label, { dubPosition: pos >= 0 ? pos : null });
    if (d.state === 'error') return { error: d.lastError ?? 'Ошибка загрузки' };
    markFinalAnswer(db, title, release, true);
    db.delete(wantedState).where(and(eq(wantedState.titleId, title.id), eq(wantedState.season, 0), eq(wantedState.number, 0))).run();
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath('/activity');
  return { ok: 'Добавлено в загрузки' };
}

/** Исправить нумерацию аниме (варианты — как у Laya): ответ пользователя окончательный и идёт в дообучение. */
export async function correctAnimeAction(form: FormData) {
  await requireSession();
  const t = titleOf(form);
  const releaseId = positive(form.get('releaseId'));
  const label = String(form.get('label') ?? '');
  if (!t || !releaseId || !label) return;
  correctAnime(getDb(), t.title.id, releaseId, label);
  revalidatePath(`/search/${t.tmdbId}`);
}
