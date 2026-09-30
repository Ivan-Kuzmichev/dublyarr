import type { Db } from './db/client';
import type { Tmdb } from './tmdb/client';
import type { TmdbTvListItem } from './tmdb/types';
import { isAnime } from './tmdb/map';
import { upcomingTitles } from './catalog';

export type Card = { tmdbId: number; name: string; year: number | null; posterPath: string | null; anime: boolean };
export type UpcomingCard = Card & { nextAirDate: string };

export const toCard = (i: TmdbTvListItem): Card => ({
  tmdbId: i.id,
  name: i.name,
  year: i.first_air_date ? Number(i.first_air_date.slice(0, 4)) : null,
  posterPath: i.poster_path,
  anime: isAnime(i.genre_ids, i.origin_country),
});

export type DiscoverData =
  | { mode: 'no-key' }
  | { mode: 'search'; query: string; cards: Card[]; error?: string }
  | { mode: 'home'; trending: Card[]; upcoming: UpcomingCard[]; error?: string };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function loadDiscover(db: Db, tmdb: Tmdb | null, q: string | undefined, today: string): Promise<DiscoverData> {
  if (!tmdb) return { mode: 'no-key' };
  const query = q?.trim() ?? '';
  if (query.length >= 2) {
    try {
      return { mode: 'search', query, cards: (await tmdb.search(query)).map(toCard) };
    } catch (e) {
      return { mode: 'search', query, cards: [], error: message(e) };
    }
  }
  const upcoming = upcomingTitles(db, today).map((t) => ({
    tmdbId: t.tmdbId,
    name: t.nameRu,
    year: t.year,
    posterPath: t.posterPath,
    anime: t.kind === 'anime',
    nextAirDate: t.nextAirDate!,
  }));
  try {
    return { mode: 'home', trending: (await tmdb.trending()).map(toCard), upcoming };
  } catch (e) {
    return { mode: 'home', trending: [], upcoming, error: message(e) };
  }
}
