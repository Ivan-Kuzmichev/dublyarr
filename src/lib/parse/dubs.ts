import { normalizeStudio } from '../studios-normalize';
import { parseNames } from './names';
import { parseEpisodes } from './episodes';
import { parseQuality } from './quality';
import { normalizeTitle } from './normalize';
import type { DubKind, ParsedDub, ParsedRelease } from './types';

export type StudioRef = { id: number; name: string; aliases: string[]; trackers: string[] };
export type TrackerRef = { id: string; name: string };
type Finder = (text: string) => StudioRef | null;

/** Поиск студии по фрагменту целиком: «LF» найдётся, а «WOLF» — нет. */
export function studioMatcher(studios: StudioRef[]): Finder {
  const index = new Map<string, StudioRef>();
  for (const s of studios) for (const v of [s.name, ...s.aliases]) if (normalizeStudio(v)) index.set(normalizeStudio(v), s);
  return (text) => index.get(normalizeStudio(text)) ?? null;
}

const KIND: Record<string, DubKind> = { dub: 'dub', mvo: 'mvo', dvo: 'dvo', vo: 'vo', avo: 'avo' };
const TAG_KIND: Record<string, DubKind> = { дубляж: 'dub', многоголосый: 'mvo', двухголосый: 'dvo', одноголосый: 'vo', авторский: 'avo' };
const LANGUAGE = /^(?:ukr|укр|украинский|eng|english|англ|rus|рус|jap|jpn|ger|fr)$/i;
const STOP = 'Sub|Original|Оригинал|WEB|WEBDL|WEB-DL|WEBRip|HEVC|BDRip|Rus|RUSSIAN|Eng|AVC|HDR|DV|x264|x265|DUB|Dub|MVO|DVO|AVO|VO';
// «6 x MVO (A, B)», «DUB (X)», «MVO Paravozik», «DUB»
const GROUP = new RegExp(
  `(?:\\d+\\s*x\\s*)?\\b(DUB|Dub|MVO|DVO|AVO|VO)\\b(?:\\s*\\(([^)]*)\\)|\\s+(?!(?:${STOP})\\b)([A-Za-zА-Яа-яЁё][\\w.-]+))?`,
  'g',
);

const trackerMatches = (s: StudioRef, t: TrackerRef) => {
  const id = normalizeStudio(t.id);
  const name = normalizeStudio(t.name);
  return s.trackers.some((x) => {
    const n = normalizeStudio(x);
    return n && (n === id || name.startsWith(n));
  });
};

/** Озвучки раздачи: свой трекер → перечни в заголовке → упоминания студий → теги. */
export function parseDubs(title: string, tags: string[], tracker: TrackerRef, find: Finder, studios: StudioRef[]) {
  const out: ParsedDub[] = [];
  // Студия — один раз; нераспознанная — один раз на (тип, подпись).
  const add = (d: ParsedDub) => {
    const dup = out.some((x) =>
      d.studioId !== null ? x.studioId === d.studioId : x.studioId === null && x.kind === d.kind && normalizeStudio(x.label) === normalizeStudio(d.label),
    );
    if (!dup) out.push(d);
  };

  for (const s of studios) if (trackerMatches(s, tracker)) add({ kind: 'mvo', studioId: s.id, label: s.name, by: 'tracker' });

  const seenNone = new Set<DubKind>();
  for (const m of title.matchAll(GROUP)) {
    const kind = KIND[m[1].toLowerCase()];
    if (m[2] !== undefined) {
      for (const raw of m[2].split(',')) {
        const item = raw.trim();
        if (!item || LANGUAGE.test(item)) continue;
        const s = find(item);
        add(s ? { kind, studioId: s.id, label: s.name, by: 'title' } : { kind, studioId: null, label: item, by: 'title' });
      }
    } else if (m[3] !== undefined) {
      const s = find(m[3]);
      add(s ? { kind, studioId: s.id, label: s.name, by: 'title' } : { kind, studioId: null, label: m[3], by: 'none' });
    } else if (!seenNone.has(kind)) {
      seenNone.add(kind);
      out.push({ kind, studioId: null, label: m[1].toUpperCase(), by: 'none' });
    }
  }

  // Упоминания студий вне перечней (подписи вроде «AniLiberty.TOP», «(LostFilm)»), кроме названий сериала.
  let rest = title.replace(GROUP, ' ');
  for (const n of parseNames(title).names) rest = rest.replace(n, ' ');
  const words = rest.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (let size = 3; size >= 1; size--)
    for (let i = 0; i + size <= words.length; i++) {
      const s = find(words.slice(i, i + size).join(''));
      if (s) add({ kind: 'mvo', studioId: s.id, label: s.name, by: 'title' });
    }

  for (const tag of tags) {
    const kind = TAG_KIND[tag.toLowerCase()];
    if (kind && !out.some((d) => d.kind === kind)) out.push({ kind, studioId: null, label: tag, by: 'tag' });
  }

  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  return {
    dubs: out,
    original: /\bOriginal\b|Оригинал/i.test(title) || tagSet.has('оригинал'),
    subs: /\bSub\b|\+Sub\b|Субтитры|RUS\(ext\)/i.test(title) || tagSet.has('субтитры'),
  };
}

/** Torznab не отдаёт теги вроде «дубляж» — они бывают только у агрегаторов; attrs пока не нужны. */
export function parseRelease(title: string, _attrs: Record<string, string | string[]>, tracker: TrackerRef, studios: StudioRef[]): ParsedRelease {
  const tags: string[] = [];
  const { names, year } = parseNames(title);
  return {
    base: normalizeTitle(names[0] ?? title),
    names,
    year,
    ...parseEpisodes(title),
    ...parseQuality(title, tags),
    ...parseDubs(title, tags, tracker, studioMatcher(studios), studios),
  };
}
