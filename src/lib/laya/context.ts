import type { Title } from '../db/schema';
import type { ParsedRelease } from '../parse/types';

// Расширенный контекст вопросов Laya: тип и годы сериала, сезоны по TMDB, что разобрал парсер.
// Без него модель различает ремейк, спин-офф и одноимённый фильм только по названию и году.

const KIND = { series: 'сериал', anime: 'аниме', movie: 'фильм' } as const;

export function titleLine(t: Pick<Title, 'nameRu' | 'nameOriginal' | 'year' | 'lastAirDate' | 'kind'>): string {
  const name = `${t.nameRu}${t.nameOriginal && t.nameOriginal !== t.nameRu ? ` (${t.nameOriginal})` : ''}`;
  const last = t.kind !== 'movie' && t.lastAirDate ? Number(t.lastAirDate.slice(0, 4)) : null;
  const years = t.year ? (last && last !== t.year ? `${t.year}–${last}` : String(t.year)) : null;
  return [name, KIND[t.kind], years].filter(Boolean).join(', ');
}

export function seasonsLine(seasons: { number: number; episodeCount: number }[]): string | null {
  const regular = seasons.filter((s) => s.number > 0).sort((a, b) => a.number - b.number);
  return regular.length ? `${regular.length} (серий: ${regular.map((s) => s.episodeCount).join(', ')})` : null;
}

const range = (from: number, to: number) => (from === to ? String(from) : `${from}–${to}`);

export function parsedLine(p: Pick<ParsedRelease, 'seasons' | 'episodes' | 'totalInSeason' | 'absolute' | 'year'>): string {
  const parts: string[] = [];
  if (p.seasons.length) parts.push(p.seasons.length === 1 ? `сезон ${p.seasons[0]}` : `сезоны ${range(p.seasons[0], p.seasons[p.seasons.length - 1])}`);
  if (p.episodes) {
    const one = p.episodes.from === p.episodes.to;
    parts.push(`${one ? 'серия' : 'серии'} ${range(p.episodes.from, p.episodes.to)}${p.totalInSeason ? ` из ${p.totalInSeason}` : ''}${p.absolute ? ' (сквозная нумерация)' : ''}`);
  }
  if (p.year) parts.push(`год ${p.year}`);
  return parts.length ? parts.join(', ') : 'сезон и серии не указаны';
}
