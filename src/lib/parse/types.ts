// Результат разбора заголовка раздачи (spec §3).

export type DubKind = 'dub' | 'mvo' | 'dvo' | 'vo' | 'avo';
export type DubBy = 'tracker' | 'title' | 'tag' | 'none';
export type ParsedDub = { kind: DubKind; studioId: number | null; label: string; by: DubBy };

export type ParsedRelease = {
  base: string; // нормализованная «основа» заголовка — для правил и сравнения
  names: string[]; // названия из заголовка
  year: number | null;
  seasons: number[]; // пусто — не указан
  episodes: { from: number; to: number } | null; // null — весь сезон / не указаны
  totalInSeason: number | null; // «of 10»
  absolute: boolean; // E01-E28 без сезона — сквозная нумерация (аниме)
  pack: boolean;
  resolution: 2160 | 1080 | 720 | 576 | 480 | null;
  source: 'webdl' | 'webrip' | 'bdrip' | 'remux' | 'hdtv' | 'dvd' | 'cam' | null;
  hdr: boolean;
  dv: boolean;
  screener: boolean;
  dubs: ParsedDub[];
  original: boolean;
  subs: boolean;
};
