import type { Db } from './db/client';
import type { Tmdb } from './tmdb/client';
import type { TmdbListItem, TmdbTvListItem } from './tmdb/types';
import { isAnime } from './tmdb/map';
import { upcomingTitles } from './catalog';

export type Card = { tmdbId: number; name: string; year: number | null; posterPath: string | null; anime: boolean; movie?: boolean };
export type UpcomingCard = Card & { nextAirDate: string };

export const toCard = (i: TmdbTvListItem): Card => ({
  tmdbId: i.id,
  name: i.name,
  year: i.first_air_date ? Number(i.first_air_date.slice(0, 4)) : null,
  posterPath: i.poster_path,
  anime: isAnime(i.genre_ids, i.origin_country),
});

const movieCard = (i: TmdbListItem): Card => ({
  tmdbId: i.id,
  name: i.title ?? i.name ?? '',
  year: i.release_date ? Number(i.release_date.slice(0, 4)) : null,
  posterPath: i.poster_path,
  anime: false,
  movie: true,
});

/** Фильмы из search/multi или trending/all; сбой — пустой список (сериалы важнее). */
async function movies(load: () => Promise<TmdbListItem[]>): Promise<Card[]> {
  try {
    return (await load()).filter((i) => i.media_type === 'movie').map(movieCard);
  } catch {
    return [];
  }
}

export type DiscoverData =
  | { mode: 'no-key' }
  | { mode: 'search'; query: string; cards: Card[]; error?: string }
  | { mode: 'home'; trending: Card[]; movies: Card[]; upcoming: UpcomingCard[]; error?: string };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function loadDiscover(db: Db, tmdb: Tmdb | null, q: string | undefined, today: string): Promise<DiscoverData> {
  if (!tmdb) return { mode: 'no-key' };
  const query = q?.trim() ?? '';
  if (query.length >= 2) {
    try {
      const [tv, film] = await Promise.all([tmdb.search(query), movies(() => tmdb.searchMulti(query))]);
      return { mode: 'search', query, cards: [...tv.map(toCard), ...film] };
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
  const film = await movies(() => tmdb.trendingAll());
  try {
    return { mode: 'home', trending: (await tmdb.trending()).map(toCard), movies: film, upcoming };
  } catch (e) {
    return { mode: 'home', trending: [], movies: film, upcoming, error: message(e) };
  }
}
