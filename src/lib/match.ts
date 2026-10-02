import { normalizeTitle } from './parse/normalize';
import type { ParsedRelease } from './parse/types';
import type { MatchResult } from './match-types';
import type { Season, Title } from './db/schema';

// «Тот ли это сериал» (spec §3): название, год, сезоны/серии, правдоподобность размера.

export type TitleInfo = {
  names: string[];
  year: number | null;
  kind: Title['kind'];
  seasons: { number: number; episodeCount: number; year: number | null }[];
  /** Год последнего эфира: раздачи новых сезонов датированы им, а не годом начала. */
  lastYear?: number | null;
  /** Аниме с одним сезоном в TMDB: размеры «сезонов трекеров» (блоки эфира между перерывами). */
  cours?: number[];
};

export const toTitleInfo = (t: Title, seasons: Season[], firstSeasonAirDates: (string | null)[] = []): TitleInfo => ({
  names: [t.nameRu, t.nameOriginal, ...t.altNames],
  year: t.year,
  lastYear: t.lastAirDate ? Number(t.lastAirDate.slice(0, 4)) : null,
  cours: t.kind === 'anime' ? coursOf(firstSeasonAirDates) : undefined,
  kind: t.kind,
  seasons: seasons.map((s) => ({ number: s.number, episodeCount: s.episodeCount, year: s.airDate ? Number(s.airDate.slice(0, 4)) : null })),
});

const COUR_GAP_DAYS = 45;

/** Блоки эфира внутри сезона: перерыв больше 45 дней — новый «сезон трекера». Серии без даты — в последний блок. */
export function coursOf(airDates: (string | null)[]): number[] {
  const out: number[] = [];
  let prev: number | null = null;
  for (const d of airDates) {
    const at = d ? Date.parse(d) : null;
    if (!out.length || (at !== null && prev !== null && at - prev > COUR_GAP_DAYS * 86_400_000)) out.push(0);
    out[out.length - 1]++;
    if (at !== null) prev = at;
  }
  return out;
}

/** Аниме: у трекера «S2/S3», в TMDB один длинный сезон — S{n}E{k} → S1E(серии прошлых блоков + k). */
export function resolveCours(p: ParsedRelease, t: TitleInfo): ParsedRelease {
  const cours = t.cours ?? [];
  const regular = t.seasons.filter((s) => s.number > 0);
  if (t.kind !== 'anime' || cours.length < 2 || regular.length !== 1 || regular[0].number !== 1) return p;
  if (!p.seasons.length || p.seasons.some((s) => s < 1 || s > cours.length)) return p;
  const offset = (n: number) => cours.slice(0, n - 1).reduce((a, b) => a + b, 0);
  const lo = Math.min(...p.seasons);
  const hi = Math.max(...p.seasons);
  // серии внутри одного сезона трекера — сдвигаем; пак сезона(ов) — все серии этих блоков
  if (p.episodes && p.seasons.length === 1) return lo === 1 ? p : { ...p, seasons: [1], episodes: { from: offset(lo) + p.episodes.from, to: offset(lo) + p.episodes.to }, totalInSeason: null };
  if (p.episodes) return p;
  return { ...p, seasons: [1], episodes: { from: offset(lo) + 1, to: offset(hi) + cours[hi - 1] }, totalInSeason: null };
}

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

export type AbsoluteCandidate = { label: string; parsed: ParsedRelease };

const epLabel = (season: number, from: number, to: number) => `S${String(season).padStart(2, '0')}E${String(from).padStart(2, '0')}${to !== from ? `–E${String(to).padStart(2, '0')}` : ''}`;

/**
 * Варианты раскладки сквозного номера по сезонам (для вопроса Laya): эвристика — первой, затем нумерация последнего сезона,
 * продолжение последнего сезона и новый сезон после известных серий. Один вариант — неоднозначности нет.
 */
export function absoluteCandidates(p: ParsedRelease, t: TitleInfo): AbsoluteCandidate[] {
  if (!p.absolute || !p.episodes) return [];
  const counts = t.seasons.filter((s) => s.number > 0).map((s) => ({ season: s.number, count: s.episodeCount })).sort((a, b) => a.season - b.season);
  if (!counts.length) return [];
  const h = resolveAbsolute(p, t);
  if (!h.episodes || h.seasons.length !== 1) return []; // пак на несколько сезонов — не спрашиваем
  const out: AbsoluteCandidate[] = [];
  const add = (season: number, from: number, to: number) => {
    const label = epLabel(season, from, to);
    if (from < 1 || out.some((c) => c.label === label)) return;
    out.push({ label, parsed: { ...p, seasons: [season], episodes: { from, to }, absolute: false } });
  };
  out.push({ label: epLabel(h.seasons[0], h.episodes.from, h.episodes.to), parsed: h });
  const { from, to } = p.episodes;
  const last = counts.at(-1)!;
  const before = counts.slice(0, -1).reduce((n, c) => n + c.count, 0);
  const total = before + last.count;
  if (to <= last.count) add(last.season, from, to); // нумерация внутри последнего сезона
  add(last.season, from - before, to - before); // продолжение последнего сезона (онгоинг)
  if (from > total) add(last.season + 1, from - total, to - total); // новый сезон, которого TMDB ещё не знает
  return out.slice(0, 4);
}

const SIZE_LIMITS: Record<string, [number, number]> = { 2160: [0.1, 15], 1080: [0.1, 8], other: [0.05, 4] };

export function matchRelease(p: ParsedRelease, size: number, t: TitleInfo, rule?: 'match' | 'reject'): MatchResult {
  if (rule === 'reject') return { score: 0, level: 'reject', reasons: ['В чёрном списке'], rule };
  if (rule === 'match') return { score: 1, level: 'match', reasons: ['Подтверждено вручную'], rule };
  const reasons: string[] = [];

  const nameScore = Math.max(0, ...p.names.flatMap((a) => t.names.map((b) => dice(a, b))));
  if (nameScore < MATCH_AT) reasons.push('Название не похоже');

  const years = [t.year, ...t.seasons.map((s) => s.year)].filter((y): y is number => y !== null);
  const inRun = t.year !== null && p.year !== null && p.year >= t.year - 1 && p.year <= Math.max(t.year, t.lastYear ?? t.year) + 1;
  const yearScore = p.year === null ? 0.5 : inRun || years.some((y) => Math.abs(y - p.year!) <= 1) ? 1 : 0;
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
