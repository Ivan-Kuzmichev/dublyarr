import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { heartbeats } from '../db/schema';

/** Здоровье laya-serve из последнего опроса воркера. */
export function layaHealthInfo(db: Db): { laya?: string; model?: string; status?: string } {
  const info = db.select().from(heartbeats).where(eq(heartbeats.name, 'laya')).get()?.info;
  try {
    return info ? JSON.parse(info) : {};
  } catch {
    return {};
  }
}
