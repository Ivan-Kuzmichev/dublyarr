import type { Release } from './db/schema';
import type { Verdict } from './evaluate';
import { dice, DOUBT_AT, MATCH_AT } from './match';
import type { MatchResult } from './match-types';
import { MOVIE_DUB_LABEL, type MovieDubKind, type MovieProfile } from './movie-profile';
import { addDays, formatShortDate } from './dates';
import type { ParsedRelease } from './parse/types';

// Раздачи фильма (spec §10): тот ли фильм, отказы с причиной, позиция перевода, ожидание дубляжа после цифрового релиза.

const GB = 1024 ** 3;
const MIN_ALLOWED = 720;
const SIZE_GB = [0.7, 100] as const;

/** Переводы раздачи в терминах профиля фильма: двухголосый считается многоголосым; одноголосый и авторский — нет. */
export function movieKinds(p: ParsedRelease): MovieDubKind[] {
  const out: MovieDubKind[] = [];
  if (p.dubs.some((d) => d.kind === 'dub')) out.push('dub');
  if (p.dubs.some((d) => d.kind === 'mvo' || d.kind === 'dvo')) out.push('mvo');
  if (p.original) out.push('original');
  return out;
}

export type MovieSource = NonNullable<ParsedRelease['source']> | 'disc';
const DISC = /\b(?:UHD\s+)?BR-?DISK\b|\bBDMV\b|\bVIDEO_TS\b|\bDVD-?[59]\b|\bISO\b/i;
const DIGITAL = new Set<MovieSource>(['webdl', 'webrip', 'bdrip', 'remux', 'dvd']);
export const isDigital = (s: MovieSource | null) => !!s && DIGITAL.has(s);

/** Источник: диск (образ BD/DVD) — отдельно; экранка — 'cam'; HDRip — как WEBRip. */
export function movieSource(title: string, p: ParsedRelease): MovieSource | null {
  if (DISC.test(title)) return 'disc';
  if (p.screener || p.source === 'cam') return 'cam';
  if (p.source) return p.source;
  if (/\b(?:HDRip|WEB-?DLRip)\b/i.test(title)) return 'webrip';
  return null;
}

// Сборник: диапазон или перечень лет, «трилогия», «4 фильма», Collection — в одном торренте несколько фильмов
const COLLECTION = /\b(?:19|20)\d{2}\s*(?:[-–—]|,\s*)(?:19|20)\d{2}\b|трилоги|квадрилоги|дилоги|тетралоги|пенталоги|гексалоги|коллекци|антологи|\b\d+\s*фильм|\b(?:collection|trilogy|duology|quadrilogy|anthology)\b/i;

/** Год из заголовка, если парсер не нашёл его в скобках (Kinozal: «Superman 2025 DUB …»). */
const yearOf = (p: ParsedRelease, title: string) => p.year ?? Number(title.match(/\b(19\d{2}|20\d{2})\b/)?.[1] ?? 0) ?? null;

/** Тот ли фильм: название (0,6), год ±1 (0,3), правдоподобный размер (0,1); заголовок с сезоном или серией — сериал. */
export function matchMovie(
  p: ParsedRelease,
  size: number,
  t: { nameRu: string; nameOriginal: string; altNames: string[]; year: number | null },
  rule?: 'match' | 'reject',
  title = p.names.join(' '),
): MatchResult {
  if (rule === 'reject') return { score: 0, level: 'reject', reasons: ['В чёрном списке'], rule };
  if (rule === 'match') return { score: 1, level: 'match', reasons: ['Подтверждено вручную'], rule };
  if (p.seasons.length || p.episodes) return { score: 0, level: 'reject', reasons: ['Это сериал'] };
  if (COLLECTION.test(title)) return { score: 0, level: 'reject', reasons: ['Сборник'] };
  const reasons: string[] = [];
  const names = [t.nameRu, t.nameOriginal, ...t.altNames];
  const nameScore = Math.max(0, ...p.names.flatMap((a) => names.map((b) => dice(a, b))));
  if (nameScore < MATCH_AT) reasons.push('Название не похоже');
  const y = yearOf(p, title) || null;
  const yearScore = y === null || t.year === null ? 0.5 : Math.abs(y - t.year) <= 1 ? 1 : 0;
  if (yearScore === 0) reasons.push('Год не совпадает');
  const gb = size / GB;
  const sizeScore = gb >= SIZE_GB[0] && gb <= SIZE_GB[1] ? 1 : 0;
  if (!sizeScore) reasons.push('Размер неправдоподобен');
  const score = Math.round((0.6 * nameScore + 0.3 * yearScore + 0.1 * sizeScore) * 100) / 100;
  return { score, level: score >= MATCH_AT ? 'match' : score >= DOUBT_AT ? 'doubt' : 'reject', reasons };
}

export type MovieVerdict = Verdict & { remux: boolean };
type Ctx = { profile: MovieProfile; digital: string | null; today: string };

/** Вердикты раздач фильма; лучшая — `best`. Ниже дубляжа позиция открывается через waitDubDays после цифрового релиза. */
export function evaluateMovie(releases: Release[], ctx: Ctx): MovieVerdict[] {
  const { profile, digital, today } = ctx;
  const q = profile.quality;
  const opensAt = digital ? addDays(digital, profile.waitDubDays) : null;
  const firstDub = profile.dubs.find((d) => d.on);
  type Checked = { r: Release; v: MovieVerdict };
  const reject = (r: Release, reason: string, tone: Verdict['tone'] = 'reject', position: number | null = null): Checked => ({
    r,
    v: { releaseId: r.id, ok: false, best: false, reason, position, tone, remux: false },
  });

  const checked = releases.map((r): Checked => {
    const p = r.parsed;
    if (r.match.level === 'reject') return reject(r, r.match.rule === 'reject' ? 'В чёрном списке' : 'Не тот фильм');
    if (r.match.level === 'doubt') return reject(r, 'Сомнительное совпадение', 'ask');
    const source = movieSource(r.title, p);
    if (source === 'disc') return reject(r, 'Диск, а не файл');
    if (source === 'cam') {
      if (profile.noCam) return reject(r, 'Экранка');
    } else if (profile.digitalOnly && (!source || !DIGITAL.has(source))) return reject(r, 'Не цифровой релиз');
    if (q.maxSizeGb !== null && r.size > q.maxSizeGb * GB) return reject(r, `Больше ${String(q.maxSizeGb).replace('.', ',')} ГБ`);
    const res = p.resolution ?? 480;
    if (res > q.target) return reject(r, `Выше ${q.target}p`);
    if (res < q.target) {
      if (!q.allowLower) return reject(r, `Ниже ${q.target}p`);
      if (res < MIN_ALLOWED) return reject(r, `Ниже ${MIN_ALLOWED}p`);
    }
    if (r.seeders === 0) return reject(r, 'Нет сидов');
    const kinds = movieKinds(p);
    const pos = profile.dubs.findIndex((d) => d.on && kinds.includes(d.kind));
    if (pos < 0) return reject(r, 'Нет нужного перевода');
    // ждём дубляж, только если он включён и стоит выше этой позиции
    const dubAbove = profile.dubs.slice(0, pos).some((d) => d.on && d.kind === 'dub');
    if (dubAbove && (!opensAt || opensAt > today)) {
      const top = firstDub ? MOVIE_DUB_LABEL[firstDub.kind].toLowerCase() : 'перевод';
      const w = reject(r, opensAt ? `Рано: ждём ${top} до ${formatShortDate(opensAt, today)}` : 'Рано: ждём цифровой релиз', 'wait', pos);
      if (opensAt) w.v.until = opensAt;
      return w;
    }
    return { r, v: { releaseId: r.id, ok: true, best: false, reason: '', position: pos, tone: 'ok', remux: source === 'remux' } };
  });

  const rank = (c: Checked) => {
    const p = c.r.parsed;
    const res = p.resolution ?? 480;
    return [c.v.position ?? 99, q.target - res, q.preferHdr && (p.hdr || p.dv) ? 0 : 1, profile.remux && c.v.remux ? 0 : 1, -(c.r.seeders ?? 0), c.r.size];
  };
  const cmp = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  };
  const passed = checked.filter((c) => c.v.ok).sort((a, b) => cmp(rank(a), rank(b)));
  passed.forEach((c, i) => {
    c.v.best = i === 0;
    c.v.tone = i === 0 ? 'best' : 'ok';
    c.v.reason = `${i === 0 ? 'Лучший' : 'Подходит'} · ${MOVIE_DUB_LABEL[profile.dubs[c.v.position!].kind]}`;
  });
  return checked.map((c) => c.v);
}

export type MovieDecision =
  | { action: 'start'; releaseId: number }
  | { action: 'wait'; state: 'digital' | 'dub'; until?: string }
  | { action: 'ask'; releaseId: number; reason: string }
  | { action: 'none' };

/** Что делать с фильмом: качать лучшую, ждать (цифровой релиз или дубляж), спросить или «нет раздач». */
export function decideMovie(verdicts: MovieVerdict[], profile: MovieProfile, digital: string | null): MovieDecision {
  const best = verdicts.find((v) => v.best);
  if (best) return { action: 'start', releaseId: best.releaseId };
  const ask = verdicts.find((v) => v.tone === 'ask');
  if (ask) return { action: 'ask', releaseId: ask.releaseId, reason: ask.reason };
  if (profile.digitalOnly && !digital) return { action: 'wait', state: 'digital' };
  const until = verdicts.filter((v) => v.tone === 'wait' && v.until).map((v) => v.until!).sort()[0];
  if (until) return { action: 'wait', state: 'dub', until };
  return { action: 'none' };
}
