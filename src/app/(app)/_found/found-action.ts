'use server';

import { getDb } from '@/lib/db/client';
import { requireSession } from '@/lib/auth/current';
import { getTitleByTmdbId } from '@/lib/catalog';
import { foundMovieKinds, foundStudios } from '@/lib/found-studios';
import { requestTitleSearch, titleSearchPending } from '@/lib/title-search';
import type { MovieDubKind } from '@/lib/movie-profile';

export type Found = { studios: Record<number, number>; kinds: Partial<Record<MovieDubKind, number>>; searching: boolean };

/** Что уже нашлось на трекерах для окна подписки; поиск ставится, если давно не искали. */
export async function foundAction(tmdbId: number, type: 'tv' | 'movie'): Promise<Found> {
  await requireSession();
  const db = getDb();
  const t = getTitleByTmdbId(db, tmdbId, type);
  if (!t) return { studios: {}, kinds: {}, searching: false };
  requestTitleSearch(db, t.id);
  return { studios: foundStudios(db, t.id), kinds: type === 'movie' ? foundMovieKinds(db, t.id) : {}, searching: titleSearchPending(db, t.id) };
}
