'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { DENIED, guard } from '@/lib/auth/current';
import { getTitleByTmdbId } from '@/lib/catalog';
import { answerMatch, assignStudio } from '@/lib/manual-search';
import { StudioError } from '@/lib/studios';
import { getQbit } from '@/lib/qbit';
import { getSetting } from '@/lib/settings';
import type { Paths } from '@/lib/downloads';
import { downloadRelease } from '@/lib/manual-download';
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
  if (!(await guard('answer'))) return { error: DENIED };
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
  if (!(await guard('answer'))) return;
  const t = titleOf(form);
  const releaseId = positive(form.get('releaseId'));
  const verdict = form.get('verdict');
  if (!t || !releaseId || (verdict !== 'match' && verdict !== 'reject')) return;
  answerMatch(getDb(), t.title.id, releaseId, verdict);
  revalidatePath(`/search/${t.tmdbId}`);
}

export type DownloadState = { ok?: string; error?: string };

/** «Скачать» из ручного поиска: серия — по плану (серия/пак), сезон — пак целиком, фильм — основной файл. */
export async function downloadAction(_prev: DownloadState, form: FormData): Promise<DownloadState> {
  if (!(await guard('search'))) return { error: DENIED };
  const t = titleOf(form);
  const releaseId = positive(form.get('releaseId'));
  if (!t || !releaseId) return { error: 'Неверные данные' };
  const db = getDb();
  const r = await downloadRelease(db, { qbit: getQbit(db), paths: getSetting<Paths>(db, 'paths') }, { title: t.title, releaseId, season: positive(form.get('season')), episode: positive(form.get('episode')) });
  if ('ok' in r) revalidatePath('/activity');
  return r;
}

/** Исправить нумерацию аниме (варианты — как у Laya): ответ пользователя окончательный и идёт в дообучение. */
export async function correctAnimeAction(form: FormData) {
  if (!(await guard('answer'))) return;
  const t = titleOf(form);
  const releaseId = positive(form.get('releaseId'));
  const label = String(form.get('label') ?? '');
  if (!t || !releaseId || !label) return;
  correctAnime(getDb(), t.title.id, releaseId, label);
  revalidatePath(`/search/${t.tmdbId}`);
}
