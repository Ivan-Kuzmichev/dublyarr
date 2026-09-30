import type { Title, titles } from '../db/schema';
import type { TmdbSeason, TmdbTvDetails } from './types';

export const ANIMATION_GENRE = 16;
// Альтернативные названия, полезные для поиска раздач: русские, английские и японские (там романдзи).
const ALT_COUNTRIES = new Set(['RU', 'US', 'GB', 'JP']);

export const isAnime = (genreIds: number[], countries: string[]) => genreIds.includes(ANIMATION_GENRE) && countries.includes('JP');

const STATUS: Record<string, Title['status']> = {
  'Returning Series': 'returning',
  Ended: 'ended',
  Canceled: 'canceled',
  'In Production': 'in_production',
  Planned: 'planned',
  Pilot: 'planned',
};
export const mapStatus = (s: string): Title['status'] => STATUS[s] ?? 'returning';

const date = (s: string | null | undefined) => (s ? s : null);

export type TitleFields = Omit<typeof titles.$inferInsert, 'id' | 'createdAt' | 'refreshedAt' | 'kindManual'>;

export function mapDetails(d: TmdbTvDetails): TitleFields {
  const norm = (s: string) => s.trim().toLowerCase();
  const seen = new Set([norm(d.name), norm(d.original_name)]);
  const altNames: string[] = [];
  for (const a of d.alternative_titles?.results ?? []) {
    if (!ALT_COUNTRIES.has(a.iso_3166_1) || !a.title.trim() || seen.has(norm(a.title))) continue;
    seen.add(norm(a.title));
    altNames.push(a.title.trim());
  }
  return {
    tmdbId: d.id,
    kind: isAnime(
      d.genres.map((g) => g.id),
      d.origin_country,
    )
      ? 'anime'
      : 'series',
    nameRu: d.name,
    nameOriginal: d.original_name,
    originalLanguage: d.original_language,
    altNames,
    year: d.first_air_date ? Number(d.first_air_date.slice(0, 4)) : null,
    status: mapStatus(d.status),
    overview: d.overview ?? '',
    genres: d.genres.map((g) => g.name),
    originCountries: d.origin_country,
    networks: d.networks.map((n) => n.name),
    posterPath: d.poster_path,
    backdropPath: d.backdrop_path,
    nextAirDate: date(d.next_episode_to_air?.air_date),
    lastAirDate: date(d.last_air_date),
  };
}

export const mapSeasons = (d: TmdbTvDetails) =>
  d.seasons.map((s) => ({
    number: s.season_number,
    name: s.name,
    airDate: date(s.air_date),
    episodeCount: s.episode_count,
    posterPath: s.poster_path,
  }));

export const mapEpisodes = (s: TmdbSeason) =>
  s.episodes.map((e) => ({
    season: s.season_number,
    number: e.episode_number,
    name: e.name,
    airDate: date(e.air_date),
    runtime: e.runtime ?? null,
  }));
