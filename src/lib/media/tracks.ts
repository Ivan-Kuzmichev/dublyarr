import path from 'node:path';
import type { Db } from '../db/client';
import { getSetting } from '../settings';
import { normalizeStudio } from '../studios-normalize';
import { episodeFromFilename } from '../episode-file';
import { resolutionOf, type Probe, type Stream, type TrackInfo } from './probe';

// Какие дорожки оставить в медиатеке и какие включить по умолчанию (spec §6).

export type ProcessingSettings = { audio: 'dub+original' | 'dub' | 'all'; keepBackups: boolean; external: boolean; defaultSubs: 'none' | 'forced' | 'full'; keepSubs: string[] };
export const DEFAULT_PROCESSING: ProcessingSettings = { audio: 'dub+original', keepBackups: false, external: true, defaultSubs: 'forced', keepSubs: ['rus', 'eng'] };
export const getProcessing = (db: Db): ProcessingSettings => ({ ...DEFAULT_PROCESSING, ...getSetting<Partial<ProcessingSettings>>(db, 'processing') });

export function parseProcessingForm(form: FormData): ProcessingSettings | { error: string } {
  const audio = String(form.get('audio') ?? '') as ProcessingSettings['audio'];
  if (!['dub+original', 'dub', 'all'].includes(audio)) return { error: 'Неизвестный вариант звуковых дорожек' };
  const defaultSubs = String(form.get('defaultSubs') ?? '') as ProcessingSettings['defaultSubs'];
  if (!['none', 'forced', 'full'].includes(defaultSubs)) return { error: 'Неизвестный вариант субтитров' };
  const keepSubs = String(form.get('keepSubs') ?? '')
    .split(/[\s,]+/)
    .map((x) => x.trim().toLowerCase())
    .filter((x) => /^[a-z]{2,3}$/.test(x));
  return { audio, keepBackups: form.get('keepBackups') === 'on', external: form.get('external') === 'on', defaultSubs, keepSubs };
}

// ISO 639-1 (TMDB) → варианты 639-2 в дорожках
const LANG: Record<string, string[]> = {
  en: ['eng', 'en'], ja: ['jpn', 'ja'], ko: ['kor', 'ko'], ru: ['rus', 'ru'], fr: ['fra', 'fre', 'fr'], de: ['deu', 'ger', 'de'], es: ['spa', 'es'], it: ['ita', 'it'],
  zh: ['zho', 'chi', 'zh'], pt: ['por', 'pt'], tr: ['tur', 'tr'], sv: ['swe', 'sv'], da: ['dan', 'da'], no: ['nor', 'nob', 'no'], pl: ['pol', 'pl'], hi: ['hin', 'hi'], th: ['tha', 'th'], uk: ['ukr', 'uk'],
};
const sameLang = (track: string | null, tmdb: string | null) => !!track && !!tmdb && (LANG[tmdb] ?? [tmdb]).includes(track);

export type AudioClass = { kind: 'studio'; studioId: number } | { kind: 'original' } | { kind: 'other' };
type StudioRef = { id: number; name: string; aliases: string[] };

/** Студия — по названию дорожки целыми словами (n-граммы слов против словаря), оригинал — по языку или слову. */
export function classifyAudio(s: Stream, studios: StudioRef[], originalLang: string | null): AudioClass {
  const words = (s.title ?? '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const names = new Map<string, number>();
  for (const st of studios) for (const v of [st.name, ...st.aliases]) names.set(normalizeStudio(v), st.id);
  for (let len = Math.min(3, words.length); len >= 1; len--)
    for (let i = 0; i + len <= words.length; i++) {
      const id = names.get(normalizeStudio(words.slice(i, i + len).join(' ')));
      if (id !== undefined) return { kind: 'studio', studioId: id };
    }
  if (sameLang(s.language, originalLang) || /\b(original|orig)\b|оригинал/i.test(s.title ?? '')) return { kind: 'original' };
  return { kind: 'other' };
}

export type External = { path: string; type: 'audio' | 'subtitle'; language: string | null; title: string | null };
const EXT_AUDIO = new Set(['.mka', '.ac3', '.eac3', '.dts', '.aac', '.flac']);
const EXT_SUB = new Set(['.srt', '.ass', '.ssa']);
const GENERIC = /^(rus|russian|eng|english|ukr|sound|sounds|audio|sub|subs|subtitles|dub|voice|рус|русские|русская|озвучка|субтитры|звук)$/i;
const langOf = (p: string) => {
  const parts = p.split(/[^\p{L}]+/u).map((x) => x.toLowerCase());
  if (parts.some((x) => ['rus', 'russian', 'ru', 'рус', 'русские', 'русская'].includes(x))) return 'rus';
  if (parts.some((x) => ['eng', 'english', 'en'].includes(x))) return 'eng';
  if (parts.some((x) => ['ukr', 'ukrainian', 'укр'].includes(x))) return 'ukr';
  return null;
};

/** Внешние .mka/.srt этой серии из раздачи; язык и студия — по папкам и имени файла. */
export function findExternal(files: string[], videoPath: string, season: number, episode: number, single: boolean): External[] {
  const out: External[] = [];
  for (const f of files) {
    if (f === videoPath) continue;
    const ext = path.extname(f).toLowerCase();
    const type = EXT_AUDIO.has(ext) ? 'audio' : EXT_SUB.has(ext) ? 'subtitle' : null;
    if (!type || /(?:^|[\s._-])sample(?:$|[\s._-])/i.test(path.basename(f, ext))) continue;
    if (!single && episodeFromFilename(f, season) !== episode) continue;
    const parent = path.basename(path.dirname(f));
    const parentWords = parent.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const generic = !parentWords.length || parentWords.every((w) => GENERIC.test(w)) || parent === path.basename(path.dirname(videoPath));
    const tail = /S\d{1,2}E\d{1,4}[._ -]+(.+)$/i.exec(path.basename(f, ext))?.[1] ?? null;
    out.push({ path: f, type, language: langOf(f), title: generic ? tail : parent });
  }
  return out;
}

export type TrackPlan = {
  changed: boolean;
  audio: number[];
  subs: number[];
  order: number[];
  defaults: { audio: number | null; sub: number | null };
  external: External[];
  untouchedAudio: boolean;
};

const isForcedSub = (s: Stream) => s.forced || /forced|форс|надпис/i.test(s.title ?? '');

export function planTracks(
  p: Probe,
  o: { wanted: number[]; backups: number[]; originalLang: string | null; studios: StudioRef[]; settings: ProcessingSettings; external: External[] },
): TrackPlan {
  const st = o.settings;
  const videos = p.streams.filter((s) => s.type === 'video');
  const audios = p.streams.filter((s) => s.type === 'audio');
  const cls = new Map(audios.map((s) => [s.index, classifyAudio(s, o.studios, o.originalLang)]));
  const isStudio = (s: Stream, ids: number[]) => {
    const c = cls.get(s.index)!;
    return c.kind === 'studio' && ids.includes(c.studioId);
  };
  const wanted = audios.filter((s) => isStudio(s, o.wanted));
  const untouchedAudio = !wanted.length;
  let audio: number[];
  if (untouchedAudio) audio = audios.map((s) => s.index);
  else {
    const originals = audios.filter((s) => cls.get(s.index)!.kind === 'original' && !wanted.includes(s));
    const rest = audios.filter((s) => !wanted.includes(s) && !originals.includes(s));
    const picked = [
      ...wanted,
      ...(st.audio !== 'dub' ? originals : []),
      ...(st.audio === 'all' ? rest : st.keepBackups ? rest.filter((s) => isStudio(s, o.backups)) : []),
    ];
    audio = picked.map((s) => s.index);
  }
  const subStreams = p.streams.filter((s) => s.type === 'subtitle' && (!s.language || st.keepSubs.includes(s.language)));
  const subs = subStreams.map((s) => s.index);
  const rus = subStreams.filter((s) => s.language === 'rus');
  const sub = st.defaultSubs === 'forced' ? (rus.find(isForcedSub)?.index ?? null) : st.defaultSubs === 'full' ? (rus.find((s) => !isForcedSub(s))?.index ?? null) : null;
  // не опознали — оставляем флаг источника (первая «по умолчанию»), чтобы mp4/avi → mkv не сделал такими все дорожки
  const defaults = { audio: untouchedAudio ? (audios.find((s) => s.isDefault) ?? audios[0])?.index ?? null : wanted[0].index, sub };
  const external = st.external ? o.external : [];

  const order = [...videos.map((s) => s.index), ...audio, ...subs];
  const original = p.streams.filter((s) => s.type !== 'other').map((s) => s.index);
  const dropped = original.length !== order.length;
  const reordered = order.some((x, i) => x !== original[i]);
  const flagsDiffer =
    (!untouchedAudio && audios.some((s) => audio.includes(s.index) && s.isDefault !== (s.index === defaults.audio))) ||
    subStreams.some((s) => s.isDefault !== (s.index === sub));
  const changed = p.container !== 'matroska' || external.length > 0 || dropped || reordered || flagsDiffer;
  return { changed, audio, subs, order, defaults, external, untouchedAudio };
}

const channels = (n?: number) => (n ? (n >= 8 ? '7.1' : n >= 6 ? '5.1' : n === 1 ? '1.0' : '2.0') : '');
function name(s: Stream): string {
  if (s.type === 'video') {
    const res = resolutionOf({ streams: [s], duration: null, container: '' });
    return [s.codec.toUpperCase(), res ? `${res}p` : null, s.hdr ? (s.dv ? 'DV' : 'HDR') : null].filter(Boolean).join(' ');
  }
  if (s.type === 'audio') return [s.title ?? s.language ?? 'без названия', channels(s.channels)].filter(Boolean).join(' ');
  return s.title ?? s.language ?? 'без названия';
}

/** «В раздаче → В библиотеке» для примера в настройках. */
export function describePlan(p: Probe, plan: TrackPlan, _studioName: (id: number) => string | undefined): { before: TrackInfo[]; after: TrackInfo[] } {
  const by = new Map(p.streams.map((s) => [s.index, s]));
  const label = (s: Stream, i: number) => (s.type === 'video' ? 'видео' : s.type === 'audio' ? `аудио ${i}` : 'субт.');
  let a = 0;
  const before = p.streams.filter((s) => s.type !== 'other').map((s) => ({ kind: label(s, s.type === 'audio' ? ++a : 0), name: name(s) }));
  let b = 0;
  const after: TrackInfo[] = plan.order.map((idx) => {
    const s = by.get(idx)!;
    const isDef = s.type === 'audio' ? (plan.untouchedAudio ? s.isDefault : idx === plan.defaults.audio) : s.type === 'subtitle' ? idx === plan.defaults.sub : false;
    return { kind: label(s, s.type === 'audio' ? ++b : 0), name: name(s), ...(isDef ? { flag: 'по умолч.' } : {}) };
  });
  for (const e of plan.external) after.push({ kind: e.type === 'audio' ? `аудио ${++b}` : 'субт.', name: `${e.title ?? e.language ?? 'внешняя'} (из раздачи)` });
  return { before, after };
}
