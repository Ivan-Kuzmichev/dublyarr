import type { Profile, Quality } from './profile-core';

// Профиль подписки на фильм (spec §10). Чистый модуль — годится и для клиента.

export type MovieDubKind = 'dub' | 'mvo' | 'original';
export type MovieProfile = {
  type: 'movie';
  dubs: { kind: MovieDubKind; on: boolean }[]; // порядок = приоритет
  waitDubDays: number; // ниже дубляжа — только через N дней после цифрового релиза
  quality: Quality;
  noCam: boolean;
  digitalOnly: boolean;
  remux: boolean;
  replaceWithDub: boolean;
};

export const MOVIE_DUB_LABEL: Record<MovieDubKind, string> = { dub: 'Дубляж', mvo: 'Многоголосый', original: 'Оригинал + субтитры' };
const KINDS = Object.keys(MOVIE_DUB_LABEL) as MovieDubKind[];

export const DEFAULT_MOVIE_PROFILE: MovieProfile = {
  type: 'movie',
  dubs: KINDS.map((kind) => ({ kind, on: true })),
  waitDubDays: 14,
  quality: { target: 1080, allowLower: true, preferHdr: false, maxSizeGb: 30 },
  noCam: true,
  digitalOnly: true,
  remux: false,
  replaceWithDub: true,
};

export const isMovieProfile = (p: Profile | MovieProfile): p is MovieProfile => (p as MovieProfile).type === 'movie';

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const BAD = 'Неверные настройки фильма';

/** Строит профиль только из известных полей; всё, что пришло от клиента, проверяется. */
export function validateMovieProfile(raw: unknown): { ok: true; profile: MovieProfile } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (!isObj(raw) || raw.type !== 'movie' || !Array.isArray(raw.dubs) || !isObj(raw.quality)) return fail(BAD);
  const dubs: MovieProfile['dubs'] = [];
  for (const d of raw.dubs) {
    if (!isObj(d) || !KINDS.includes(d.kind as MovieDubKind) || dubs.some((x) => x.kind === d.kind)) return fail(BAD);
    dubs.push({ kind: d.kind as MovieDubKind, on: d.on === true });
  }
  if (dubs.length !== KINDS.length) return fail(BAD);
  if (!dubs.some((d) => d.on)) return fail('Включите хотя бы один перевод');
  const wait = raw.waitDubDays;
  if (typeof wait !== 'number' || !Number.isInteger(wait) || wait < 0 || wait > 90) return fail('Ожидание дубляжа — от 0 до 90 дней');
  const q = raw.quality;
  if (q.target !== 720 && q.target !== 1080 && q.target !== 2160) return fail('Качество — 720p, 1080p или 2160p');
  if (q.maxSizeGb !== null && (typeof q.maxSizeGb !== 'number' || !(q.maxSizeGb >= 1 && q.maxSizeGb <= 200))) return fail('Лимит размера — от 1 до 200 ГБ');
  return {
    ok: true,
    profile: {
      type: 'movie',
      dubs,
      waitDubDays: wait,
      quality: { target: q.target, allowLower: q.allowLower === true, preferHdr: q.preferHdr === true, maxSizeGb: q.maxSizeGb as number | null },
      noCam: raw.noCam === true,
      digitalOnly: raw.digitalOnly === true,
      remux: raw.remux === true,
      replaceWithDub: raw.replaceWithDub === true,
    },
  };
}

/** Строки для панели подписки. */
export function describeMovieProfile(p: MovieProfile): string[] {
  const on = p.dubs.filter((d) => d.on);
  const lines = [on.map((d) => MOVIE_DUB_LABEL[d.kind]).join(' → ')];
  const later = on.filter((d) => d.kind !== 'dub');
  if (on[0]?.kind === 'dub' && later.length) lines.push(`${MOVIE_DUB_LABEL[later[0].kind]} — через ${p.waitDubDays} дн после цифрового релиза`);
  const q = p.quality;
  lines.push(`${q.target}p${q.allowLower ? ', иначе ниже' : ''}${q.preferHdr ? ' · HDR' : ''}${q.maxSizeGb ? ` · до ${q.maxSizeGb} ГБ` : ''}`);
  const flags = [p.noCam && 'Без экранок', p.digitalOnly && 'только цифровой релиз', p.remux && 'улучшать до BDRemux'].filter(Boolean) as string[];
  if (flags.length) lines.push(flags.map((f, i) => (i ? f : f[0].toUpperCase() + f.slice(1))).join(' · '));
  if (p.replaceWithDub) lines.push('Заменить на дубляж, когда выйдет');
  return lines;
}
