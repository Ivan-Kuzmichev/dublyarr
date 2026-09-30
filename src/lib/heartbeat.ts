import { eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { heartbeats } from './db/schema';
import type { ServiceStatus } from '@/components/ui/StatusDot';

export function beat(db: Db, name: 'worker' | 'laya', ok: boolean, info?: string, now = Date.now()) {
  const row = { name, ok, info: info ?? null, at: now };
  db.insert(heartbeats).values(row).onConflictDoUpdate({ target: heartbeats.name, set: row }).run();
}

export function serviceStatuses(db: Db, now = Date.now()): ServiceStatus[] {
  const get = (n: string) => db.select().from(heartbeats).where(eq(heartbeats.name, n)).get();
  const w = get('worker');
  const l = get('laya');
  const worker: ServiceStatus =
    w && now - w.at < 30_000 ? { name: 'Воркер', state: 'ok', note: 'работает' } : { name: 'Воркер', state: 'off', note: 'не отвечает' };
  const laya: ServiceStatus = !l
    ? { name: 'Laya', state: 'off', note: 'нет данных' }
    : l.ok && now - l.at < 180_000
      ? { name: 'Laya', state: 'ok', note: 'работает' }
      : { name: 'Laya', state: 'warn', note: 'недоступна' };
  return [worker, laya];
}
