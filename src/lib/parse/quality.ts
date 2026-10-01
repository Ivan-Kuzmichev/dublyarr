import type { ParsedRelease } from './types';

type Q = Pick<ParsedRelease, 'resolution' | 'source' | 'hdr' | 'dv' | 'screener'>;

const RES: [RegExp, NonNullable<Q['resolution']>][] = [
  [/\b(?:2160p|4K|UHD)\b/i, 2160],
  [/\b1080[pi]\b/i, 1080],
  [/\b720p\b/i, 720],
  [/\b576p\b/i, 576],
  [/\b480p\b/i, 480],
];
const SOURCE: [RegExp, NonNullable<Q['source']>][] = [
  [/\b(?:BD)?Remux\b/i, 'remux'],
  [/\bWEB-?DL\b/i, 'webdl'],
  [/\bWEB-?Rip\b/i, 'webrip'],
  [/\bBDRip\b|\bBlu-?Ray\b/i, 'bdrip'],
  [/\bHDTV(?:Rip)?\b/i, 'hdtv'],
  [/\bDVD(?:Rip)?\b/i, 'dvd'],
  [/\bCAM(?:Rip)?\b/i, 'cam'],
];
// Экранки. TS/TC — только заглавными и отдельным словом, не «TS Studio».
const SCREENER = /\b(?:CAMRip|CAM|Telesync|Telecine|экранка)\b|(?:^|[\s.[(])(?:TS|TC)(?=[\s.\])]|$)(?!\s+Studio)/;

/** Качество из заголовка; чего нет в заголовке — из тегов Jackett. */
export function parseQuality(title: string, tags: string[]): Q {
  const tagText = tags.join(' ');
  const pick = <T>(table: [RegExp, T][]) => table.find(([re]) => re.test(title))?.[1] ?? table.find(([re]) => re.test(tagText))?.[1] ?? null;
  const screener = SCREENER.test(title);
  return {
    resolution: pick(RES),
    source: pick(SOURCE),
    hdr: /\bHDR(?:10\+?)?\b/i.test(title) || /\bHDR\b/i.test(tagText),
    dv: /Dolby\s*Vision|\bDV\b|\bDoVi\b/i.test(title),
    screener,
  };
}
