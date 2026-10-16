'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { DENIED, guard } from '@/lib/auth/current';
import { getTitleByTmdbId, setKind, syncTitle } from '@/lib/catalog';
import { getTmdb } from '@/lib/tmdb';
import { getSubscription, setFilesOnly } from '@/lib/subscriptions';

export type RefreshState = { error?: string };

export async function refreshTitleAction(_prev: RefreshState, form: FormData): Promise<RefreshState> {
  if (!(await guard('search'))) return { error: DENIED };
  const db = getDb();
  const tmdb = getTmdb(db);
  const tmdbId = Number(form.get('tmdbId'));
  if (!tmdb) return { error: 'Добавьте ключ TMDB в настройках' };
  try {
    await syncTitle(db, tmdb, tmdbId, { allSeasons: true });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath(`/series/${tmdbId}`);
  return {};
}

export async function setKindAction(tmdbId: number, kind: 'series' | 'anime') {
  if (!(await guard('search'))) return;
  const db = getDb();
  const t = getTitleByTmdbId(db, tmdbId);
  if (!t) return;
  setKind(db, t.id, kind);
  revalidatePath(`/series/${tmdbId}`);
}

/** «Включить подписку» у сериала «только файлы»: дальше Dublyarr ищет и качает по профилю (2.7). */
export async function enableSubscriptionAction(_prev: RefreshState, form: FormData): Promise<RefreshState> {
  if (!(await guard('subscribe'))) return { error: DENIED };
  const db = getDb();
  const t = getTitleByTmdbId(db, Number(form.get('tmdbId')), form.get('type') === 'movie' ? 'movie' : 'tv');
  if (!t || !getSubscription(db, t.id)) return { error: 'Подписки нет' };
  setFilesOnly(db, t.id, false);
  revalidatePath(form.get('type') === 'movie' ? `/movie/${t.tmdbId}` : `/series/${t.tmdbId}`);
  revalidatePath('/library');
  return {};
}
