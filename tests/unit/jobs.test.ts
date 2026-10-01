import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { enqueue, runOnce, requeueStale } from '@/worker/jobs';
import { jobs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

test('задача выполняется один раз, ошибка → повтор с задержкой, после 3 попыток failed', async () => {
  const db = testDb();
  const t = 1_800_000_000_000;
  enqueue(db, 'ok', {}, t);
  enqueue(db, 'boom', {}, t);
  const seen: string[] = [];
  const handlers = {
    ok: async () => {
      seen.push('ok');
    },
    boom: async () => {
      throw new Error('упало');
    },
  };
  expect(await runOnce(db, handlers, t)).toBe(true);
  expect(await runOnce(db, handlers, t)).toBe(true);
  expect(await runOnce(db, handlers, t)).toBe(false);
  expect(seen).toEqual(['ok']);
  let boom = db.select().from(jobs).all().find((j) => j.type === 'boom')!;
  expect(boom).toMatchObject({ status: 'queued', attempts: 1, lastError: 'упало' });
  expect(boom.runAt).toBe(t + 120_000);
  await runOnce(db, handlers, t + 10 ** 7);
  await runOnce(db, handlers, t + 10 ** 8);
  boom = db.select().from(jobs).all().find((j) => j.type === 'boom')!;
  expect(boom.status).toBe('failed');
});

test('неизвестный тип — failed сразу; зависшие running возвращаются в очередь', async () => {
  const db = testDb();
  enqueue(db, 'nope', {}, 0);
  await runOnce(db, {}, 1);
  expect(db.select().from(jobs).get()!.status).toBe('failed');
  enqueue(db, 'x', {}, 0);
  db.update(jobs).set({ status: 'running' }).run();
  requeueStale(db);
  expect(db.select().from(jobs).all().every((j) => j.status === 'queued')).toBe(true);
});

test('старые выполненные задачи удаляются, ошибки и свежие — остаются', async () => {
  const { pruneJobs } = await import('@/worker/jobs');
  const db = testDb();
  const DAY = 86_400_000;
  enqueue(db, 'a', {}, 0);
  enqueue(db, 'b', {}, 0);
  enqueue(db, 'c', {}, 0);
  db.update(jobs).set({ status: 'done', updatedAt: 0 }).where(eq(jobs.type, 'a')).run();
  db.update(jobs).set({ status: 'failed', updatedAt: 0 }).where(eq(jobs.type, 'b')).run();
  pruneJobs(db, 2 * DAY);
  expect(db.select().from(jobs).all().map((j) => j.type).sort()).toEqual(['b', 'c']);
});
