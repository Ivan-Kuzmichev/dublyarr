import { describe, expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { testDbWithChat } from './helpers';
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
  expect(await diskUsage('/media', statfs)).toEqual({ total: 4096000, free: 1024000, used: 2867200, pct: 74 }); // как df: занято = blocks − bfree, % от доступного пользователю
  expect(await diskUsage('/nope', (async () => { throw new Error('ENOENT'); }) as never)).toBeNull();
});

describe('защита от переполнения', () => {
  async function setup() {
    const db = testDbWithChat();
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

describe('данные «Хранилища»', () => {
  const GB = 1024 ** 3;
  const DAY = 86_400_000;
  async function setup() {
    const { episodeFiles: ef, episodes: ep, seasons: se, subscriptions: su, deletions: de } = await import('@/lib/db/schema');
    const db = testDbWithChat();
    const mk = (tmdbId: number, nameRu: string, kind: 'series' | 'anime') => db.insert(titles).values({ tmdbId, kind, nameRu, nameOriginal: nameRu, originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
    const g = mk(1, 'Гриффины', 'series');
    const a = mk(2, 'Фрирен', 'anime');
    db.insert(su).values({ titleId: g.id, profile: {} as never, subscribedAt: 1, updatedAt: 1 }).run();
    db.insert(su).values({ titleId: a.id, profile: {} as never, subscribedAt: 1, updatedAt: 1, keepAll: true }).run();
    for (let s = 1; s <= 3; s++) {
      db.insert(se).values({ titleId: g.id, number: s, name: `S${s}`, episodeCount: 1 }).run();
      db.insert(ep).values({ titleId: g.id, season: s, number: 1, name: 'E1', airDate: s < 3 ? `202${s}-01-01` : '2026-09-28' }).run();
      db.insert(ef).values({ titleId: g.id, season: s, number: 1, path: `G/${s}.mkv`, size: 10 * GB, resolution: 2160, method: 'copy', importedAt: NOW - (s === 3 ? 2 * DAY : 400 * DAY), dubPosition: 0 }).run();
    }
    db.insert(ep).values({ titleId: g.id, season: 3, number: 2, name: 'E2', airDate: '2026-10-20' }).run();
    db.insert(ef).values({ titleId: a.id, season: 1, number: 1, path: 'F/1.mkv', size: 4 * GB, resolution: 1080, method: 'copy', importedAt: NOW - 3 * DAY }).run();
    db.insert(de).values({ titleId: g.id, label: 'Гриффины · S00', why: 'старше', size: GB, at: NOW - DAY }).run();
    return { db, g };
  }
  test('диск, строки сериалов, прогноз, история', async () => {
    const { storageData } = await import('@/lib/storage');
    const { db } = await setup();
    const settings = { ...DEFAULT_RETENTION, seasons: { on: true, keep: 1, ended: 'keep' as const } };
    const d = storageData(db, disk(50), settings, NOW, '2026-10-01');
    expect(d.segments.map((x) => [x.name, Math.round(x.size / 1024 ** 3)])).toEqual([
      ['Сериалы', 30],
      ['Аниме', 4],
      ['Не Dublyarr', 4096 - 34],
      ['Свободно', 4096],
    ]);
    expect(d.shows.map((s) => [s.title, s.seasons, s.quality, Math.round(s.size / 1024 ** 3), s.rule, s.dropPct])).toEqual([
      ['Гриффины', 'S01–S03', '2160p', 30, 'S02 + выходящий', 33],
      ['Фрирен', 'S01', '1080p', 4, 'исключение: все', 0],
    ]);
    // для удаления по сезонам и сериям: сезоны с размером и серии
    const parts = d.shows[0].parts;
    expect(parts.map((p) => p.season)).toEqual([1, 2, 3]);
    expect(parts.every((p) => p.size === p.episodes.reduce((n, e) => n + e.size, 0) && p.episodes.length > 0)).toBe(true);
    expect(d.shows[0].parts[0].episodes[0]).toEqual({ number: expect.any(Number), size: expect.any(Number) });
    expect(d.pending.map((p) => p.label)).toEqual(['Гриффины · S01']); // по сезону
    expect(d.pendingRule).toBe('seasons');
    expect(Math.round(d.forecast.perWeek / 1024 ** 3)).toBe(3); // (10 + 4) ГБ за месяц → ~3,3 в неделю
    expect(d.forecast.weeksLeft).toBeGreaterThan(1000);
    expect(d.history).toEqual([expect.objectContaining({ label: 'Гриффины · S00' })]);
  });
});
