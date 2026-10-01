import { describe, expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { testDb } from './helpers';
import { retentionPlan, seasonRule } from '@/lib/retention';
import { DEFAULT_RETENTION, type RetentionSettings } from '@/lib/retention-settings';
import { episodeFiles, episodes, oldCopies, seasons, subscriptions, titles } from '@/lib/db/schema';
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
