import { describe, expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { testDb } from './helpers';
import { retentionConfirmed, retentionPlan, runRetention, seasonRule } from '@/lib/retention';
import { confirmOldCopies, settleOldCopy } from '@/lib/old-copies';
import { saveRetentionSettings, setSeriesExceptions } from '@/lib/retention-settings';
import { getSetting, setSetting } from '@/lib/settings';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_RETENTION, type RetentionSettings } from '@/lib/retention-settings';
import { deletions, episodeFiles, episodes, notifications, oldCopies, retiredEpisodes, seasons, subscriptions, titles } from '@/lib/db/schema';
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
    expect(items.map((i) => [i.rule, i.label, i.size])).toEqual([
      ['seasons', 'Гриффины · S01', 2000],
      ['seasons', 'Гриффины · S02', 2000],
      ['seasons', 'Гриффины · S03', 2000],
    ]);
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
    expect(await runRetention(db, media, on(), NOW)).toEqual({ deleted: 0, freed: 0, pending: 3 });
    expect(existsSync(path.join(media, 'G/S1/E1.mkv'))).toBe(true);
    expect(getSetting(db, 'retention.pending')).toEqual({ count: 3, size: 6000 });
    const keys = retentionPlan(db, on(), NOW, today).map((i) => i.key);
    expect(await runRetention(db, media, on(), NOW, { confirmKeys: keys })).toMatchObject({ deleted: 6, freed: 6000 });
    expect(existsSync(path.join(media, 'G/S1'))).toBe(false); // пустая папка сезона убрана
    expect(existsSync(path.join(media, 'G/S4/E1.mkv'))).toBe(true);
    expect(retentionConfirmed(db).seasons).toBe(true);
    expect(db.select().from(deletions).all().map((d) => d.label)).toEqual(['Гриффины · S01', 'Гриффины · S02', 'Гриффины · S03']);
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
    const keys = retentionPlan(db, on(), NOW, today).map((i) => i.key);
    const r = await runRetention(db, media, on(), NOW, { confirmKeys: keys });
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

describe('исправления по ревью', () => {
  const withFiles = () => {
    const s = setup();
    const media = mkdtempSync(path.join(tmpdir(), 'dy-ret2-'));
    for (const f of s.db.select().from(episodeFiles).all()) {
      mkdirSync(path.dirname(path.join(media, f.path)), { recursive: true });
      writeFileSync(path.join(media, f.path), 'x');
    }
    return { ...s, media };
  };
  test('сезоны — по одному пункту на сезон; «не удалять» сезон держится при смене набора; удалённые серии помечены', async () => {
    const { db, media, t } = withFiles();
    expect(retentionPlan(db, on(), NOW, today).map((i) => i.key)).toEqual([`s:${t.id}:1`, `s:${t.id}:2`, `s:${t.id}:3`]);
    await runRetention(db, media, on(), NOW, { confirmKeys: [`s:${t.id}:2`, `s:${t.id}:3`] });
    expect(existsSync(path.join(media, 'G/S1/E1.mkv'))).toBe(true);
    // правило подтверждено, набор стал другим (keep 1 → другой сезон тоже под удалением) — S01 всё равно не трогаем
    await runRetention(db, media, on(), NOW + DAY);
    expect(existsSync(path.join(media, 'G/S1/E1.mkv'))).toBe(true);
    expect(db.select().from(retiredEpisodes).all().map((r) => `${r.season}:${r.number}`).sort()).toEqual(['2:1', '2:2', '3:1', '3:2']);
  });
  test('подтверждение правила не отклоняет пункты других правил', async () => {
    const { db, media, t } = withFiles();
    db.insert(oldCopies).values({ titleId: t.id, season: 5, number: 1, path: '.dublyarr-old/x.mkv', size: 1, reason: 'r', createdAt: 1 }).run();
    await runRetention(db, media, on(), NOW, { confirmKeys: [`s:${t.id}:1`] });
    expect(getSetting<string[]>(db, 'retention.declined') ?? []).not.toContain(expect.stringMatching(/^o:/));
  });
  test('более жёсткие настройки и новый сериал «через N дней» снова требуют подтверждения', async () => {
    const { db } = withFiles();
    setSetting(db, 'retention.seasons.confirmed', true);
    setSetting(db, 'retention.age.confirmed', true);
    saveRetentionSettings(db, { ...on(), seasons: { on: true, keep: 2, ended: 'keep' } });
    saveRetentionSettings(db, { ...on(), seasons: { on: true, keep: 3, ended: 'keep' } }); // мягче — подтверждение остаётся
    expect(retentionConfirmed(db).seasons).toBe(true);
    saveRetentionSettings(db, { ...on(), seasons: { on: true, keep: 1, ended: 'keep' } }); // жёстче
    expect(retentionConfirmed(db).seasons).toBe(false);
    const t = db.select().from(titles).get()!;
    setSeriesExceptions(db, t.id, { keepAll: false, autoDelete: true });
    expect(retentionConfirmed(db).age).toBe(false);
  });
});

describe('старые копии из 2b', () => {
  test('неотмеченные на /old-copies — «не удалять»; старая база — уже подтверждённые копии не удаляются уборкой', async () => {
    const s = setup({ files: false });
    const media = mkdtempSync(path.join(tmpdir(), 'dy-oc-'));
    mkdirSync(path.join(media, '.dublyarr-old'), { recursive: true });
    const add = (n: number) => {
      writeFileSync(path.join(media, `.dublyarr-old/${n}.mkv`), 'x');
      return s.db.insert(oldCopies).values({ titleId: s.t.id, season: 1, number: n, path: `.dublyarr-old/${n}.mkv`, size: 1, reason: 'r', createdAt: 1 }).returning().get();
    };
    const a = add(1);
    add(2);
    await confirmOldCopies(s.db, media, [a.id]);
    const cleanup = { ...DEFAULT_RETENTION, oldCopy: 'cleanup' as const };
    expect((await runRetention(s.db, media, cleanup, NOW)).deleted).toBe(0);
    expect(existsSync(path.join(media, '.dublyarr-old/2.mkv'))).toBe(true);
    // база из 2b: правило подтверждено раньше, копии остались — при первой уборке 3b они не удаляются
    const s2 = setup({ files: false });
    setSetting(s2.db, 'retention.oldCopy.confirmed', true);
    s2.db.insert(oldCopies).values({ titleId: s2.t.id, season: 1, number: 3, path: '.dublyarr-old/3.mkv', size: 1, reason: 'r', createdAt: 1 }).run();
    writeFileSync(path.join(media, '.dublyarr-old/3.mkv'), 'x');
    expect((await runRetention(s2.db, media, cleanup, NOW)).deleted).toBe(0);
  });
  test('в режиме «через 3 дня» после подтверждения — без уведомления «ждут подтверждения»', async () => {
    const s = setup({ files: false });
    const media = mkdtempSync(path.join(tmpdir(), 'dy-oc2-'));
    mkdirSync(path.join(media, '.dublyarr-old'), { recursive: true });
    writeFileSync(path.join(media, '.dublyarr-old/x.mkv'), 'x');
    setSetting(s.db, 'retention', { ...DEFAULT_RETENTION, oldCopy: '3days' });
    setSetting(s.db, 'retention.oldCopy.confirmed', true);
    await settleOldCopy(s.db, media, '.dublyarr-old/x.mkv', { titleId: s.t.id, season: 1, number: 1 }, 'r', NOW);
    expect(s.db.select().from(notifications).all()).toEqual([]);
  });
});
