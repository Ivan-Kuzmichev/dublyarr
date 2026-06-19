export type VoiceoverKind = "VO" | "MVO" | "DVO" | "AVO";

export interface ReleaseInput {
  title: string;
  description: string;
  indexer: string;
}

export interface VoiceoverBlock {
  kind: VoiceoverKind;
  studios: string[];
}

export interface ParsedInfo {
  source: "description" | "title";
  voiceovers: VoiceoverBlock[];
  seasons: number[];
  episodes: { range: string; total: number | null } | null;
  quality: { resolution: string | null; source: string | null };
  year: string | null;
  hasOriginal: boolean;
  subs: string[];
}

export type ParsedRelease<T extends ReleaseInput = ReleaseInput> = T & {
  parsed: ParsedInfo;
};

export interface StudioAvailability {
  studio: string;
  kind: VoiceoverKind;
  seasons: number[];
  qualities: string[];
  count: number;
}

const VO_KINDS: VoiceoverKind[] = ["MVO", "DVO", "AVO", "VO"];

const TRACKER_STUDIO: Record<string, { studio: string; kind: VoiceoverKind }> =
  {
    lostfilm: { studio: "LostFilm", kind: "MVO" },
    "lostfilm.tv": { studio: "LostFilm", kind: "MVO" },
    anilibria: { studio: "AniLibria", kind: "MVO" },
    "anilibria.tv": { studio: "AniLibria", kind: "MVO" },
    anidub: { studio: "AniDub", kind: "MVO" },
    newstudio: { studio: "NewStudio", kind: "MVO" },
    baibako: { studio: "Baibako", kind: "MVO" },
    alexfilm: { studio: "AlexFilm", kind: "MVO" },
  };

const STUDIO_ALIAS: Record<string, string> = {
  syenduk: "Сыендук",
  syendyk: "Сыендук",
  сиендук: "Сыендук",
  hdrezka: "HDrezka",
  "hdrezka studio": "HDrezka",
  hdrezkastudio: "HDrezka",
  tvshows: "TVShows",
  "tv shows": "TVShows",
  wstudio: "WStudio",
  "w studio": "WStudio",
  lostfilm: "LostFilm",
  anilibria: "AniLibria",
  anidub: "AniDub",
  newstudio: "NewStudio",
  baibako: "Baibako",
  alexfilm: "AlexFilm",
  amedia: "Amedia",
  fox: "FOX",
  kubik: "Кубик в Кубе",
  кубиквкубе: "Кубик в Кубе",
  "кубик в кубе": "Кубик в Кубе",
  jaskier: "Jaskier",
};

function normalizeStudio(name: string): string {
  const trimmed = name.replace(/\s+/g, " ").trim();
  const key = trimmed.toLowerCase();
  return STUDIO_ALIAS[key] || trimmed;
}

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function pickSource(item: ReleaseInput): {
  text: string;
  source: "description" | "title";
} {
  const desc = stripHtml(item.description || "");
  const title = item.title || "";
  if (desc.length > title.length && /[а-яё]/i.test(desc)) {
    return { text: desc, source: "description" };
  }
  return { text: title, source: "title" };
}

function parseVoiceovers(text: string): VoiceoverBlock[] {
  const kindAlt = VO_KINDS.join("|");
  const re = new RegExp(`\\b(${kindAlt})\\b\\s*\\(\\s*([^)]+?)\\s*\\)`, "gi");
  const blocks: VoiceoverBlock[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const kind = m[1].toUpperCase() as VoiceoverKind;
    const studios = m[2]
      .split(/[,/|]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length < 60)
      .map(normalizeStudio);
    if (studios.length === 0) continue;
    blocks.push({ kind, studios });
  }
  return blocks;
}

function parseSeasons(text: string): number[] {
  const seasons = new Set<number>();
  const seasonRe =
    /Сезон(?:ы)?\s*:?\s*(\d+(?:\s*[-–—]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-–—]\s*\d+)?)*)/i;
  const sm = text.match(seasonRe);
  if (sm) {
    for (const part of sm[1].split(",")) {
      const range = part.trim().match(/^(\d+)\s*[-–—]\s*(\d+)$/);
      if (range) {
        const a = parseInt(range[1], 10);
        const b = parseInt(range[2], 10);
        if (a <= b && b - a < 50) {
          for (let i = a; i <= b; i++) seasons.add(i);
        }
      } else {
        const n = parseInt(part.trim(), 10);
        if (!isNaN(n)) seasons.add(n);
      }
    }
  }
  for (const m of text.matchAll(/\bS(\d{1,2})(?:\s*[-–—]\s*S?(\d{1,2}))?\b/gi)) {
    const a = parseInt(m[1], 10);
    const b = m[2] ? parseInt(m[2], 10) : a;
    if (a <= b && b - a < 50) {
      for (let i = a; i <= b; i++) seasons.add(i);
    }
  }
  return [...seasons].sort((a, b) => a - b);
}

function parseEpisodes(
  text: string
): { range: string; total: number | null } | null {
  const m = text.match(
    /Серии?\s*:?\s*(\d+\s*[-–—]\s*\d+|\d+)(?:\s*из\s*(\d+))?/i
  );
  if (m) {
    return {
      range: m[1].replace(/\s+/g, ""),
      total: m[2] ? parseInt(m[2], 10) : null,
    };
  }
  const em = text.match(/\bS\d{1,2}E(\d{1,3})(?:\s*[-–—]\s*E?(\d{1,3}))?\b/i);
  if (em) {
    const a = parseInt(em[1], 10);
    const b = em[2] ? parseInt(em[2], 10) : a;
    return { range: a === b ? `${a}` : `${a}-${b}`, total: null };
  }
  return null;
}

function parseQuality(text: string): {
  resolution: string | null;
  source: string | null;
} {
  const res = text.match(/\b(2160p|1080p|720p|576p|480p)\b/i);
  const src = text.match(
    /\b(BDRemux|BD-Remux|Remux|BDRip|BluRay|WEB-?DL|WEBRip|HDTV|HDRip|DVDRip|DVDScr|CAMRip|HDCAM)\b/i
  );
  const SOURCE_CANON: Record<string, string> = {
    bdremux: "BDRemux",
    "bd-remux": "BDRemux",
    remux: "Remux",
    bdrip: "BDRip",
    bluray: "BluRay",
    "web-dl": "WEB-DL",
    webdl: "WEB-DL",
    webrip: "WEBRip",
    hdtv: "HDTV",
    hdrip: "HDRip",
    dvdrip: "DVDRip",
    dvdscr: "DVDScr",
    camrip: "CAMRip",
    hdcam: "HDCAM",
  };
  return {
    resolution: res ? res[1].toLowerCase() : null,
    source: src ? SOURCE_CANON[src[1].toLowerCase()] || src[1] : null,
  };
}

function parseYear(text: string): string | null {
  const m = text.match(/\[(\d{4})(?:\s*[-–—]\s*(\d{4}))?[,\s\]]/);
  if (m) return m[2] ? `${m[1]}–${m[2]}` : m[1];
  const m2 = text.match(/\((\d{4})\)/);
  return m2 ? m2[1] : null;
}

function parseExtras(text: string): { hasOriginal: boolean; subs: string[] } {
  const hasOriginal = /\boriginal\b|оригинал/i.test(text);
  const subs: string[] = [];
  const subMatch = text.match(/Sub(?:title)?s?\s*\(([^)]+)\)/i);
  if (subMatch) {
    for (const lang of subMatch[1].split(/[,/]/)) {
      const t = lang.trim();
      if (t) subs.push(t);
    }
  } else if (/субтитр/i.test(text)) {
    subs.push("Rus");
  }
  return { hasOriginal, subs };
}

function trackerStudio(
  indexer: string
): { studio: string; kind: VoiceoverKind } | null {
  const key = indexer.toLowerCase().replace(/\s+/g, "");
  for (const [k, v] of Object.entries(TRACKER_STUDIO)) {
    if (key.includes(k.replace(/\./g, ""))) return v;
  }
  return null;
}

export function parseRelease<T extends ReleaseInput>(item: T): ParsedRelease<T> {
  const { text, source } = pickSource(item);
  const voiceovers = parseVoiceovers(text);
  if (voiceovers.length === 0) {
    const ts = trackerStudio(item.indexer);
    if (ts) voiceovers.push({ kind: ts.kind, studios: [ts.studio] });
  }
  const seasons = parseSeasons(text);
  const episodes = parseEpisodes(text);
  const quality = parseQuality(item.title + " " + text);
  const year = parseYear(text) || parseYear(item.title);
  const extras = parseExtras(text);
  return {
    ...item,
    parsed: {
      source,
      voiceovers,
      seasons,
      episodes,
      quality,
      year,
      ...extras,
    },
  };
}

export function summarizeStudioAvailability(
  releases: ParsedRelease[]
): StudioAvailability[] {
  const map = new Map<
    string,
    {
      studio: string;
      kind: VoiceoverKind;
      seasons: Set<number>;
      qualities: Set<string>;
      count: number;
    }
  >();
  for (const r of releases) {
    for (const vo of r.parsed.voiceovers) {
      for (const s of vo.studios) {
        const key = `${s}|${vo.kind}`;
        if (!map.has(key)) {
          map.set(key, {
            studio: s,
            kind: vo.kind,
            seasons: new Set(),
            qualities: new Set(),
            count: 0,
          });
        }
        const e = map.get(key)!;
        e.count++;
        for (const sn of r.parsed.seasons) e.seasons.add(sn);
        const q = [r.parsed.quality.source, r.parsed.quality.resolution]
          .filter(Boolean)
          .join(" ");
        if (q) e.qualities.add(q);
      }
    }
  }
  return [...map.values()]
    .map((e) => ({
      studio: e.studio,
      kind: e.kind,
      seasons: [...e.seasons].sort((a, b) => a - b),
      qualities: dedupeQualities([...e.qualities]),
      count: e.count,
    }))
    .sort((a, b) => b.count - a.count || a.studio.localeCompare(b.studio));
}

function dedupeQualities(qualities: string[]): string[] {
  const withRes = new Set<string>();
  for (const q of qualities) {
    const m = q.match(/^(\S+)\s+(\d+p)$/);
    if (m) withRes.add(m[1]);
  }
  const filtered = qualities.filter(
    (q) => !/^\S+$/.test(q) || !withRes.has(q)
  );
  return filtered.sort((a, b) => {
    const ra = a.match(/(\d+)p/);
    const rb = b.match(/(\d+)p/);
    const na = ra ? parseInt(ra[1], 10) : 0;
    const nb = rb ? parseInt(rb[1], 10) : 0;
    if (na !== nb) return nb - na;
    return a.localeCompare(b);
  });
}

export function compressSeasons(seasons: number[]): string {
  if (!seasons || seasons.length === 0) return "—";
  const parts: string[] = [];
  let start = seasons[0];
  let prev = seasons[0];
  for (let i = 1; i <= seasons.length; i++) {
    const n = seasons[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = n;
    prev = n;
  }
  return parts.join(", ");
}

export function groupBySeason<T extends ReleaseInput>(
  releases: ParsedRelease<T>[]
): [string, ParsedRelease<T>[]][] {
  const map = new Map<string, ParsedRelease<T>[]>();
  for (const r of releases) {
    const seasons = r.parsed.seasons.length > 0 ? r.parsed.seasons : [null];
    for (const s of seasons) {
      const key = s == null ? "—" : String(s);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
  }
  return [...map.entries()].sort((a, b) => {
    if (a[0] === "—") return 1;
    if (b[0] === "—") return -1;
    return parseInt(a[0], 10) - parseInt(b[0], 10);
  });
}

export interface EpisodeTag {
  /** null — сезон не извлечён (аниме); импорт подставляет его из контекста загрузки. */
  season: number | null;
  episode: number;
}

/**
 * Стратегии разбора метки серии из имени файла, пробуются по порядку — первая
 * успешная побеждает. Границы не на \b (символ `_` сам словесный, ломал `_S02E06_`),
 * а на «не буква/цифра» вокруг и «не цифра» после номера.
 */
const EPISODE_TAG_STRATEGIES: ((name: string) => EpisodeTag | null)[] = [
  // S01E03 / S1E1 / S02_E06 — сезон и серия явно
  (name) => {
    const m = name.match(/(?<![A-Za-z0-9])S(\d{1,2})[\s._-]*E(\d{1,3})(?!\d)/i);
    return m ? { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) } : null;
  },
  // 1x05 / 10x100 — сезон×серия
  (name) => {
    const m = name.match(/(?<![A-Za-z0-9])(\d{1,2})x(\d{2,3})(?!\d)/i);
    return m ? { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) } : null;
  },
  // Аниме: номер серии в скобках [06]; сезон в имени не извлекаем (берётся из контекста).
  // Только чисто числовые скобки 1–3 цифр: [1080p]/[HEVC]/[2021] не подхватываются.
  (name) => {
    const m = name.match(/\[(\d{1,3})\]/);
    return m ? { season: null, episode: parseInt(m[1], 10) } : null;
  },
];

/** Метка серии из имени файла (S01E03 / 1x05 / аниме [06]); null если ничего не подошло. */
export function parseEpisodeTag(name: string): EpisodeTag | null {
  for (const strategy of EPISODE_TAG_STRATEGIES) {
    const tag = strategy(name);
    if (tag) return tag;
  }
  return null;
}
