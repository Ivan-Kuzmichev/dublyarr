import path from 'node:path';
import { isVideo, episodeFromFilename } from '../episode-file';
import { parseRelease } from '../parse/dubs';

// Медиатека → позиции: папка верхнего уровня или видео в корне. Номер серии — из имени файла, сезон — из имени или «Season NN».

export type ScanFile = { rel: string; size: number };
export type ScanEpisode = { rel: string; size: number; season: number; number: number; sidecars: string[] };
export type ScanItem = { key: string; root: 'media' | 'movies'; kind: 'series' | 'movie'; names: string[]; year: number | null; episodes: ScanEpisode[]; unknown: { rel: string; why: string }[]; size: number };

const SIDECAR = /\.(srt|ass|ssa|sub|idx|mka)$/i;
const SEASON_DIR = /^(?:season|сезон)\s*(\d{1,2})$/i;
const NONE = { id: '', name: '' };
const stem = (rel: string) => path.basename(rel, path.extname(rel));
// имя в стиле сцены режется с первого технического слова: сезон, год, разрешение, источник, кодек
const CUT = /(?:^|\s)(?:s\d{1,2}(?:e\d+)?|\d{1,2}x\d{2}|season|сезон|(?:19|20)\d{2}|2160p|1080p|720p|576p|480p|4k|uhd|web-?dl(?:rip)?|webrip|bd-?rip|bdremux|remux|blu-?ray|hdtv|hdrip|dvdrip|x26[45]|h\.?26[45])(?=\s|$)/i;
const YEAR = /(?:^|[\s.(_[\]-])((?:19|20)\d{2})(?=$|[\s.)_\]-])/;
/** Названия и год: «A.B.2025.UHD…» → «A B», 2025; «Название (2025)» → «Название», 2025; «Task.S01.WEB-DLRip.LF» → «Task». */
function nameOf(raw: string): { names: string[]; year: number | null } {
  const year = YEAR.exec(raw)?.[1];
  let s = raw
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\(\s*(?:19|20)\d{2}\s*\)/g, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const cut = CUT.exec(s);
  if (cut) s = s.slice(0, cut.index);
  s = s.replace(/[\s\-–(]+$/, '').trim();
  return { names: [s || raw], year: year ? Number(year) : null };
}

export function groupFiles(files: ScanFile[], root: 'media' | 'movies'): { items: ScanItem[]; skipped: { key: string; why: string }[] } {
  // папка верхнего уровня с несколькими сериалами внутри («Сериалы/BEEF», «Сериалы/Silo») — позиция на каждую подпапку
  const subsOf = new Map<string, Set<string>>();
  for (const f of files) {
    const parts = f.rel.split('/');
    if (parts.length >= 3 && isVideo(f.rel) && !SEASON_DIR.test(parts[1])) subsOf.set(parts[0], new Set([...(subsOf.get(parts[0]) ?? []), parts[1]]));
  }
  const keyOf = (rel: string) => {
    const parts = rel.split('/');
    return (subsOf.get(parts[0])?.size ?? 0) >= 2 && parts.length >= 3 && !SEASON_DIR.test(parts[1]) ? `${parts[0]}/${parts[1]}` : parts[0];
  };
  const byKey = new Map<string, ScanFile[]>();
  for (const f of files) {
    const key = keyOf(f.rel);
    byKey.set(key, [...(byKey.get(key) ?? []), f]);
  }
  const items: ScanItem[] = [];
  const skipped: { key: string; why: string }[] = [];
  for (const [key, list] of byKey) {
    const videos = list.filter((f) => isVideo(f.rel));
    if (!videos.length) {
      skipped.push({ key, why: 'Нет видео' });
      continue;
    }
    const folder = list.length > 1 || key !== list[0].rel;
    const head = nameOf(folder ? path.basename(key) : stem(key));
    const seasonOf = (rel: string) => {
      const dir = rel.slice(key.length + 1).split('/').slice(0, -1).map((d) => SEASON_DIR.exec(d)?.[1]).find(Boolean);
      return dir ? Number(dir) : (parseRelease(stem(rel), {}, NONE, []).seasons[0] ?? parseRelease(path.basename(key), {}, NONE, []).seasons[0] ?? null);
    };
    let numbered: { v: ScanFile; season: number | null; number: number | null }[] = videos.map((v) => {
      const season = seasonOf(v.rel);
      return { v, season, number: season !== null ? episodeFromFilename(path.basename(v.rel), season) : null };
    });
    // сквозные номера без сезона («Frieren - 13») у трёх и больше видео — сериал, сезон 1 (сопоставление с TMDB — при добавлении)
    if (!numbered.some((n) => n.number !== null) && videos.length >= 3) {
      const bare = videos.map((v) => ({ v, season: 1 as number | null, number: episodeFromFilename(path.basename(v.rel), 1) }));
      if (bare.filter((n) => n.number !== null).length >= Math.ceil(videos.length * 0.6)) numbered = bare;
    }
    const series = numbered.some((n) => n.season !== null && n.number !== null);
    // субтитры серии — с тем же именем и следующим «.» («S01E1.eng.srt», но не «S01E10.rus.srt»)
    const sidecarsOf = (rel: string) => list.filter((s) => SIDECAR.test(s.rel) && path.dirname(s.rel) === path.dirname(rel) && path.basename(s.rel).startsWith(`${stem(rel)}.`)).map((s) => s.rel);
    const item: ScanItem = { key, root, kind: series ? 'series' : 'movie', names: head.names, year: head.year, episodes: [], unknown: [], size: videos.reduce((n, v) => n + v.size, 0) };
    if (!series) {
      const main = [...videos].sort((a, b) => b.size - a.size)[0];
      item.episodes.push({ rel: main.rel, size: main.size, season: 0, number: 0, sidecars: sidecarsOf(main.rel) });
      for (const v of videos) if (v !== main) item.unknown.push({ rel: v.rel, why: 'Не основной файл фильма' });
    } else {
      const seen = new Map<string, ScanEpisode>();
      for (const n of [...numbered].sort((a, b) => b.v.size - a.v.size)) {
        if (n.season === null || n.number === null) {
          item.unknown.push({ rel: n.v.rel, why: 'Нет номера серии' });
          continue;
        }
        const code = `S${String(n.season).padStart(2, '0')}E${String(n.number).padStart(2, '0')}`;
        if (seen.has(code)) item.unknown.push({ rel: n.v.rel, why: `Дубль серии ${code}` });
        else seen.set(code, { rel: n.v.rel, size: n.v.size, season: n.season, number: n.number, sidecars: sidecarsOf(n.v.rel) });
      }
      item.episodes = [...seen.values()].sort((a, b) => a.season - b.season || a.number - b.number);
      item.unknown.sort((a, b) => (a.why < b.why ? -1 : 1));
    }
    items.push(item);
  }
  return { items, skipped };
}
