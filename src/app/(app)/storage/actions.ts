'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { requireSession } from '@/lib/auth/current';
import { getSetting } from '@/lib/settings';
import { getQbit } from '@/lib/qbit';
import { getTitleByTmdbId } from '@/lib/catalog';
import { deleteSeries } from '@/lib/delete-series';
import { runRetention } from '@/lib/retention';
import { getRetention, setSeriesExceptions } from '@/lib/retention-settings';
import { formatSize } from '@/lib/format';
import type { Paths } from '@/lib/downloads';

export type ActionState = { ok?: string; error?: string };

const MODES = ['all', 'files', 'sub'] as const;

export async function deleteSeriesAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireSession();
  const db = getDb();
  const tmdbId = Number(form.get('tmdbId'));
  const mode = String(form.get('mode')) as (typeof MODES)[number];
  if (!Number.isInteger(tmdbId) || !MODES.includes(mode)) return { error: 'Неверные данные' };
  const t = getTitleByTmdbId(db, tmdbId);
  const paths = getSetting<Paths>(db, 'paths');
  if (!t || !paths) return { error: 'Сериал или папки не найдены' };
  try {
    const r = await deleteSeries(db, { qbit: getQbit(db), paths }, t.id, mode);
    revalidatePath('/storage');
    revalidatePath('/library');
    revalidatePath(`/series/${tmdbId}`);
    return { ok: mode === 'sub' ? 'Подписка удалена' : `Удалено файлов: ${r.files} · ${formatSize(r.freed)}` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Первая уборка по правилу: удалить отмеченное, правило дальше работает само. */
export async function confirmRetentionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireSession();
  const db = getDb();
  const paths = getSetting<Paths>(db, 'paths');
  if (!paths) return { error: 'Не настроены папки' };
  const keys = form
    .getAll('key')
    .map(String)
    .filter((k) => /^[soa]:[\d:,]+$/.test(k));
  if (!keys.length) return { error: 'Ничего не отмечено' };
  const r = await runRetention(db, paths.media, getRetention(db), Date.now(), { confirmKeys: keys });
  revalidatePath('/storage');
  revalidatePath('/');
  return { ok: `Удалено файлов: ${r.deleted} · освобождено ${formatSize(r.freed)}` };
}

/** Исключения сериала: «хранить все сезоны», «удалять через N дней». */
export async function setExceptionsAction(form: FormData) {
  await requireSession();
  const db = getDb();
  const t = getTitleByTmdbId(db, Number(form.get('tmdbId')));
  if (!t) return;
  setSeriesExceptions(db, t.id, { keepAll: form.get('keepAll') === 'on', autoDelete: form.get('autoDelete') === 'on' });
  revalidatePath(`/series/${t.tmdbId}`);
  revalidatePath('/storage');
}
