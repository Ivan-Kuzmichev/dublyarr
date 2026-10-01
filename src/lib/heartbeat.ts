import { eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { heartbeats } from './db/schema';
import type { ServiceStatus } from '@/components/ui/StatusDot';

export function beat(db: Db, name: 'worker' | 'laya' | 'qbit', ok: boolean, info?: string, now = Date.now()) {
  const row = { name, ok, info: info ?? null, at: now };
  db.insert(heartbeats).values(row).onConflictDoUpdate({ target: heartbeats.name, set: row }).run();
}

export function serviceStatuses(db: Db, now = Date.now()): ServiceStatus[] {
  const get = (n: string) => db.select().from(heartbeats).where(eq(heartbeats.name, n)).get();
  const w = get('worker');
  const l = get('laya');
  const q = get('qbit');
  // qBittorrent опрашивает воркер раз в минуту; старше 5 минут — данные устарели
  const qbit: ServiceStatus =
    !q || now - q.at > 5 * 60_000
      ? { name: 'qBittorrent', state: 'off', note: 'нет данных' }
      : q.ok
        ? { name: 'qBittorrent', state: 'ok', note: q.info || 'работает' }
        : q.info === 'не настроен'
          ? { name: 'qBittorrent', state: 'off', note: 'не настроен' }
          : { name: 'qBittorrent', state: 'warn', note: 'не отвечает' };
  const worker: ServiceStatus =
    w && now - w.at < 30_000 ? { name: 'Воркер', state: 'ok', note: 'работает' } : { name: 'Воркер', state: 'off', note: 'не отвечает' };
  // info — ответ /health laya-serve (JSON); старые записи — просто текст
  let health: { status?: string } = {};
  try {
    health = l?.info ? JSON.parse(l.info) : {};
  } catch {
    health = {};
  }
  const laya: ServiceStatus = !l
    ? { name: 'Laya', state: 'off', note: 'нет данных' }
    : !l.ok || now - l.at >= 180_000 || health.status === 'error'
      ? { name: 'Laya', state: 'warn', note: 'недоступна' }
      : health.status === 'downloading'
        ? { name: 'Laya', state: 'warn', note: 'скачивает модель' }
        : health.status === 'loading'
          ? { name: 'Laya', state: 'warn', note: 'загружает модель' }
          : { name: 'Laya', state: 'ok', note: 'работает' };
  return [qbit, worker, laya];
}
