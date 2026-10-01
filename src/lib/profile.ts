import type { Db } from './db/client';
import { getSetting, setSetting } from './settings';
import { findStudioByAlias, listStudios } from './studios';
import { validateProfile, type DubPosition, type Profile } from './profile-core';

export * from './profile-core';

// --- профили по умолчанию ---

const BUILTIN: Record<'series' | 'anime', string[]> = {
  series: ['LostFilm', 'HDrezka Studio'],
  anime: ['AniDUB', 'AniLibria'],
};
const BUILTIN_WAITS = [0, 2];
const ANY_WAIT = 5;

const knownIds = (db: Db) => new Set(listStudios(db).map((s) => s.id));

/** Встроенный профиль; студии, которых нет в словаре, пропускаются. */
export function builtinProfile(db: Db, kind: 'series' | 'anime'): Profile {
  const dubs: DubPosition[] = [];
  BUILTIN[kind].forEach((name, i) => {
    const s = findStudioByAlias(db, name);
    if (s) dubs.push({ kind: 'studio', studioId: s.id, waitDays: dubs.length === 0 ? 0 : BUILTIN_WAITS[i] });
  });
  dubs.push({ kind: 'any', waitDays: dubs.length === 0 ? 0 : ANY_WAIT });
  return {
    dubs,
    quality: { target: 2160, allowLower: true, preferHdr: true, maxSizeGb: null },
    scope: { mode: 'new' },
    wholeSeasonAfterFinale: false,
    replaceWithHigher: true,
    autoNextSeason: true,
  };
}

export function getDefaultProfile(db: Db, kind: 'series' | 'anime'): Profile {
  const saved = getSetting<Profile>(db, `profile.${kind}`);
  if (!saved) return builtinProfile(db, kind);
  const known = knownIds(db);
  const dubs = saved.dubs.filter((d) => d.kind !== 'studio' || known.has(d.studioId));
  const r = validateProfile({ ...saved, dubs }, known);
  return r.ok ? r.profile : builtinProfile(db, kind);
}

export function saveDefaultProfile(db: Db, kind: 'series' | 'anime', p: Profile) {
  setSetting(db, `profile.${kind}`, p);
}


/** Для окна подписки: добавлять можно студии нужного типа, а подписи нужны для всех (тип мог смениться). */
export function subscribeDialogStudios(db: Db, kind: 'series' | 'anime') {
  return {
    addable: listStudios(db, kind).map((s) => ({ id: s.id, name: s.name })),
    names: Object.fromEntries(listStudios(db).map((s) => [s.id, s.name])) as Record<number, string>,
  };
}
