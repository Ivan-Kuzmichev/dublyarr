import { normalizeTitle } from './parse/normalize';
import type { ParsedRelease } from './parse/types';
import type { MatchResult } from './match-types';
import type { Season, Title } from './db/schema';

// «Тот ли это сериал» (spec §3): название, год, сезоны/серии, правдоподобность размера.

export type TitleInfo = {
  names: string[];
  year: number | null;
  kind: 'series' | 'anime';
  seasons: { number: number; episodeCount: number; year: number | null }[];
};

export const toTitleInfo = (t: Title, seasons: Season[]): TitleInfo => ({
  names: [t.nameRu, t.nameOriginal, ...t.altNames],
  year: t.year,
  kind: t.kind,
  seasons: seasons.map((s) => ({ number: s.number, episodeCount: s.episodeCount, year: s.airDate ? Number(s.airDate.slice(0, 4)) : null })),
});

export const MATCH_AT = 0.8;
export const DOUBT_AT = 0.5;
const GB = 1024 ** 3;

function bigrams(s: string): Map<string, number> {
  const t = normalizeTitle(s).replace(/ /g, '');
  const m = new Map<string, number>();
  for (let i = 0; i < t.length - 1; i++) m.set(t.slice(i, i + 2), (m.get(t.slice(i, i + 2)) ?? 0) + 1);
  return m;
}

/** Коэффициент Дайса по биграммам нормализованных строк, 0…1. */
export function dice(a: string, b: string): number {
  if (normalizeTitle(a) === normalizeTitle(b)) return 1;
  const x = bigrams(a);
  const y = bigrams(b);
  let common = 0;
  let total = 0;
  for (const [k, n] of x) {
    common += Math.min(n, y.get(k) ?? 0);
    total += n;
  }
  for (const n of y.values()) total += n;
  return total ? (2 * common) / total : 0;
}

/** Сквозной номер серии → (сезон, серия) по числу серий в сезонах (без спецвыпусков). */
export function absoluteToSeason(n: number, counts: { season: number; count: number }[]): { season: number; episode: number } | null {
  if (n < 1) return null;
  let left = n;
  for (const c of [...counts].sort((a, b) => a.season - b.season)) {
    if (left <= c.count) return { season: c.season, episode: left };
    left -= c.count;
  }
  return null;
}

/** Раздача со сквозной нумерацией (аниме) → сезоны и серии по TMDB. */
export function resolveAbsolute(p: ParsedRelease, t: TitleInfo): ParsedRelease {
  if (!p.absolute || !p.episodes) return p;
  const counts = t.seasons.filter((s) => s.number > 0).map((s) => ({ season: s.number, count: s.episodeCount }));
  if (counts.length === 0) return p;
  const from = absoluteToSeason(Math.max(1, p.episodes.from), counts);
  const to = absoluteToSeason(p.episodes.to, counts);
  if (!from) return { ...p, seasons: [counts[0].season], absolute: false };
  if (!to) {
    // TMDB ещё не знает последних серий (онгоинг): всё — в сезон, где диапазон начинается
    const before = counts.filter((c) => c.season < from.season).reduce((n, c) => n + c.count, 0);
    return { ...p, seasons: [from.season], episodes: { from: from.episode, to: p.episodes.to - before }, absolute: false };
  }
  if (from.season === to.season) return { ...p, seasons: [from.season], episodes: { from: from.episode, to: to.episode }, absolute: false };
  const seasons = counts.map((c) => c.season).filter((s) => s >= from.season && s <= to.season);
  return { ...p, seasons, episodes: null, absolute: false, pack: true };
}

const SIZE_LIMITS: Record<string, [number, number]> = { 2160: [0.1, 15], 1080: [0.1, 8], other: [0.05, 4] };

export function matchRelease(p: ParsedRelease, size: number, t: TitleInfo, rule?: 'match' | 'reject'): MatchResult {
  if (rule === 'reject') return { score: 0, level: 'reject', reasons: ['В чёрном списке'], rule };
  if (rule === 'match') return { score: 1, level: 'match', reasons: ['Подтверждено вручную'], rule };
  const reasons: string[] = [];

  const nameScore = Math.max(0, ...p.names.flatMap((a) => t.names.map((b) => dice(a, b))));
  if (nameScore < MATCH_AT) reasons.push('Название не похоже');

  const years = [t.year, ...t.seasons.map((s) => s.year)].filter((y): y is number => y !== null);
  const yearScore = p.year === null ? 0.5 : years.some((y) => Math.abs(y - p.year!) <= 1) ? 1 : 0;
  if (yearScore === 0) reasons.push('Год не совпадает');

  let seasonScore = 0.5;
  const known = new Map(t.seasons.map((s) => [s.number, s.episodeCount]));
  if (p.seasons.length) {
    if (p.seasons.some((s) => !known.has(s))) {
      seasonScore = 0;
      reasons.push('Такого сезона нет');
    } else if (p.seasons.length === 1 && p.episodes && p.episodes.to > (known.get(p.seasons[0]) ?? 0) && (known.get(p.seasons[0]) ?? 0) > 0) {
      seasonScore = 0;
      reasons.push('Серий больше, чем в сезоне');
    } else seasonScore = 1;
  }

  let sizeScore = 1;
  const count = p.episodes ? p.episodes.to - p.episodes.from + 1 : p.seasons.reduce((n, s) => n + (known.get(s) ?? 0), 0);
  if (count > 0) {
    const [min, max] = SIZE_LIMITS[String(p.resolution)] ?? SIZE_LIMITS.other;
    const per = size / count / GB;
    if (per < min || per > max) {
      sizeScore = 0;
      reasons.push('Размер на серию неправдоподобен');
    }
  }

  const score = Math.round((0.6 * nameScore + 0.15 * yearScore + 0.15 * seasonScore + 0.1 * sizeScore) * 100) / 100;
  return { score, level: score >= MATCH_AT ? 'match' : score >= DOUBT_AT ? 'doubt' : 'reject', reasons };
}
