import type { Title, titles } from '../db/schema';
import type { TmdbMovieDetails, TmdbReleaseDates, TmdbSeason, TmdbTvDetails } from './types';

export const ANIMATION_GENRE = 16;
// Альтернативные названия, полезные для поиска раздач: русские, английские и японские (там романдзи).
const ALT_COUNTRIES = new Set(['RU', 'US', 'GB', 'JP']);

const LATIN = /^[\p{Script=Latin}\p{N}\p{P}\p{Zs}\p{S}]+$/u;

/** Названия для поиска раздач и сравнения: английское (translations) первым, затем альтернативные —
 *  русские/английские/японские (романдзи) и латиница из стран происхождения (корейские, китайские тайтлы на трекерах подписаны так). */
function altNamesOf(main: string[], en: string | undefined, alts: { iso_3166_1: string; title: string }[], origin: string[]): string[] {
  const norm = (s: string) => s.trim().toLowerCase();
  const seen = new Set(main.map(norm));
  const out: string[] = [];
  const add = (t: string | undefined) => {
    const v = t?.trim();
    if (!v || seen.has(norm(v))) return;
    seen.add(norm(v));
    out.push(v);
  };
  add(en);
  for (const a of alts) if (ALT_COUNTRIES.has(a.iso_3166_1) || (origin.includes(a.iso_3166_1) && LATIN.test(a.title.trim()))) add(a.title);
  return out;
}
const enName = (t: { translations?: { translations: { iso_639_1: string; data: { name?: string; title?: string } }[] } }) => {
  const e = t.translations?.translations.find((x) => x.iso_639_1 === 'en')?.data;
  return e?.name || e?.title || undefined;
};

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
  const altNames = altNamesOf([d.name, d.original_name], enName(d), d.alternative_titles?.results ?? [], d.origin_country);
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
    stillPath: e.still_path ?? null,
  }));

export type ReleaseDates = { theatrical: string | null; digital: string | null; physical: string | null };

/** Самые ранние даты кинотеатрального (3), цифрового (4) и физического (5) релиза: RU, иначе US, иначе любая страна. */
export function pickReleaseDates(r: TmdbReleaseDates | undefined): ReleaseDates {
  const res: ReleaseDates = { theatrical: null, digital: null, physical: null };
  const all = r?.results ?? [];
  const order = [...all.filter((x) => x.iso_3166_1 === 'RU'), ...all.filter((x) => x.iso_3166_1 === 'US'), ...all.filter((x) => x.iso_3166_1 !== 'RU' && x.iso_3166_1 !== 'US')];
  const field = { 3: 'theatrical', 4: 'digital', 5: 'physical' } as const;
  for (const type of [3, 4, 5] as const) {
    for (const c of order) {
      const dates = c.release_dates.filter((d) => d.type === type && d.release_date).map((d) => d.release_date.slice(0, 10)).sort();
      if (dates.length) {
        res[field[type]] = dates[0];
        break;
      }
    }
  }
  return res;
}

export function mapMovie(d: TmdbMovieDetails): TitleFields {
  const altNames = altNamesOf([d.title, d.original_title], enName(d), d.alternative_titles?.titles ?? [], d.production_countries?.map((c) => c.iso_3166_1) ?? []);
  return {
    tmdbId: d.id,
    tmdbType: 'movie',
    kind: 'movie',
    nameRu: d.title,
    nameOriginal: d.original_title,
    originalLanguage: d.original_language,
    altNames,
    year: d.release_date ? Number(d.release_date.slice(0, 4)) : null,
    status: d.status === 'Released' ? 'released' : 'planned',
    overview: d.overview ?? '',
    genres: d.genres.map((g) => g.name),
    originCountries: d.origin_country ?? (d.production_countries ?? []).map((c) => c.iso_3166_1),
    networks: [],
    posterPath: d.poster_path,
    backdropPath: d.backdrop_path,
    nextAirDate: null,
    lastAirDate: null,
    runtime: d.runtime || null,
    releaseDates: pickReleaseDates(d.release_dates),
  };
}
