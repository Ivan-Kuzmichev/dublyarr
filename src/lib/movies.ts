import { and, eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { titles, type Title } from './db/schema';
import type { Tmdb } from './tmdb/client';
import { mapMovie } from './tmdb/map';

// Фильмы (spec §10): запись каталога с kind = 'movie'; файл — в episode_files под условным номером S00E00.

export const MOVIE_EP = { season: 0, number: 0 } as const;

const STALE_MS = 12 * 3_600_000;

export async function syncMovie(db: Db, tmdb: Tmdb, tmdbId: number, now = Date.now()): Promise<Title> {
  const fields = mapMovie(await tmdb.movie(tmdbId));
  return db
    .insert(titles)
    .values({ ...fields, refreshedAt: now, createdAt: now })
    .onConflictDoUpdate({ target: [titles.tmdbType, titles.tmdbId], set: { ...fields, refreshedAt: now } })
    .returning()
    .get();
}

/** Для карточки фильма: из базы, при необходимости освежив; TMDB недоступен — сохранённое. */
export async function openMovie(db: Db, tmdb: Tmdb | null, tmdbId: number, now = Date.now()): Promise<{ title: Title; stale: boolean; error?: string }> {
  const existing = db.select().from(titles).where(and(eq(titles.tmdbType, 'movie'), eq(titles.tmdbId, tmdbId))).get();
  if (!existing) {
    if (!tmdb) throw new Error('Добавьте ключ TMDB в настройках');
    return { title: await syncMovie(db, tmdb, tmdbId, now), stale: false };
  }
  if (now - existing.refreshedAt < STALE_MS || !tmdb) return { title: existing, stale: false };
  try {
    return { title: await syncMovie(db, tmdb, tmdbId, now), stale: false };
  } catch (e) {
    return { title: existing, stale: true, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Дата цифрового релиза, если он уже был: цифровой/физический в TMDB или первая цифровая раздача. Иначе null. */
export function digitalReleased(t: Pick<Title, 'releaseDates' | 'digitalSeenAt'>, today: string): string | null {
  const dates = [t.releaseDates?.digital, t.releaseDates?.physical, t.digitalSeenAt].filter((d): d is string => !!d && d <= today).sort();
  return dates[0] ?? null;
}
