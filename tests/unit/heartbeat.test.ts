import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { beat, serviceStatuses } from '@/lib/heartbeat';

test('статусы сервисов', () => {
  const db = testDb();
  const t = 1_800_000_000_000;
  expect(serviceStatuses(db, t)).toEqual([
    { name: 'qBittorrent', state: 'off', note: 'нет данных' },
    { name: 'Воркер', state: 'off', note: 'не отвечает' },
    { name: 'Laya', state: 'off', note: 'нет данных' },
  ]);
  beat(db, 'worker', true, undefined, t);
  beat(db, 'laya', false, 'ECONNREFUSED', t);
  beat(db, 'qbit', true, '2 ↓', t);
  expect(serviceStatuses(db, t + 1000)).toEqual([
    { name: 'qBittorrent', state: 'ok', note: '2 ↓' },
    { name: 'Воркер', state: 'ok', note: 'работает' },
    { name: 'Laya', state: 'warn', note: 'недоступна' },
  ]);
  expect(serviceStatuses(db, t + 31_000)[1].state).toBe('off');
  beat(db, 'qbit', false, 'не настроен', t);
  expect(serviceStatuses(db, t)[0]).toEqual({ name: 'qBittorrent', state: 'off', note: 'не настроен' });
  beat(db, 'qbit', false, 'qBittorrent не отвечает: fetch failed', t);
  expect(serviceStatuses(db, t)[0]).toEqual({ name: 'qBittorrent', state: 'warn', note: 'не отвечает' });
  expect(serviceStatuses(db, t + 10 * 60_000)[0]).toEqual({ name: 'qBittorrent', state: 'off', note: 'нет данных' });
});
