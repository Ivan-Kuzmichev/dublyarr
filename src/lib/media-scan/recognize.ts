import { dice, MATCH_AT } from '../match';
import { normalizeTitle } from '../parse/normalize';
import type { Tmdb } from '../tmdb/client';
import type { ScanItem } from './group';

export type Candidate = { tmdbId: number; type: 'tv' | 'movie'; name: string; original: string; year: number | null; posterPath: string | null; score: number };
export type Search = (query: string, type: 'tv' | 'movie') => Promise<Candidate[]>;

/** Счёт: 0,75 — лучшее сходство названия (ru/оригинал), 0,25 — год (точно 1, ±1 — 0,5, нет года — 0,5). */
function score(item: ScanItem, c: Candidate): number {
  const names = item.names.map(normalizeTitle);
  const sim = Math.max(...[c.name, c.original].map((n) => Math.max(...names.map((x) => dice(x, normalizeTitle(n))))));
  const year = item.year === null || c.year === null ? 0.5 : item.year === c.year ? 1 : Math.abs(item.year - c.year) === 1 ? 0.5 : 0;
  return 0.75 * sim + 0.25 * year;
}

export async function recognize(item: ScanItem, search: Search): Promise<{ best: Candidate | null; sure: boolean }> {
  const type = item.kind === 'movie' ? 'movie' : 'tv';
  for (const q of item.names.slice(0, 2)) {
    const found = (await search(q, type)).map((c) => ({ ...c, score: score(item, c) })).sort((a, b) => b.score - a.score);
    if (found.length) return { best: found[0], sure: found[0].score >= MATCH_AT };
  }
  return { best: null, sure: false };
}

export function tmdbSearch(tmdb: Tmdb): Search {
  return async (q, type) => {
    const y = (d?: string) => (d ? Number(d.slice(0, 4)) || null : null);
    if (type === 'tv') return (await tmdb.search(q)).map((i) => ({ tmdbId: i.id, type, name: i.name, original: i.original_name, year: y(i.first_air_date), posterPath: i.poster_path, score: 0 }));
    return (await tmdb.searchMulti(q)).filter((i) => i.media_type === 'movie').map((i) => ({ tmdbId: i.id, type, name: i.title ?? '', original: i.original_title ?? '', year: y(i.release_date), posterPath: i.poster_path ?? null, score: 0 }));
  };
}
