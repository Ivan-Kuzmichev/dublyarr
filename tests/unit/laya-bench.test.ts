import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { benchStats, runBench } from '@/cli/laya-bench';
import { getSetting } from '@/lib/settings';

test('статистика замера: среднее и p95', () => {
  expect(benchStats([100, 200, 300, 400, 1000])).toEqual({ mean: 400, p95: 1000 });
  expect(benchStats(Array.from({ length: 20 }, (_, i) => (i + 1) * 10))).toEqual({ mean: 105, p95: 190 });
});

test('замер: 20 вопросов, итог в настройках; Laya не готова — ошибка', async () => {
  const db = testDb();
  let n = 0;
  const fetchImpl = (async (url: string) => {
    if (String(url).endsWith('/health')) return Response.json({ status: 'ready', runtime: 'torch' });
    n++;
    return Response.json({ answers: { q: { noul: 0.5 } }, ms: 500 });
  }) as typeof fetch;
  const r = await runBench(db, { port: 1, fetchImpl, now: 7 });
  expect(n).toBe(20);
  expect(r).toMatchObject({ mean: 500, p95: 500, runtime: 'torch' });
  expect(getSetting(db, 'laya.bench')).toEqual({ mean: 500, p95: 500, runtime: 'torch', at: 7 });
  const down = (async () => Response.json({ status: 'downloading' })) as unknown as typeof fetch;
  await expect(runBench(db, { port: 1, fetchImpl: down })).rejects.toThrow('Laya не готова: downloading');
});
