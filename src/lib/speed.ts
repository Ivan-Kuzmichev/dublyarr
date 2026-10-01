import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from './db/client';
import { downloads } from './db/schema';
import type { Qbit } from './qbit';
import { CATEGORY } from './downloads';
import { getSpeed, speedAt, type SpeedState } from './schedule';
import { storagePaused } from './storage';

// Расписание скорости (spec §5) — только для торрентов Dublyarr (решение владельца).
// У qBittorrent нет общего лимита на категорию, поэтому лимит делится поровну между качающимися.

const MB = 1024 ** 2;

export async function applySpeed(db: Db, qbit: Qbit, now: Date): Promise<SpeedState> {
  const s = getSpeed(db);
  // мало места на диске медиатеки — пауза независимо от сетки (spec §8)
  const state = storagePaused(db) ? 'pause' : speedAt(s.grid, now);
  const active = db.select().from(downloads).where(inArray(downloads.state, ['downloading', 'stalled'])).all();

  if (state === 'pause') {
    if (active.length) {
      await qbit.stop(active.map((d) => d.hash));
      db.update(downloads)
        .set({ state: 'paused', pausedBySchedule: true })
        .where(inArray(downloads.id, active.map((d) => d.id)))
        .run();
    }
    return state;
  }

  // окно паузы закончилось — будим только то, что остановили сами; остановленное вручную не трогаем
  const ours = db.select().from(downloads).where(and(eq(downloads.state, 'paused'), eq(downloads.pausedBySchedule, true))).all();
  if (ours.length) {
    await qbit.start(ours.map((d) => d.hash));
    db.update(downloads)
      // время паузы не считается «без сидов» — иначе после долгого окна загрузку сочли бы застрявшей
      .set({ state: 'downloading', pausedBySchedule: false, lastSeededAt: now.getTime() })
      .where(inArray(downloads.id, ours.map((d) => d.id)))
      .run();
  }

  const running = [...active, ...ours];
  const want = state === 'limit' && running.length ? Math.floor((s.limitMb * MB) / running.length) : 0;
  // qBittorrent отдаёт «без лимита» как -1 (или 0)
  const current = new Map((await qbit.list(CATEGORY)).map((t) => [t.hash, Math.max(0, t.dl_limit ?? 0)]));
  const change = running.filter((d) => current.has(d.hash) && current.get(d.hash) !== want).map((d) => d.hash);
  // в «полной скорости» снять лимит и с остальных своих торрентов, если он остался
  if (state === 'full') for (const [h, l] of current) if (l > 0 && !change.includes(h)) change.push(h);
  if (change.length) await qbit.setDownloadLimit(change, want);
  return state;
}
