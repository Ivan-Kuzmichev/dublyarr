import { isMovieProfile, type MovieProfile } from './movie-profile';
import { eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { studios, subscriptions, type Studio } from './db/schema';
import { getSetting, setSetting } from './settings';
import { STUDIO_SEED } from './studio-seed';
import type { Profile } from './profile';

export class StudioError extends Error {}
export type StudioInput = { name: string; aliases: string[]; kind: Studio['kind']; trackers: string[] };

import { normalizeStudio } from './studios-normalize';

export { normalizeStudio };

function uniq(xs: string[], key: (s: string) => string = (s) => s): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of xs) {
    const x = raw.trim();
    if (!x || seen.has(key(x))) continue;
    seen.add(key(x));
    out.push(x);
  }
  return out;
}

function clean(input: StudioInput): StudioInput {
  const name = input.name.trim();
  if (!normalizeStudio(name)) throw new StudioError('Введите название студии');
  if (name.length > 60) throw new StudioError('Название — не длиннее 60 символов');
  const aliases = uniq(input.aliases, normalizeStudio).filter((a) => normalizeStudio(a) && normalizeStudio(a) !== normalizeStudio(name));
  return { name, aliases, kind: input.kind, trackers: uniq(input.trackers.map((t) => t.toLowerCase())) };
}

function assertNoConflict(db: Db, input: StudioInput, selfId?: number) {
  const taken = new Map<string, string>();
  for (const s of db.select().from(studios).all()) {
    if (s.id === selfId) continue;
    for (const v of [s.name, ...s.aliases]) taken.set(normalizeStudio(v), s.name);
  }
  for (const v of [input.name, ...input.aliases]) {
    const owner = taken.get(normalizeStudio(v));
    if (owner) throw new StudioError(`«${v}» уже есть у студии ${owner}`);
  }
}

export function createStudio(db: Db, input: StudioInput, source: Studio['source'] = 'manual'): Studio {
  const c = clean(input);
  assertNoConflict(db, c);
  return db
    .insert(studios)
    .values({ ...c, source, confirmed: source !== 'laya', createdAt: Date.now() })
    .returning()
    .get();
}

export function updateStudio(db: Db, id: number, input: StudioInput): Studio {
  const c = clean(input);
  assertNoConflict(db, c, id);
  const row = db.update(studios).set(c).where(eq(studios.id, id)).returning().get();
  if (!row) throw new StudioError('Студия не найдена');
  return row;
}

/** Где используется студия: подписки и сохранённые профили по умолчанию. */
export function studioUsage(db: Db, id: number) {
  const uses = (p?: Profile | MovieProfile) => !!p && !isMovieProfile(p) && p.dubs.some((d) => d.kind === 'studio' && d.studioId === id);
  const subs = db
    .select({ profile: subscriptions.profile })
    .from(subscriptions)
    .all()
    .filter((s) => uses(s.profile)).length;
  const profiles = (['series', 'anime'] as const).filter((k) => uses(getSetting<Profile>(db, `profile.${k}`)));
  return { subscriptions: subs, profiles };
}

export function deleteStudio(db: Db, id: number) {
  const u = studioUsage(db, id);
  if (u.subscriptions || u.profiles.length) {
    const parts = [u.subscriptions ? `подписок — ${u.subscriptions}` : null, u.profiles.length ? 'профиль по умолчанию' : null].filter(Boolean);
    throw new StudioError(`Студия используется: ${parts.join(', ')}`);
  }
  db.delete(studios).where(eq(studios.id, id)).run();
}

/** Начальный словарь — один раз за жизнь базы: удалённые пользователем студии не возвращаются. */
export function seedStudios(db: Db) {
  if (getSetting<boolean>(db, 'studios.seeded')) return;
  // Флаг — в той же транзакции; уже существующие студии пропускаются (на случай старой базы без флага).
  db.transaction(() => {
    for (const s of STUDIO_SEED) if (!findStudioByAlias(db, s.name)) createStudio(db, s, 'seed');
    setSetting(db, 'studios.seeded', true);
  });
}

export function listStudios(db: Db, kind?: 'series' | 'anime'): Studio[] {
  return db
    .select()
    .from(studios)
    .all()
    .filter((s) => !kind || s.kind === kind || s.kind === 'both')
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export function findStudioByAlias(db: Db, text: string): Studio | undefined {
  const n = normalizeStudio(text);
  if (!n) return undefined;
  return db
    .select()
    .from(studios)
    .all()
    .find((s) => [s.name, ...s.aliases].some((v) => normalizeStudio(v) === n));
}
