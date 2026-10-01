import { describe, expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { testDb } from './helpers';
import { retentionConfirmed, retentionPlan, runRetention, seasonRule } from '@/lib/retention';
import { settleOldCopy } from '@/lib/old-copies';
import { getSetting, setSetting } from '@/lib/settings';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_RETENTION, type RetentionSettings } from '@/lib/retention-settings';
import { deletions, episodeFiles, episodes, oldCopies, seasons, subscriptions, titles } from '@/lib/db/schema';
import type { Profile } from '@/lib/profile-core';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const DAY = 86_400_000;
const today = '2026-10-01';
const NOW = Date.parse('2026-10-01T12:00:00Z');
const on = (o: Partial<RetentionSettings['seasons']> = {}): RetentionSettings => ({ ...DEFAULT_RETENTION, seasons: { on: true, keep: 1, ended: 'keep', ...o } });

/** Сериал: сезоны 1..n по 2 серии; последний — с датами из `last`; файлы всех вышедших серий. */
function setup(o: { last?: (string | null)[]; status?: 'returning' | 'ended'; dub?: number | null; files?: boolean } = {}) {
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 9, kind: 'series', nameRu: 'Гриффины', nameOriginal: 'Family Guy', originalLanguage: 'en', status: o.status ?? 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  db.insert(subscriptions).values({ titleId: t.id, profile: {} as Profile, subscribedAt: 1, updatedAt: 1 }).run();
  const last = o.last ?? ['2026-09-20', '2026-10-20'];
  for (let s = 1; s <= 5; s++) {
    db.insert(seasons).values({ titleId: t.id, number: s, name: `S${s}`, episodeCount: 2 }).run();
    const dates = s < 5 ? [`202${s}-01-01`, `202${s}-01-08`] : last;
    dates.forEach((airDate, i) => {
      db.insert(episodes).values({ titleId: t.id, season: s, number: i + 1, name: `E${i + 1}`, airDate }).run();
      if (o.files !== false && airDate && airDate <= today)
        db.insert(episodeFiles).values({ titleId: t.id, season: s, number: i + 1, path: `G/S${s}/E${i + 1}.mkv`, size: 1000, method: 'copy', importedAt: NOW - 40 * DAY, dubPosition: s === 5 ? (o.dub === undefined ? 0 : o.dub) : 0 }).run();
    });
  }
  return { db, t };
}

describe('сезоны: последний + выходящий', () => {
  test('выходящий S5 скачан (все вышедшие серии) — удаляются S1–S3', () => {
    const { db, t } = setup();
    expect(seasonRule(db, t.id, on(), today)).toEqual({ label: 'S04 + выходящий', drop: [1, 2, 3] });
    const items = retentionPlan(db, on(), NOW, today);
    expect(items).toEqual([expect.objectContaining({ rule: 'seasons', label: 'Гриффины · S01–S03', why: 'старше последнего вышедшего сезона', size: 6000 })]);
    expect(items[0].files).toHaveLength(6);
  });
  test('выходящий скачан не весь или в запасной озвучке — ничего', () => {
    const missing = setup();
    missing.db.delete(episodeFiles).where(eq(episodeFiles.season, 5)).run();
    expect(seasonRule(missing.db, missing.t.id, on(), today).drop).toEqual([]);
    const backup = setup({ dub: 1 });
    expect(seasonRule(backup.db, backup.t.id, on(), today).drop).toEqual([]);
  });
  test('перерыв между сезонами — последний не трогается', () => {
    const { db, t } = setup({ last: ['2026-09-01', '2026-09-08'] });
    expect(seasonRule(db, t.id, on(), today)).toEqual({ label: 'S04 + выходящий', drop: [1, 2, 3] });
    expect(seasonRule(db, t.id, on({ keep: 4 }), today).drop).toEqual([]);
  });
  test('завершённый: не трогать / тоже чистить', () => {
    const { db, t } = setup({ status: 'ended', last: ['2026-09-01', '2026-09-08'] });
    expect(seasonRule(db, t.id, on(), today)).toEqual({ label: 'завершён', drop: [] });
    expect(seasonRule(db, t.id, on({ ended: 'clean' }), today)).toEqual({ label: 'последний', drop: [1, 2, 3, 4] });
  });
  test('исключение и выключенное правило', () => {
    const { db, t } = setup();
    expect(seasonRule(db, t.id, DEFAULT_RETENTION, today)).toEqual({ label: 'все сезоны', drop: [] });
    db.update(subscriptions).set({ keepAll: true }).run();
    expect(seasonRule(db, t.id, on(), today)).toEqual({ label: 'исключение: все', drop: [] });
    expect(retentionPlan(db, on(), NOW, today)).toEqual([]);
  });
});

describe('старая копия и N дней', () => {
  test('через 3 дня / при уборке / сразу', () => {
    const { db, t } = setup({ files: false });
    db.insert(oldCopies).values({ titleId: t.id, season: 5, number: 1, path: '.dublyarr-old/G/a.mkv', size: 7, reason: '1080p → 2160p', createdAt: NOW - DAY }).run();
    db.insert(oldCopies).values({ titleId: t.id, season: 5, number: 2, path: '.dublyarr-old/G/b.mkv', size: 9, reason: '1080p → 2160p', createdAt: NOW - 4 * DAY }).run();
    const plan = (mode: RetentionSettings['oldCopy']) => retentionPlan(db, { ...DEFAULT_RETENTION, oldCopy: mode }, NOW, today).map((i) => [i.rule, i.label, i.size]);
    expect(plan('3days')).toEqual([['oldCopy', 'Гриффины · S05E02', 9]]);
    expect(plan('cleanup')).toHaveLength(2);
    expect(plan('now')).toHaveLength(2); // ждут подтверждения правила (2b)
  });
  test('удалять через N дней — только у сериала с флагом', () => {
    const { db } = setup();
    expect(retentionPlan(db, DEFAULT_RETENTION, NOW, today).filter((i) => i.rule === 'age')).toEqual([]);
    db.update(subscriptions).set({ autoDelete: true }).run();
    const age = retentionPlan(db, DEFAULT_RETENTION, NOW, today).filter((i) => i.rule === 'age');
    expect(age).toHaveLength(9); // 4 сезона по 2 + вышедшая серия S5
    expect(age[0]).toMatchObject({ why: 'скачано больше 30 дн назад' });
  });
});

describe('выполнение уборки', () => {
  const withFiles = () => {
    const s = setup();
    const media = mkdtempSync(path.join(tmpdir(), 'dy-ret-'));
    for (const f of s.db.select().from(episodeFiles).all()) {
      mkdirSync(path.dirname(path.join(media, f.path)), { recursive: true });
      writeFileSync(path.join(media, f.path), 'x');
    }
    return { ...s, media };
  };
  test('до подтверждения ничего не удаляется; подтверждение — удаляет отмеченное, неотмеченное потом не трогается', async () => {
    const { db, media } = withFiles();
    expect(await runRetention(db, media, on(), NOW)).toEqual({ deleted: 0, freed: 0, pending: 1 });
    expect(existsSync(path.join(media, 'G/S1/E1.mkv'))).toBe(true);
    expect(getSetting(db, 'retention.pending')).toEqual({ count: 1, size: 6000 });
    const [item] = retentionPlan(db, on(), NOW, today);
    expect(await runRetention(db, media, on(), NOW, { confirmKeys: [item.key] })).toMatchObject({ deleted: 6, freed: 6000 });
    expect(existsSync(path.join(media, 'G/S1'))).toBe(false); // пустая папка сезона убрана
    expect(existsSync(path.join(media, 'G/S4/E1.mkv'))).toBe(true);
    expect(retentionConfirmed(db).seasons).toBe(true);
    expect(db.select().from(deletions).all()).toEqual([expect.objectContaining({ label: 'Гриффины · S01–S03', why: 'старше последнего вышедшего сезона', size: 6000 })]);
  });
  test('неотмеченное — «не удалять»', async () => {
    const { db, media } = withFiles();
    db.update(subscriptions).set({ autoDelete: true }).run();
    const ages = retentionPlan(db, DEFAULT_RETENTION, NOW, today).filter((i) => i.rule === 'age');
    await runRetention(db, media, DEFAULT_RETENTION, NOW, { confirmKeys: [ages[0].key] });
    expect(await runRetention(db, media, DEFAULT_RETENTION, NOW + DAY)).toMatchObject({ deleted: 0, pending: 0 });
    expect(db.select().from(episodeFiles).all()).toHaveLength(8);
  });
  test('путь вне медиатеки — отказ, запись на месте', async () => {
    const { db, media } = withFiles();
    db.update(episodeFiles).set({ path: '../evil.mkv' }).where(eq(episodeFiles.season, 1)).run();
    const [item] = retentionPlan(db, on(), NOW, today);
    const r = await runRetention(db, media, on(), NOW, { confirmKeys: [item.key] });
    expect(r.deleted).toBe(4);
    expect(db.select().from(episodeFiles).where(eq(episodeFiles.season, 1)).all()).toHaveLength(2);
  });
  test('«Удалить через 3 дня»: старая копия после подтверждения правила остаётся в скрытой папке до уборки', async () => {
    const { db, media } = withFiles();
    setSetting(db, 'retention', { ...DEFAULT_RETENTION, oldCopy: '3days' });
    setSetting(db, 'retention.oldCopy.confirmed', true);
    mkdirSync(path.join(media, '.dublyarr-old/G'), { recursive: true });
    writeFileSync(path.join(media, '.dublyarr-old/G/x.mkv'), 'old');
    await settleOldCopy(db, media, '.dublyarr-old/G/x.mkv', { titleId: 1, season: 5, number: 1 }, '1080p → 2160p', NOW);
    expect(existsSync(path.join(media, '.dublyarr-old/G/x.mkv'))).toBe(true);
    const settings = { ...DEFAULT_RETENTION, oldCopy: '3days' as const };
    expect((await runRetention(db, media, settings, NOW + DAY)).deleted).toBe(0);
    expect((await runRetention(db, media, settings, NOW + 4 * DAY)).deleted).toBe(1);
    expect(existsSync(path.join(media, '.dublyarr-old/G/x.mkv'))).toBe(false);
  });
});
