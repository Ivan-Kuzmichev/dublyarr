import type { Tmdb } from '@/lib/tmdb/client';
import type { TmdbSeason, TmdbTvDetails } from '@/lib/tmdb/types';

/** Клиент TMDB на фикстурах; calls — какие запросы были. */
export function fakeTmdb(data: { details: Record<number, TmdbTvDetails>; seasons: Record<string, TmdbSeason> }) {
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
    search: async () => [],
    trending: async () => [],
  };
  return { tmdb, calls };
}
