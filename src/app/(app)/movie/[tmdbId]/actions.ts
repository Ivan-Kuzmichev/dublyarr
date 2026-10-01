'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { requireSession } from '@/lib/auth/current';
import { getTitleByTmdbId } from '@/lib/catalog';
import { getTmdb } from '@/lib/tmdb';
import { syncMovie } from '@/lib/movies';
import { validateMovieProfile } from '@/lib/movie-profile';
import { subscribe, unsubscribe, updateSubscription, SubscriptionError } from '@/lib/subscriptions';
import type { DialogState } from '@/components/subscribe/SubscribeDialog';

export async function saveMovieSubscriptionAction(_prev: DialogState, form: FormData): Promise<DialogState> {
  await requireSession();
  const db = getDb();
  const tmdbId = Number(form.get('tmdbId'));
  const title = Number.isInteger(tmdbId) && tmdbId > 0 ? getTitleByTmdbId(db, tmdbId, 'movie') : undefined;
  if (!title) return { error: 'Фильм не найден' };
  const intent = form.get('intent');
  try {
    if (intent === 'unsubscribe') unsubscribe(db, title.id);
    else if (intent === 'subscribe' || intent === 'save') {
      let raw: unknown;
      try {
        raw = JSON.parse(String(form.get('profile') ?? ''));
      } catch {
        return { error: 'Неверные настройки фильма' };
      }
      const r = validateMovieProfile(raw);
      if (!r.ok) return { error: r.error };
      // новая подписка ищется на ближайшем проходе расписания (раз в 5 минут)
      if (intent === 'subscribe') subscribe(db, title.id, r.profile);
      else updateSubscription(db, title.id, r.profile);
    } else return { error: 'Неверное действие' };
  } catch (e) {
    if (e instanceof SubscriptionError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/movie/${tmdbId}`);
  revalidatePath('/library');
  return { ok: true };
}

export type RefreshState = { error?: string };

export async function refreshMovieAction(_prev: RefreshState, form: FormData): Promise<RefreshState> {
  await requireSession();
  const db = getDb();
  const tmdb = getTmdb(db);
  const tmdbId = Number(form.get('tmdbId'));
  if (!tmdb) return { error: 'Добавьте ключ TMDB в настройках' };
  try {
    await syncMovie(db, tmdb, tmdbId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath(`/movie/${tmdbId}`);
  return {};
}
