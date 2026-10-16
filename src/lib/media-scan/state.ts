import type { Db } from '../db/client';
import { getSetting, setSetting } from '../settings';
import type { ScanItem } from './group';
import type { Candidate } from './recognize';
import type { AdoptLine } from './adopt';

// Результат сканирования медиатеки и ход задач — app_settings['mediaScan']: окно открывается из него без нового обхода.

export type ScanEntry = ScanItem & { candidate: Candidate | null; sure: boolean; have: string[] };
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
