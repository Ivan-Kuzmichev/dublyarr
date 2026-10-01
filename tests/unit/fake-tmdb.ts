import type { Tmdb } from '@/lib/tmdb/client';
import type { TmdbMovieDetails, TmdbSeason, TmdbTvDetails } from '@/lib/tmdb/types';

/** Клиент TMDB на фикстурах; calls — какие запросы были. */
export function fakeTmdb(data: { details: Record<number, TmdbTvDetails>; seasons: Record<string, TmdbSeason>; movies?: Record<number, TmdbMovieDetails> }) {
  const calls: string[] = [];
  const tmdb: Tmdb = {
    configuration: async () => {},
    details: async (id) => {
      calls.push(`details:${id}`);
      const d = data.details[id];
      if (!d) throw new Error('404');
      return structuredClone(d);
    },
    season: async (id, n) => {
      calls.push(`season:${id}:${n}`);
      return structuredClone(data.seasons[`${id}:${n}`] ?? { season_number: n, episodes: [] });
    },
    movie: async (id) => {
      calls.push(`movie:${id}`);
      const d = data.movies?.[id];
      if (!d) throw new Error('404');
      return structuredClone(d);
    },
    search: async () => [],
    trending: async () => [],
    searchMulti: async () => [],
    trendingAll: async () => [],
  };
  return { tmdb, calls };
}
