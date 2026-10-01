import type { ParsedRelease } from './types';

type Eps = Pick<ParsedRelease, 'seasons' | 'episodes' | 'totalInSeason' | 'absolute' | 'pack'>;

const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
const total = (s?: string) => (s && /^\d+$/.test(s) ? Number(s) : null);

/** Сезоны и серии из заголовка во всех форматах русских трекеров (см. корпус). */
export function parseEpisodes(raw: string): Eps {
  const t = raw.replace(/[–—]/g, '-');
  let seasons: number[] = [];
  let episodes: Eps['episodes'] = null;
  let totalInSeason: number | null = null;

  // S1-2E1-19 — несколько сезонов
  let m = /S(\d{1,2})-(\d{1,2})E(\d{1,4})-(\d{1,4})/i.exec(t);
  if (m) {
    seasons = range(Number(m[1]), Number(m[2]));
    episodes = { from: Number(m[3]), to: Number(m[4]) };
  }
  // S02E05, S2E1-10 of 10, S02E01-E10, S5E00-08
  if (!m) {
    m = /S(\d{1,2})E(\d{1,4})(?:\s*-\s*E?(\d{1,4}))?(?:\s+of\s+(\d+|\?+))?/i.exec(t);
    if (m) {
      seasons = [Number(m[1])];
      episodes = { from: Number(m[2]), to: Number(m[3] ?? m[2]) };
      totalInSeason = total(m[4]);
    }
  }
  if (!seasons.length) {
    // признаки сезона без серий
    const range5 = /\/\s*(?:Сезоны?)?\s*:\s*(\d{1,2})\s*-\s*(\d{1,2})\s*\//i.exec(t); // «/ : 1-5 /»
    const single =
      /\(S(\d{1,2})\)/i.exec(t) ??
      /(\d{1,2})(?:st|nd|rd|th)\s+Season/i.exec(t) ??
      /Сезон[:\s]+(\d{1,2})/i.exec(t) ??
      /\bSeason\s+(\d{1,2})\b/i.exec(t) ??
      /Полный\s+S(\d{1,2})/i.exec(t) ??
      / - S(\d{1,2}) - /i.exec(t) ??
      /(?:^|[\s.])S(\d{1,2})(?=[\s.\]]|$)/i.exec(t);
    if (range5) seasons = range(Number(range5[1]), Number(range5[2]));
    else if (single) seasons = [Number(single[1])];
  }
  if (!episodes) {
    const of = /\[E(\d{1,4})(?:\s*-\s*(\d{1,4}))?(?:\+\d+)?\s+of\s+(\d+)/i.exec(t); // [E10 of 12] — вышло 10 из 12
    const ru = /Серии?[:\s]+(\d{1,4})\s*-\s*(\d{1,4})(?:\s+из\s+(\d+))?/i.exec(t);
    const er = /(?:^|[\s/])E(\d{1,4})\s*-\s*E?(\d{1,4})(?:\s+of\s+(\d+))?/i.exec(t);
    const ruOne = /Сери[яи][:\s]+(\d{1,4})(?!\s*-)(?:\s+из\s+(\d+))?/i.exec(t); // «Серии: 1 из 8», «Серия: 5»
    if (of) {
      episodes = of[2] ? { from: Number(of[1]), to: Number(of[2]) } : { from: 1, to: Number(of[1]) };
      totalInSeason = Number(of[3]);
    } else if (ru) {
      episodes = { from: Number(ru[1]), to: Number(ru[2]) };
      totalInSeason = total(ru[3]);
    } else if (er) {
      episodes = { from: Number(er[1]), to: Number(er[2]) };
      totalInSeason = total(er[3]);
    } else if (ruOne) {
      episodes = { from: Number(ruOne[1]), to: Number(ruOne[1]) };
      totalInSeason = total(ruOne[2]);
    }
  }
  const absolute = seasons.length === 0 && episodes !== null;
  const pack = episodes === null ? seasons.length > 0 : episodes.to > episodes.from || seasons.length > 1;
  return { seasons, episodes, totalInSeason, absolute, pack };
}
