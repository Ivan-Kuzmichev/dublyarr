import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { testDb } from './helpers';
import { confirmOldCopies, oldCopiesSummary, OLD_DIR } from '@/lib/old-copies';
import { oldCopies, titles } from '@/lib/db/schema';
import { getSetting } from '@/lib/settings';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');

function setup() {
  const db = testDb();
  const media = mkdtempSync(path.join(tmpdir(), 'dy-old-'));
  const t = db.insert(titles).values({ tmdbId: 1, kind: 'series', nameRu: 'A', nameOriginal: 'A', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  const put = (rel: string) => {
    mkdirSync(path.dirname(path.join(media, rel)), { recursive: true });
    writeFileSync(path.join(media, rel), 'x');
  };
  const add = (rel: string, size = 10) => db.insert(oldCopies).values({ titleId: t.id, season: 1, number: 1, path: rel, size, reason: 'LostFilm → HDrezka', createdAt: 1 }).returning().get();
  return { db, media, put, add };
}

test('подтверждение удаляет только отмеченные и включает правило', async () => {
  const { db, media, put, add } = setup();
  put(`${OLD_DIR}/A/1.mkv`);
  put(`${OLD_DIR}/A/2.mkv`);
  const a = add(`${OLD_DIR}/A/1.mkv`, 3 * 1024 ** 3);
  add(`${OLD_DIR}/A/2.mkv`, 1024 ** 3);
  expect(oldCopiesSummary(db)).toEqual({ count: 2, size: 4 * 1024 ** 3 });
  expect(await confirmOldCopies(db, media, [a.id])).toEqual({ deleted: 1, freed: 3 * 1024 ** 3, refused: 0 });
  expect(existsSync(path.join(media, OLD_DIR, 'A/1.mkv'))).toBe(false);
  expect(existsSync(path.join(media, OLD_DIR, 'A/2.mkv'))).toBe(true);
  expect(oldCopiesSummary(db).count).toBe(1);
  expect(getSetting(db, 'retention.oldCopy.confirmed')).toBe(true);
});

test('путь вне скрытой папки — отказ, файл и запись на месте', async () => {
  const { db, media, put, add } = setup();
  put('A/keep.mkv');
  const bad = add(`${OLD_DIR}/../A/keep.mkv`);
  const outside = add('A/keep.mkv');
  expect(await confirmOldCopies(db, media, [bad.id, outside.id])).toEqual({ deleted: 0, freed: 0, refused: 2 });
  expect(existsSync(path.join(media, 'A/keep.mkv'))).toBe(true);
  expect(oldCopiesSummary(db).count).toBe(2);
});
