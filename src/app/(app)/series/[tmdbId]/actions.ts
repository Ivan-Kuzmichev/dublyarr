'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { requireSession } from '@/lib/auth/current';
import { getTitleByTmdbId, setKind, syncTitle } from '@/lib/catalog';
import { getTmdb } from '@/lib/tmdb';

export type RefreshState = { error?: string };

export async function refreshTitleAction(_prev: RefreshState, form: FormData): Promise<RefreshState> {
  await requireSession();
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
  await requireSession();
  const db = getDb();
  const t = getTitleByTmdbId(db, tmdbId);
  if (!t) return;
  setKind(db, t.id, kind);
  revalidatePath(`/series/${tmdbId}`);
}
