import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { beat, serviceStatuses } from '@/lib/heartbeat';

test('статусы сервисов', () => {
  const db = testDb();
  const t = 1_800_000_000_000;
  expect(serviceStatuses(db, t)).toEqual([
    { name: 'Воркер', state: 'off', note: 'не отвечает' },
    { name: 'Laya', state: 'off', note: 'нет данных' },
  ]);
  beat(db, 'worker', true, undefined, t);
  beat(db, 'laya', false, 'ECONNREFUSED', t);
  expect(serviceStatuses(db, t + 1000)).toEqual([
    { name: 'Воркер', state: 'ok', note: 'работает' },
    { name: 'Laya', state: 'warn', note: 'недоступна' },
  ]);
  expect(serviceStatuses(db, t + 31_000)[0].state).toBe('off');
});
