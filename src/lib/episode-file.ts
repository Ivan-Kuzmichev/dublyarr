import path from 'node:path';

// Номер серии по имени файла в раздаче: «S01E03», «1x03», «E05», «Серия 3», «03. Название», « - 03 [1080p]», «[03]».

export const VIDEO_EXT = new Set(['.mkv', '.mp4', '.avi', '.m4v', '.ts', '.webm']);
export const isVideo = (name: string) => VIDEO_EXT.has(path.extname(name).toLowerCase());
const isSample = (name: string) => /(?:^|[\s._-])sample(?:$|[\s._-])/i.test(path.basename(name, path.extname(name)));

const END = '(?=$|[\\s._\\-\\])\\[(])';

export function episodeFromFilename(file: string, season: number): number | null {
  const name = path.basename(file, path.extname(file));
  if (isSample(file)) return null;

  const sxe = /S(\d{1,2})[ ._-]?E(\d{1,4})/i.exec(name) ?? /(?:^|[^\d])(\d{1,2})x(\d{2,3})(?:[^\d]|$)/i.exec(name);
  if (sxe) return Number(sxe[1]) === season ? Number(sxe[2]) : null;

  // Признак другого сезона в имени («S02», «2nd Season») — не наш файл.
  const hint = /(\d{1,2})(?:st|nd|rd|th)\s+Season/i.exec(name) ?? /(?:^|[\s._-])S(\d{1,2})(?=$|[\s._-])/i.exec(name);
  if (hint && Number(hint[1]) !== season) return null;

  const rules = [
    new RegExp(`(?:^|[\\s._\\-\\[(])E(?:p(?:isode)?)?[\\s._]?(\\d{1,4})${END}`, 'i'),
    /Серия\s*(\d{1,4})/i,
    /(?:^|[\s._-])(\d{1,4})\s*серия/i,
    /^(\d{1,3})(?=$|[.\s_-])/,
    new RegExp(` - (\\d{1,4})${END}`),
    /\[(\d{1,3})\]/,
  ];
  for (const re of rules) {
    const m = re.exec(name);
    if (m) return Number(m[1]);
  }
  return null;
}

/** Серия → индексы файлов в раздаче. Один видеофайл на одну нужную серию — он без разбора имени. */
export function filesForEpisodes(files: { index: number; name: string; size: number }[], season: number, episodes: number[]): Map<number, number[]> {
  const videos = files.filter((f) => isVideo(f.name) && !isSample(f.name));
  const out = new Map<number, number[]>();
  if (videos.length === 1 && episodes.length === 1) {
    out.set(episodes[0], [videos[0].index]);
    return out;
  }
  for (const f of videos) {
    const n = episodeFromFilename(f.name, season);
    if (n !== null && episodes.includes(n)) out.set(n, [...(out.get(n) ?? []), f.index]);
  }
  return out;
}
