import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { enqueue, runOnce } from '@/worker/jobs';
import { jobsSummary } from '@/lib/diagnostics';

test('сводка задач: последний успешный запуск и последняя ошибка по типу', async () => {
  const db = testDb();
  enqueue(db, 'a', {}, 1);
  await runOnce(db, { a: async () => undefined }, 10);
  enqueue(db, 'b', {}, 1);
  await runOnce(db, { b: async () => { throw new Error('упало'); } }, 20);
  expect(jobsSummary(db)).toEqual([
    { type: 'a', lastDoneAt: 10, lastError: null, queued: 0 },
    { type: 'b', lastDoneAt: null, lastError: 'упало', queued: 1 },
  ]);
});

test('ошибка раньше успешного запуска не показывается', async () => {
  const db = testDb();
  enqueue(db, 'a', {}, 1);
  await runOnce(db, { a: async () => { throw new Error('старое'); } }, 10);
  enqueue(db, 'a', {}, 1);
  await runOnce(db, { a: async () => undefined }, 20);
  expect(jobsSummary(db).find((j) => j.type === 'a')).toMatchObject({ lastDoneAt: 20, lastError: null });
});
