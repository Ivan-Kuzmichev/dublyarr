import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../lib/db/client';
import { jobs } from '../lib/db/schema';
import { getSetting, setSetting } from '../lib/settings';
import { enqueue } from './jobs';

const DAY = 86_400_000;

/** Ставит задачу раз в сутки; пока предыдущая в очереди или выполняется — вторую не ставит. */
export const scheduleDaily = (db: Db, type: string, now = Date.now()) => scheduleEvery(db, type, DAY, now);

/** Ставит задачу не чаще раза в интервал и не пока предыдущая в очереди или выполняется. */
export function scheduleEvery(db: Db, type: string, intervalMs: number, now = Date.now()): boolean {
  const last = getSetting<number>(db, `schedule.${type}`);
  if (last !== undefined && now - last < intervalMs) return false;
  const pending = db
    .select()
    .from(jobs)
    .where(and(eq(jobs.type, type), inArray(jobs.status, ['queued', 'running'])))
    .get();
  if (pending) return false;
  enqueue(db, type, {}, now);
  setSetting(db, `schedule.${type}`, now);
  return true;
}
