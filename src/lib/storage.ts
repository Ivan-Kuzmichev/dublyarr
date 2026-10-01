import { statfs as fsStatfs } from 'node:fs/promises';
import type { Db } from './db/client';
import { getSetting, setSetting } from './settings';
import { notify } from './notify';
import type { RetentionSettings } from './retention-settings';

// Диск медиатеки и защита от переполнения (spec §8).

export type Disk = { total: number; free: number; used: number; pct: number };

export async function diskUsage(media: string, statfs: typeof fsStatfs = fsStatfs): Promise<Disk | null> {
  try {
    const s = await statfs(media);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    const used = total - free;
    return { total, free, used, pct: total ? Math.round((used / total) * 100) : 0 };
  } catch {
    return null;
  }
}

export type DiskLevel = 'ok' | 'warn' | 'pause';
export const storageState = (db: Db) => getSetting<{ pct: number; level: DiskLevel }>(db, 'storage.state');
export const storagePaused = (db: Db) => getSetting<boolean>(db, 'storage.paused') === true;

/** Порог предупреждения — сообщение раз в сутки; порог паузы — загрузки Dublyarr на паузе (applySpeed), ниже — снимается. */
export function checkDisk(db: Db, disk: Disk | null, settings: RetentionSettings, now: number): DiskLevel {
  const o = settings.overflow;
  const level: DiskLevel = !o.on || !disk ? 'ok' : disk.pct >= o.pause ? 'pause' : disk.pct >= o.warn ? 'warn' : 'ok';
  setSetting(db, 'storage.paused', level === 'pause');
  setSetting(db, 'storage.state', disk ? { pct: disk.pct, level } : null);
  if (level !== 'ok') {
    const day = new Date(now).toISOString().slice(0, 10);
    notify(db, { key: `disk:${level}:${day}`, kind: 'stuck', text: `💾 Диск медиатеки заполнен на ${disk!.pct} %${level === 'pause' ? ' — загрузки на паузе' : ''}` }, now);
  }
  return level;
}
