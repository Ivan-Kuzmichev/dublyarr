import type { Db } from '../db/client';
import { getSetting, setSetting } from '../settings';
import type { ScanItem } from './group';
import type { Candidate } from './recognize';
import type { AdoptChoice, AdoptLine } from './adopt';

// Результат сканирования медиатеки и ход задач — app_settings['mediaScan']: окно открывается из него без нового обхода.

export type ScanEntry = ScanItem & { candidate: Candidate | null; sure: boolean; have: string[]; example: string | null /* куда ляжет первая серия */; error?: string };
export type MediaScanState = {
  status: 'idle' | 'scanning' | 'adopting';
  progress?: { done: number; total: number };
  scannedAt?: number;
  items: ScanEntry[];
  skipped: { key: string; why: string }[];
  last?: { at: number; lines: AdoptLine[] };
};

const KEY = 'mediaScan';
export const getScanState = (db: Db): MediaScanState => getSetting<MediaScanState>(db, KEY) ?? { status: 'idle', items: [], skipped: [] };
export const setScanState = (db: Db, s: MediaScanState) => setSetting(db, KEY, s);
export const updateScanState = (db: Db, patch: Partial<MediaScanState>) => setScanState(db, { ...getScanState(db), ...patch });

/** Выбор из окна или API: ключ позиции, TMDB, «только файлы», пересборка, какие серии (rel). */
export type AdoptPick = { key: string; tmdbId: number; type: 'tv' | 'movie'; filesOnly: boolean; process: boolean; episodes: string[] };

/** Только позиции и серии из сохранённого сканирования — пути с клиента как есть не принимаются. */
export function buildChoices(state: MediaScanState, picks: unknown): AdoptChoice[] {
  const out: AdoptChoice[] = [];
  for (const p of Array.isArray(picks) ? (picks as AdoptPick[]) : []) {
    const item = state.items.find((i) => i.key === p?.key);
    if (!item || !Number.isInteger(p.tmdbId) || p.tmdbId <= 0) continue;
    const want = new Set(Array.isArray(p.episodes) ? p.episodes : []);
    const episodes = item.episodes.filter((e) => want.has(e.rel)).map((e) => ({ rel: e.rel, season: e.season, number: e.number, sidecars: e.sidecars }));
    if (episodes.length) out.push({ key: item.key, root: item.root, tmdbId: p.tmdbId, type: p.type === 'movie' ? 'movie' : 'tv', filesOnly: !!p.filesOnly, process: !!p.process, episodes });
  }
  return out;
}
