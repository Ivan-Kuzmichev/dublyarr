'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { requireSession } from '@/lib/auth/current';
import { setSetting } from '@/lib/settings';
import { validateMovieProfile } from '@/lib/movie-profile';

export type SaveState = { ok?: string; error?: string };

/** Профиль фильма по умолчанию: подставляется в новые подписки на фильмы. */
export async function saveMovieDefaultAction(_prev: SaveState, form: FormData): Promise<SaveState> {
  await requireSession();
  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get('profile') ?? ''));
  } catch {
    return { error: 'Неверные настройки фильма' };
  }
  const r = validateMovieProfile(raw);
  if (!r.ok) return { error: r.error };
  setSetting(getDb(), 'profile.movie', r.profile);
  revalidatePath('/settings/movies');
  return { ok: 'Сохранено — для новых подписок на фильмы' };
}
