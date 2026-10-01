import { and, eq, lt } from 'drizzle-orm';
import type { Db } from '../lib/db/client';
import { jobs } from '../lib/db/schema';
import { logger } from '../lib/log';

const wlog = logger('worker');

export type Job = typeof jobs.$inferSelect;
export type Handler = (payload: unknown) => Promise<void>;

const MAX_ATTEMPTS = 3;

export function enqueue(db: Db, type: string, payload: unknown = {}, runAt = Date.now()) {
  const now = Date.now();
  db.insert(jobs).values({ type, payload: JSON.stringify(payload), runAt, createdAt: now, updatedAt: now }).run();
}

/** Атомарно забирает самую раннюю готовую задачу. */
export function claimNext(db: Db, now = Date.now()): Job | undefined {
  return db.$client
    .prepare(
      `UPDATE jobs SET status='running', attempts=attempts+1, updated_at=@now
       WHERE id = (SELECT id FROM jobs WHERE status='queued' AND run_at <= @now ORDER BY run_at, id LIMIT 1)
       RETURNING id, type, payload, status, run_at AS runAt, attempts, last_error AS lastError, created_at AS createdAt, updated_at AS updatedAt`,
    )
    .get({ now }) as Job | undefined;
}

/** Ошибка → повтор через 2^attempts минут, после MAX_ATTEMPTS — failed. */
export function finish(db: Db, job: Job, error: string | undefined, now = Date.now()) {
  if (!error) {
    db.update(jobs).set({ status: 'done', lastError: null, updatedAt: now }).where(eq(jobs.id, job.id)).run();
    return;
  }
  const failed = job.attempts >= MAX_ATTEMPTS;
  db.update(jobs)
    .set({ status: failed ? 'failed' : 'queued', lastError: error, updatedAt: now, runAt: failed ? job.runAt : now + 60_000 * 2 ** job.attempts })
    .where(eq(jobs.id, job.id))
    .run();
}

export async function runOnce(db: Db, handlers: Record<string, Handler>, now = Date.now()): Promise<boolean> {
  const job = claimNext(db, now);
  if (!job) return false;
  const h = handlers[job.type];
  if (!h) {
    db.update(jobs)
      .set({ status: 'failed', lastError: `Неизвестный тип задачи: ${job.type}`, updatedAt: now })
      .where(eq(jobs.id, job.id))
      .run();
    return true;
  }
  // частые задачи (раз в минуту и чаще) — только в подробном журнале
  const quiet = job.type === 'downloads.sync' || job.type.startsWith('telegram.');
  const started = Date.now();
  wlog.debug({ job: job.id, type: job.type }, 'job start');
  try {
    await h(JSON.parse(job.payload));
    finish(db, job, undefined, now);
    wlog[quiet ? 'debug' : 'info']({ job: job.id, type: job.type, ms: Date.now() - started }, 'job done');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    wlog.warn({ job: job.id, type: job.type, ms: Date.now() - started, err: msg }, 'job failed');
    finish(db, job, msg, now);
  }
  return true;
}

/** После перезапуска воркера «running» — это прерванные задачи. */
export const requeueStale = (db: Db) => db.update(jobs).set({ status: 'queued' }).where(eq(jobs.status, 'running')).run();

/** Выполненные задачи старше суток не нужны (синхронизация ставит задачу каждую минуту). */
export const pruneJobs = (db: Db, now = Date.now()) =>
  db.delete(jobs).where(and(eq(jobs.status, 'done'), lt(jobs.updatedAt, now - 86_400_000))).run();
