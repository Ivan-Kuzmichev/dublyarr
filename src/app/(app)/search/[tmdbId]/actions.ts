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

export type AssignState = { ok?: boolean; error?: string };

const positive = (v: FormDataEntryValue | null) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

function titleOf(form: FormData) {
  const tmdbId = positive(form.get('tmdbId'));
  const title = tmdbId ? getTitleByTmdbId(getDb(), tmdbId) : undefined;
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
    for (const e of want)
      db.delete(wantedState).where(and(eq(wantedState.titleId, t.title.id), eq(wantedState.season, e.season), eq(wantedState.number, e.number))).run();
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath('/activity');
  return { ok: 'Добавлено в загрузки' };
}
