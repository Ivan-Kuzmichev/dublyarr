'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { DENIED, guard } from '@/lib/auth/current';
import { getSetting } from '@/lib/settings';
import { getQbit } from '@/lib/qbit';
import { getTitleByTmdbId } from '@/lib/catalog';
import { deleteEpisodes, deleteSeries, parsePicks } from '@/lib/delete-series';
import { runRetention } from '@/lib/retention';
import { getRetention, setSeriesExceptions } from '@/lib/retention-settings';
import { formatSize } from '@/lib/format';
import type { Paths } from '@/lib/downloads';
import { enqueue } from '@/worker/jobs';
import { getTmdb } from '@/lib/tmdb';
import { can } from '@/lib/auth/permissions';
import { buildChoices, getScanState, updateScanState, type AdoptPick, type MediaScanState } from '@/lib/media-scan/state';
import { tmdbSearch, type Candidate } from '@/lib/media-scan/recognize';

export type ActionState = { ok?: string; error?: string };

const MODES = ['all', 'files', 'sub', 'episodes'] as const;

export async function deleteSeriesAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  if (!(await guard('storage'))) return { error: DENIED };
  const db = getDb();
  const tmdbId = Number(form.get('tmdbId'));
  const mode = String(form.get('mode')) as (typeof MODES)[number];
  if (!Number.isInteger(tmdbId) || !MODES.includes(mode)) return { error: 'Неверные данные' };
  const t = getTitleByTmdbId(db, tmdbId, form.get('type') === 'movie' ? 'movie' : 'tv');
  const paths = getSetting<Paths>(db, 'paths');
  if (!t || !paths) return { error: 'Сериал или папки не найдены' };
  try {
    if (mode === 'episodes') {
      const picks = parsePicks(form.getAll('ep').map(String));
      if (!picks.length) return { error: 'Отметьте сезоны или серии' };
      const r = await deleteEpisodes(db, { paths }, t.id, picks);
      revalidatePath('/storage');
      revalidatePath('/library');
      revalidatePath(`/series/${tmdbId}`);
      const later = r.later ? ` · ещё ${formatSize(r.later)} — после окончания раздачи` : '';
      return { ok: `Удалено файлов: ${r.files} · ${formatSize(r.freed)}${later}` };
    }
    const r = await deleteSeries(db, { qbit: getQbit(db), paths }, t.id, mode);
    revalidatePath('/storage');
    revalidatePath('/library');
    revalidatePath(t.kind === 'movie' ? `/movie/${tmdbId}` : `/series/${tmdbId}`);
    return { ok: mode === 'sub' ? 'Подписка удалена' : `Удалено файлов: ${r.files} · ${formatSize(r.freed)}` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Первая уборка по правилу: удалить отмеченное, правило дальше работает само. */
export async function confirmRetentionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  if (!(await guard('storage'))) return { error: DENIED };
  const db = getDb();
  const paths = getSetting<Paths>(db, 'paths');
  if (!paths) return { error: 'Не настроены папки' };
  const keys = form
    .getAll('key')
    .map(String)
    .filter((k) => /^[soa]:[\d:,]+$/.test(k));
  if (!keys.length) return { error: 'Ничего не отмечено' };
  const r = await runRetention(db, paths, getRetention(db), Date.now(), { confirmKeys: keys });
  revalidatePath('/storage');
  revalidatePath('/');
  return { ok: `Удалено файлов: ${r.deleted} · освобождено ${formatSize(r.freed)}` };
}

/** Исключения сериала: «хранить все сезоны», «удалять через N дней». */
export async function setExceptionsAction(form: FormData) {
  if (!(await guard('storage'))) return;
  const db = getDb();
  const t = getTitleByTmdbId(db, Number(form.get('tmdbId')), form.get('type') === 'movie' ? 'movie' : 'tv');
  if (!t) return;
  setSeriesExceptions(db, t.id, { keepAll: form.get('keepAll') === 'on', autoDelete: form.get('autoDelete') === 'on' });
  revalidatePath(t.kind === 'movie' ? `/movie/${t.tmdbId}` : `/series/${t.tmdbId}`);
  revalidatePath('/storage');
}

// --- Сканирование медиатеки (2.7) ---

/** «Сканировать»: обход медиатеки в воркере; окно — по готовности. */
export async function startMediaScanAction(): Promise<ActionState> {
  if (!(await guard('storage'))) return { error: DENIED };
  const db = getDb();
  if (!getSetting<Paths>(db, 'paths')) return { error: 'Сначала укажите папки в «Настройки → Загрузка и папки»' };
  if (getScanState(db).status !== 'idle') return { error: 'Уже идёт' };
  updateScanState(db, { status: 'scanning', progress: { done: 0, total: 0 } });
  enqueue(db, 'media.scan');
  return { ok: 'Сканирую…' };
}

export async function mediaScanStateAction(): Promise<MediaScanState | null> {
  if (!(await guard('storage'))) return null;
  return getScanState(getDb());
}

/** Поиск в окне («Это не он»): тот же TMDB, что «Поиск и тренды». */
export async function searchCandidatesAction(q: string, type: 'tv' | 'movie'): Promise<Candidate[]> {
  if (!(await guard('storage'))) return [];
  const tmdb = getTmdb(getDb());
  if (!tmdb || q.trim().length < 2) return [];
  try {
    return await tmdbSearch(tmdb)(q.trim(), type === 'movie' ? 'movie' : 'tv');
  } catch {
    return [];
  }
}

/** «Добавить»: только позиции и серии из сохранённого сканирования (пути с клиента не принимаются как есть). */
export async function adoptMediaAction(picks: AdoptPick[]): Promise<ActionState> {
  const s = await guard('storage');
  if (!s) return { error: DENIED };
  const db = getDb();
  const state = getScanState(db);
  if (state.status !== 'idle') return { error: 'Уже идёт' };
  const choices = buildChoices(state, picks);
  if (!choices.length) return { error: 'Ничего не отмечено' };
  updateScanState(db, { status: 'adopting', progress: { done: 0, total: choices.length } });
  enqueue(db, 'media.adopt', { choices, canSubscribe: can(s.user, 'subscribe') });
  return { ok: `Добавляю ${choices.length}…` };
}
