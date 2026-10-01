// Профиль без зависимостей от базы: используется и в клиентских компонентах.

// Профиль подписки: порядок озвучек, качество, что скачивать. Он же — профиль по умолчанию.

export type DubPosition =
  | { kind: 'studio'; studioId: number; waitDays: number }
  | { kind: 'any'; waitDays: number } // «Любая»
  | { kind: 'original'; waitDays: number }; // «Оригинал с субтитрами»

export type Quality = { target: 720 | 1080 | 2160; allowLower: boolean; preferHdr: boolean; maxSizeGb: number | null };

export type Scope =
  | { mode: 'all' }
  | { mode: 'new' }
  | { mode: 'from'; season: number; episode: number; until: 'season_end' | 'onward' };

export type Profile = {
  dubs: DubPosition[]; // порядок = приоритет; waitDays — через сколько дней после эфира позиция открывается (не убывает)
  quality: Quality;
  scope: Scope;
  wholeSeasonAfterFinale: boolean;
  replaceWithHigher: boolean;
  autoNextSeason: boolean;
};

// --- проверка ---

export type ValidationResult = { ok: true; profile: Profile } | { ok: false; error: string };

class Invalid extends Error {}
const BAD = 'Неверные данные профиля';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bool = (v: unknown) => {
  if (typeof v !== 'boolean') throw new Invalid(BAD);
  return v;
};
const int = (v: unknown) => {
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new Invalid(BAD);
  return v;
};

function dubsOf(raw: unknown, known: Set<number>): DubPosition[] {
  if (!Array.isArray(raw)) throw new Invalid(BAD);
  if (raw.length === 0) throw new Invalid('Выберите хотя бы одну озвучку');
  const out: DubPosition[] = [];
  const studiosSeen = new Set<number>();
  let original = false;
  raw.forEach((d, i) => {
    if (!isObj(d)) throw new Invalid(BAD);
    const waitDays = i === 0 ? 0 : int(d.waitDays);
    if (waitDays < 0 || waitDays > 60) throw new Invalid('Ожидание — от 0 до 60 дней');
    if (i > 0 && out[i - 1].kind === 'any') throw new Invalid('«Любая» — только одна и последней');
    if (d.kind === 'studio') {
      const studioId = int(d.studioId);
      if (!known.has(studioId)) throw new Invalid('Неизвестная студия');
      if (studiosSeen.has(studioId)) throw new Invalid('Студия выбрана дважды');
      studiosSeen.add(studioId);
      out.push({ kind: 'studio', studioId, waitDays });
    } else if (d.kind === 'any') {
      out.push({ kind: 'any', waitDays });
    } else if (d.kind === 'original') {
      if (original) throw new Invalid('«Оригинал» выбран дважды');
      original = true;
      out.push({ kind: 'original', waitDays });
    } else throw new Invalid(BAD);
  });
  return out;
}

function qualityOf(raw: unknown): Quality {
  if (!isObj(raw)) throw new Invalid(BAD);
  if (raw.target !== 720 && raw.target !== 1080 && raw.target !== 2160) throw new Invalid('Качество — 720p, 1080p или 2160p');
  let maxSizeGb: number | null = null;
  if (raw.maxSizeGb !== null) {
    if (typeof raw.maxSizeGb !== 'number' || !(raw.maxSizeGb >= 0.5 && raw.maxSizeGb <= 200)) throw new Invalid('Лимит — от 0,5 до 200 ГБ');
    maxSizeGb = raw.maxSizeGb;
  }
  return { target: raw.target, allowLower: bool(raw.allowLower), preferHdr: bool(raw.preferHdr), maxSizeGb };
}

function scopeOf(raw: unknown): Scope {
  if (!isObj(raw)) throw new Invalid(BAD);
  if (raw.mode === 'all' || raw.mode === 'new') return { mode: raw.mode };
  if (raw.mode !== 'from' || (raw.until !== 'season_end' && raw.until !== 'onward')) throw new Invalid(BAD);
  const season = int(raw.season);
  const episode = int(raw.episode);
  if (season < 1 || episode < 1) throw new Invalid('Сезон и серия — с 1');
  return { mode: 'from', season, episode, until: raw.until };
}

function monotonic(dubs: DubPosition[]): DubPosition[] {
  dubs.forEach((d, i) => {
    if (i > 0 && d.waitDays < dubs[i - 1].waitDays) throw new Invalid('Ожидание не может быть меньше, чем у позиции выше');
  });
  return dubs;
}

/** Строит профиль заново только из известных полей; всё, что пришло от клиента, проверяется. */
export function validateProfile(raw: unknown, knownStudioIds: Set<number>): ValidationResult {
  try {
    if (!isObj(raw)) throw new Invalid(BAD);
    return {
      ok: true,
      profile: {
        dubs: monotonic(dubsOf(raw.dubs, knownStudioIds)),
        quality: qualityOf(raw.quality),
        scope: scopeOf(raw.scope),
        wholeSeasonAfterFinale: bool(raw.wholeSeasonAfterFinale),
        replaceWithHigher: bool(raw.replaceWithHigher),
        autoNextSeason: bool(raw.autoNextSeason),
      },
    };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message };
    throw e;
  }
}

export function parseProfileJson(json: string, knownStudioIds: Set<number>): ValidationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: BAD };
  }
  return validateProfile(raw, knownStudioIds);
}

// --- описание ---

export function dubLabel(d: DubPosition, studioName: (id: number) => string | undefined): string {
  if (d.kind === 'any') return 'Любая';
  if (d.kind === 'original') return 'Оригинал с субтитрами';
  return studioName(d.studioId) ?? 'Студия удалена';
}

export function describeProfile(p: Profile, studioName: (id: number) => string | undefined) {
  const chain = p.dubs.map((d, i) => dubLabel(d, studioName) + (i > 0 ? ` (через ${d.waitDays} дн)` : '')).join(' → ');
  const q = p.quality;
  const quality = [
    `${q.target}p${q.allowLower ? ', иначе ниже' : ''}`,
    q.preferHdr ? 'HDR' : null,
    q.maxSizeGb !== null ? `до ${String(q.maxSizeGb).replace('.', ',')} ГБ` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const s = p.scope;
  const code = (a: number, b: number) => `S${String(a).padStart(2, '0')}E${String(b).padStart(2, '0')}`;
  const scope =
    s.mode === 'all'
      ? 'Все сезоны'
      : s.mode === 'new'
        ? 'Только новые серии'
        : `С ${code(s.season, s.episode)} ${s.until === 'season_end' ? 'до конца сезона' : 'и дальше'}`;
  return { chain, quality, scope };
}

// --- порядок озвучек (редактор) ---

/** Ожидание по умолчанию, когда позиция не первая. */
export const DEFAULT_WAIT: Record<DubPosition['kind'], number> = { studio: 2, any: 5, original: 0 };

export const dubKey = (d: DubPosition) => (d.kind === 'studio' ? `s${d.studioId}` : d.kind);

/**
 * Добавить или убрать позицию. Новая встаёт перед «Любой» (та всегда последняя).
 * Первая позиция — без ожидания; позиция, переставшая быть первой с ожиданием 0, получает ожидание по умолчанию.
 */
export function toggleDub(dubs: DubPosition[], pos: DubPosition): DubPosition[] {
  const key = dubKey(pos);
  let next: DubPosition[];
  if (dubs.some((d) => dubKey(d) === key)) next = dubs.filter((d) => dubKey(d) !== key);
  else {
    const anyIdx = dubs.findIndex((d) => d.kind === 'any');
    next = pos.kind === 'any' || anyIdx < 0 ? [...dubs, pos] : [...dubs.slice(0, anyIdx), pos, ...dubs.slice(anyIdx)];
  }
  const fixed = next.map((d, i) =>
    i === 0 ? { ...d, waitDays: 0 } : d.waitDays === 0 && dubs[0] && dubKey(dubs[0]) === dubKey(d) ? { ...d, waitDays: DEFAULT_WAIT[d.kind] } : d,
  );
  return raiseFrom(fixed, 1);
}

/** Ожидания не убывают: каждая позиция — не раньше предыдущей. */
function raiseFrom(dubs: DubPosition[], from: number): DubPosition[] {
  const out = [...dubs];
  for (let i = Math.max(1, from); i < out.length; i++) if (out[i].waitDays < out[i - 1].waitDays) out[i] = { ...out[i], waitDays: out[i - 1].waitDays };
  return out;
}

/** Изменить ожидание позиции i (не ниже позиции выше) и поднять позиции ниже. */
export function setWait(dubs: DubPosition[], i: number, waitDays: number): DubPosition[] {
  if (i === 0) return dubs;
  const v = Math.max(waitDays, dubs[i - 1].waitDays);
  return raiseFrom(
    dubs.map((d, j) => (j === i ? { ...d, waitDays: v } : d)),
    i + 1,
  );
}
