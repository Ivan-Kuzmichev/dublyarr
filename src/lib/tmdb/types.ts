// Только те поля ответов TMDB API v3, которые использует Dublyarr.

export type TmdbTvDetails = {
  id: number;
  name: string;
  original_name: string;
  original_language: string;
  overview: string;
  first_air_date: string | null;
  last_air_date: string | null;
  status: string;
  genres: { id: number; name: string }[];
  origin_country: string[];
  networks: { name: string }[];
  poster_path: string | null;
  backdrop_path: string | null;
  number_of_seasons: number;
  next_episode_to_air: { air_date: string | null } | null;
  seasons: { season_number: number; name: string; air_date: string | null; episode_count: number; poster_path: string | null }[];
  alternative_titles?: { results: { iso_3166_1: string; title: string; type: string }[] };
};

export type TmdbSeason = {
  season_number: number;
  episodes: { episode_number: number; name: string; air_date: string | null; runtime: number | null }[];
};

export type TmdbTvListItem = {
  id: number;
  name: string;
  original_name: string;
  first_air_date?: string;
  poster_path: string | null;
  genre_ids: number[];
  origin_country: string[];
};

export type TmdbPage<T> = { page: number; results: T[]; total_results: number };
