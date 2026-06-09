const BASE = "https://api.themoviedb.org/3";

export type TmdbType = "movie" | "tv";

export interface TmdbSearchResult {
  id: number;
  type: TmdbType;
  title: string;
  originalTitle: string;
  year: string;
  overview: string;
  posterPath: string | null;
  rating: number;
  popularity: number;
}

export interface TmdbDetails extends Omit<TmdbSearchResult, "popularity"> {
  status: string | null;
  seasons: number | null;
  episodes: number | null;
  genres: string[];
  imdbId: string | null;
  tvdbId: number | null;
  firstAirDate: string | null;
  lastAirDate: string | null;
}

async function tmdbGet(path: string, params: Record<string, string>, apiKey: string) {
  const url = new URL(BASE + path);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("language", "ru-RU");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TMDb ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function yearOf(item: any): string {
  const d = item.release_date || item.first_air_date || "";
  return d.slice(0, 4) || "—";
}

export function normalizeSearchResults(data: any): TmdbSearchResult[] {
  return ((data.results ?? []) as any[])
    .filter((r) => r.media_type === "movie" || r.media_type === "tv")
    .map((r) => ({
      id: r.id,
      type: r.media_type as TmdbType,
      title: r.title || r.name || "",
      originalTitle: r.original_title || r.original_name || "",
      year: yearOf(r),
      overview: r.overview || "",
      posterPath: r.poster_path ?? null,
      rating: r.vote_average ?? 0,
      popularity: r.popularity ?? 0,
    }))
    .sort((a, b) => b.popularity - a.popularity);
}

export function normalizeDetails(type: TmdbType, id: number, data: any): TmdbDetails {
  return {
    id,
    type,
    title: data.title || data.name || "",
    originalTitle: data.original_title || data.original_name || "",
    year: yearOf(data),
    overview: data.overview || "",
    posterPath: data.poster_path ?? null,
    rating: data.vote_average ?? 0,
    status: data.status ?? null,
    seasons: data.number_of_seasons ?? null,
    episodes: data.number_of_episodes ?? null,
    genres: ((data.genres ?? []) as any[]).map((g) => g.name),
    imdbId: data.external_ids?.imdb_id ?? data.imdb_id ?? null,
    tvdbId: data.external_ids?.tvdb_id ?? null,
    firstAirDate: data.first_air_date || data.release_date || null,
    lastAirDate: data.last_air_date ?? null,
  };
}

export async function searchMulti(query: string, apiKey: string): Promise<TmdbSearchResult[]> {
  const data = await tmdbGet("/search/multi", { query, include_adult: "false" }, apiKey);
  return normalizeSearchResults(data);
}

export async function getDetails(type: TmdbType, id: number, apiKey: string): Promise<TmdbDetails> {
  const data = await tmdbGet(`/${type}/${id}`, { append_to_response: "external_ids" }, apiKey);
  return normalizeDetails(type, id, data);
}

export function posterUrl(path: string | null, width: 342 | 500 = 342): string | null {
  return path ? `https://image.tmdb.org/t/p/w${width}${path}` : null;
}
