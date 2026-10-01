import { describe, expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { testDb } from './helpers';
import { fakeQbit } from './fake-qbit';
import { checkDisk, diskUsage, type Disk } from '@/lib/storage';
import { applySpeed } from '@/lib/speed';
import { activityQueue, controlDownload } from '@/lib/activity';
import { todayData } from '@/lib/dashboard';
import { DEFAULT_RETENTION } from '@/lib/retention-settings';
import { downloads, notifications, titles } from '@/lib/db/schema';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const TB = 1024 ** 4;
const disk = (pct: number): Disk => ({ total: 8 * TB, used: (8 * TB * pct) / 100, free: 8 * TB * (1 - pct / 100), pct });
const NOW = Date.parse('2026-10-01T12:00:00Z');

test('занятость тома по statfs', async () => {
  const statfs = (async () => ({ bsize: 4096, blocks: 1000, bfree: 300, bavail: 250 })) as never;
  expect(await diskUsage('/media', statfs)).toEqual({ total: 4096000, free: 1024000, used: 3072000, pct: 75 });
  expect(await diskUsage('/nope', (async () => { throw new Error('ENOENT'); }) as never)).toBeNull();
});

describe('защита от переполнения', () => {
  async function setup() {
    const db = testDb();
    const t = db.insert(titles).values({ tmdbId: 1, kind: 'series', nameRu: 'A', nameOriginal: 'A', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
    const fq = fakeQbit();
    const hash = 'a'.repeat(40);
    await fq.qbit.add({ magnet: `magnet:?xt=urn:btih:${hash}` }, { savePath: '/downloads/dublyarr', category: 'dublyarr', paused: false });
    const d = db.insert(downloads).values({ hash, titleId: t.id, season: 1, kind: 'episode', episodes: [], state: 'downloading', name: 'x', size: 1, addedAt: 1 }).returning().get();
    return { db, fq, d };
  }

  test('91 % — предупреждение раз в сутки и пункт «Требует внимания»', async () => {
    const { db } = await setup();
    expect(checkDisk(db, disk(91), DEFAULT_RETENTION, NOW)).toBe('warn');
    expect(checkDisk(db, disk(91), DEFAULT_RETENTION, NOW + 60_000)).toBe('warn');
    expect(db.select().from(notifications).all().map((n) => n.text)).toEqual(['💾 Диск медиатеки заполнен на 91 %']);
    expect(todayData(db, '2026-10-01', NOW).attention).toContainEqual(expect.objectContaining({ title: 'Мало места на диске', text: 'Занято 91 %', href: '/storage' }));
  });

  test('98 % — пауза; ручное «Продолжить» не помогает; ниже порога — запускаются только свои', async () => {
    const { db, fq, d } = await setup();
    expect(checkDisk(db, disk(98), DEFAULT_RETENTION, NOW)).toBe('pause');
    await applySpeed(db, fq.qbit, new Date(NOW));
    expect(db.select().from(downloads).where(eq(downloads.id, d.id)).get()).toMatchObject({ state: 'paused', pausedBySchedule: true });
    expect(activityQueue(db, NOW)[0].state).toBe('Пауза: мало места · 0 %');
    await controlDownload(db, fq.qbit, d.id, 'resume');
    checkDisk(db, disk(98), DEFAULT_RETENTION, NOW + 60_000);
    await applySpeed(db, fq.qbit, new Date(NOW + 60_000));
    expect(db.select().from(downloads).where(eq(downloads.id, d.id)).get()!.state).toBe('paused');
    expect(checkDisk(db, disk(80), DEFAULT_RETENTION, NOW + 120_000)).toBe('ok');
    await applySpeed(db, fq.qbit, new Date(NOW + 120_000));
    expect(db.select().from(downloads).where(eq(downloads.id, d.id)).get()!.state).toBe('downloading');
  });

  test('защита выключена — ничего', async () => {
    const { db } = await setup();
    expect(checkDisk(db, disk(99), { ...DEFAULT_RETENTION, overflow: { on: false, warn: 90, pause: 97 } }, NOW)).toBe('ok');
    expect(db.select().from(notifications).all()).toEqual([]);
  });
});
