import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { testDb } from './helpers';
import { fakeQbit } from './fake-qbit';
import { applySpeed } from '@/lib/speed';
import { activityQueue } from '@/lib/activity';
import { setSetting } from '@/lib/settings';
import { downloads, titles } from '@/lib/db/schema';
import type { SpeedState } from '@/lib/schedule';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const MB = 1024 ** 2;
const all = (st: SpeedState) => Array.from({ length: 7 }, () => Array<SpeedState>(24).fill(st));
const now = new Date(2026, 8, 30, 12);

async function setup() {
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 1, kind: 'series', nameRu: 'A', nameOriginal: 'A', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  const fq = fakeQbit();
  const add = async (hash: string, state: 'downloading' | 'paused' | 'imported') => {
    await fq.qbit.add({ magnet: `magnet:?xt=urn:btih:${hash}` }, { savePath: '/downloads/dublyarr', category: 'dublyarr', paused: state !== 'downloading' });
    return db.insert(downloads).values({ hash, titleId: t.id, season: 1, kind: 'episode', episodes: [], state, name: hash, size: 1, addedAt: 1 }).returning().get();
  };
  return { db, fq, add };
}

test('ограничение делится между качающимися; повтор без изменений ничего не шлёт; полная — снимает', async () => {
  const { db, fq, add } = await setup();
  const a = await add('a'.repeat(40), 'downloading');
  const b = await add('b'.repeat(40), 'downloading');
  await add('c'.repeat(40), 'imported');
  setSetting(db, 'speed', { limitMb: 10, grid: all('limit') });
  expect(await applySpeed(db, fq.qbit, now)).toBe('limit');
  expect(fq.torrents.get(a.hash)!.dl_limit).toBe(5 * MB);
  expect(fq.torrents.get(b.hash)!.dl_limit).toBe(5 * MB);
  expect(fq.torrents.get('c'.repeat(40))!.dl_limit ?? 0).toBe(0);
  fq.calls.length = 0;
  await applySpeed(db, fq.qbit, now);
  expect(fq.calls).toEqual([]);
  setSetting(db, 'speed', { limitMb: 10, grid: all('full') });
  await applySpeed(db, fq.qbit, now);
  expect(fq.torrents.get(a.hash)!.dl_limit).toBe(0);
});

test('пауза по расписанию: останавливает свои качающиеся, потом будит только их', async () => {
  const { db, fq, add } = await setup();
  const a = await add('a'.repeat(40), 'downloading');
  const mine = await add('d'.repeat(40), 'paused'); // остановлена вручную
  setSetting(db, 'speed', { limitMb: 10, grid: all('pause') });
  await applySpeed(db, fq.qbit, now);
  expect(fq.torrents.get(a.hash)!.paused).toBe(true);
  expect(db.select().from(downloads).where(eq(downloads.id, a.id)).get()).toMatchObject({ state: 'paused', pausedBySchedule: true });
  expect(activityQueue(db, now.getTime()).find((r) => r.id === a.id)!.state).toBe('Пауза по расписанию · 0 %');
  setSetting(db, 'speed', { limitMb: 10, grid: all('full') });
  await applySpeed(db, fq.qbit, now);
  expect(fq.torrents.get(a.hash)!.paused).toBe(false);
  expect(db.select().from(downloads).where(eq(downloads.id, a.id)).get()).toMatchObject({ state: 'downloading', pausedBySchedule: false });
  expect(fq.torrents.get(mine.hash)!.paused).toBe(true);
  expect(db.select().from(downloads).where(eq(downloads.id, mine.id)).get()!.state).toBe('paused');
});
