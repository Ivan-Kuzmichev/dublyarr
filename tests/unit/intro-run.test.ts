import { expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from './helpers';
import { episodeFiles, titles } from '@/lib/db/schema';
import { nextSeason, processSeason, resetIntroMarks } from '@/lib/intros/run';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync, linkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IntroTools } from '@/lib/intros/tools';
import { STEP } from '@/lib/intros/fingerprint';
import { setSetting } from '@/lib/settings';

type Db = ReturnType<typeof testDb>;
let nextTmdb = 73000;
export function seriesWithFiles(db: Db, n: number, o: { kind?: 'anime' | 'series' | 'movie'; season?: number } = {}) {
  const t = db.insert(titles).values({ tmdbId: ++nextTmdb, kind: o.kind ?? 'anime', nameRu: 'Чёрный клевер', nameOriginal: 'Black Clover', originalLanguage: 'ja', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  const files = Array.from({ length: n }, (_, i) =>
    db.insert(episodeFiles).values({ titleId: t.id, season: o.season ?? 1, number: i + 1, path: `Клевер/Season 01/E${i + 1}.mkv`, size: 100 + i, method: 'hardlink', importedAt: 10 + i, processed: true, duration: 1450 }).returning().get(),
  );
  return { t, files };
}

test('сброс: «не нашлось» в сезоне снова в очереди, остальное не трогается', () => {
  const db = testDb();
  const { t, files } = seriesWithFiles(db, 3);
  db.update(episodeFiles).set({ introState: 'none' }).where(eq(episodeFiles.id, files[0].id)).run();
  db.update(episodeFiles).set({ introState: 'marked' }).where(eq(episodeFiles.id, files[1].id)).run();
  resetIntroMarks(db, t.id, 1);
  expect(db.select().from(episodeFiles).all().map((f) => f.introState)).toEqual([null, 'marked', null]);
});


const sec = (s: number) => Math.round(s / STEP);
function noise(n: number, seed: number) {
  const out = new Uint32Array(n);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; out[i] = x; }
  return out;
}
/** «Файлы» серий: опенинг в своём месте у каждой, эндинг за 2 мин до конца. */
function fakeTools(o: { opAt: Record<string, number>; chapters?: Record<string, number> }) {
  const op = noise(sec(74), 7);
  const ed = noise(sec(67), 8);
  const written: { file: string; text: string }[] = [];
  const fpCalls: string[] = [];
  const tools: IntroTools = {
    available: async () => true,
    duration: async () => 1450,
    chapterCount: async (f) => o.chapters?.[path.basename(f)] ?? 0,
    async fingerprint(file, start, dur) {
      fpCalls.push(`${path.basename(file)}@${start}`);
      const seed = [...path.basename(file)].reduce((a, c) => a * 31 + c.charCodeAt(0), 7);
      const full = noise(sec(1450), seed);
      const at = o.opAt[path.basename(file)];
      if (at !== undefined) full.set(op, sec(at));
      full.set(ed, sec(1450 - 130));
      return full.slice(sec(start), sec(start) + sec(dur));
    },
    async setChapters(file, chaptersFile) {
      written.push({ file, text: readFileSync(chaptersFile, 'utf8') });
    },
  };
  return { tools, written, fpCalls };
}
function mediaWith(db: Db, n: number, opAt: (i: number) => number | undefined, o: { processed?: boolean; link?: boolean } = {}) {
  const media = mkdtempSync(path.join(tmpdir(), 'dy-intro-'));
  const dl = mkdtempSync(path.join(tmpdir(), 'dy-dl-'));
  const { t, files } = seriesWithFiles(db, n);
  const at: Record<string, number> = {};
  for (const f of files) {
    const abs = path.join(media, f.path);
    mkdirSync(path.dirname(abs), { recursive: true });
    if (o.link) {
      const src = path.join(dl, path.basename(f.path));
      writeFileSync(src, 'v'.repeat(f.size));
      linkSync(src, abs);
    } else writeFileSync(abs, 'v'.repeat(f.size));
    const a = opAt(f.number);
    if (a !== undefined) at[path.basename(f.path)] = a;
  }
  if (o.processed === false) db.update(episodeFiles).set({ processed: false }).run();
  return { media, dl, t, files, at, cacheDir: mkdtempSync(path.join(tmpdir(), 'dy-fp-')) };
}

test('сезон: опенинг и эндинг найдены у всех, главы записаны, «размечено»', async () => {
  const db = testDb();
  const m = mediaWith(db, 5, (n) => [113, 68, 113, 144, 90][n - 1]);
  const { tools, written } = fakeTools({ opAt: m.at });
  const r = await processSeason(db, tools, { media: m.media, cacheDir: m.cacheDir, now: 1000 });
  expect(r).toMatchObject({ titleId: m.t.id, season: 1, marked: 5 });
  const rows = db.select().from(episodeFiles).all();
  expect(rows.every((f) => f.introState === 'marked')).toBe(true);
  expect(Math.abs(rows[0].introStart! - 113_000)).toBeLessThan(1000);
  expect(Math.abs(rows[0].creditsStart! - 1_320_000)).toBeLessThan(1000);
  expect(written).toHaveLength(5);
  expect(written[0].text).toContain('NAME=Intro');
  expect(written[0].text).toContain('NAME=Credits');
});

test('свои главы и не mkv — пропуск; одна серия в сезоне — «мало серий»', async () => {
  const db = testDb();
  const m = mediaWith(db, 3, () => 100);
  db.update(episodeFiles).set({ path: 'Клевер/Season 01/E3.avi' }).where(eq(episodeFiles.number, 3)).run();
  writeFileSync(path.join(m.media, 'Клевер/Season 01/E3.avi'), 'v');
  const { tools } = fakeTools({ opAt: m.at, chapters: { 'E2.mkv': 6 } });
  await processSeason(db, tools, { media: m.media, cacheDir: m.cacheDir, now: 1 });
  const by = (n: number) => db.select().from(episodeFiles).where(eq(episodeFiles.number, n)).get()!;
  expect(by(2)).toMatchObject({ introState: 'skipped', introNote: 'свои главы' });
  expect(by(3)).toMatchObject({ introState: 'skipped', introNote: 'не mkv' });
  // E1 — без пригодных соседей
  expect(by(1)).toMatchObject({ introState: 'none', introNote: 'мало серий' });
});

test('жёсткая ссылка: при свободном диске — копия (раздача не тронута), при полном — ждёт', async () => {
  const db = testDb();
  const m = mediaWith(db, 3, () => 100, { processed: false, link: true });
  const { tools } = fakeTools({ opAt: m.at });
  setSetting(db, 'storage.state', { pct: 50, level: 'ok' });
  await processSeason(db, tools, { media: m.media, cacheDir: m.cacheDir, now: 1 });
  const f = db.select().from(episodeFiles).get()!;
  expect(f).toMatchObject({ introState: 'marked', method: 'copy' });
  expect(statSync(path.join(m.media, f.path)).nlink).toBe(1);
  expect(statSync(path.join(m.dl, 'E1.mkv')).nlink).toBe(1); // исходник раздачи на месте

  const db2 = testDb();
  const m2 = mediaWith(db2, 3, () => 100, { processed: false, link: true });
  setSetting(db2, 'storage.state', { pct: 95, level: 'warn' });
  await processSeason(db2, fakeTools({ opAt: m2.at }).tools, { media: m2.media, cacheDir: m2.cacheDir, now: 1 });
  expect(db2.select().from(episodeFiles).all().map((x) => x.introState)).toEqual(['waiting', 'waiting', 'waiting']);
});

test('waiting не мешает другим сезонам: перепроверка не чаще раза в час', () => {
  const db = testDb();
  const a = seriesWithFiles(db, 2);
  const b = seriesWithFiles(db, 2);
  db.update(episodeFiles).set({ introState: 'waiting', introCheckedAt: 1000 }).where(eq(episodeFiles.titleId, a.t.id)).run();
  expect(nextSeason(db, 2000)).toEqual({ titleId: b.t.id, season: 1 });
  db.update(episodeFiles).set({ introState: 'marked' }).where(eq(episodeFiles.titleId, b.t.id)).run();
  expect(nextSeason(db, 2000)).toBeNull();
  expect(nextSeason(db, 1000 + 3_600_000)).toEqual({ titleId: a.t.id, season: 1 });
});

test('фильмы не размечаются', () => {
  const db = testDb();
  seriesWithFiles(db, 1, { kind: 'movie', season: 0 });
  expect(nextSeason(db, 1)).toBeNull();
});

test('файл заменён во время прохода — не пишем, серия остаётся в очереди', async () => {
  const db = testDb();
  const m = mediaWith(db, 3, () => 100);
  const { tools, written } = fakeTools({ opAt: m.at });
  const real = tools.fingerprint;
  tools.fingerprint = async (file, s, d) => {
    if (path.basename(file) === 'E3.mkv' && s > 0) db.update(episodeFiles).set({ size: 999, importedAt: 50 }).where(eq(episodeFiles.number, 3)).run();
    return real(file, s, d);
  };
  await processSeason(db, tools, { media: m.media, cacheDir: m.cacheDir, now: 1 });
  expect(written.map((w) => path.basename(w.file))).not.toContain('E3.mkv');
  expect(db.select().from(episodeFiles).where(eq(episodeFiles.number, 3)).get()!.introState).toBeNull();
});

test('кэш отпечатков: повторный проход не считает заново; замена файла — считает', async () => {
  const db = testDb();
  const m = mediaWith(db, 3, () => 100);
  const { tools, fpCalls } = fakeTools({ opAt: m.at });
  await processSeason(db, tools, { media: m.media, cacheDir: m.cacheDir, now: 1 });
  const first = fpCalls.length;
  db.update(episodeFiles).set({ introState: null }).run();
  await processSeason(db, tools, { media: m.media, cacheDir: m.cacheDir, now: 2 });
  expect(fpCalls.length).toBe(first);
  db.update(episodeFiles).set({ introState: null, importedAt: 99 }).where(eq(episodeFiles.number, 1)).run();
  await processSeason(db, tools, { media: m.media, cacheDir: m.cacheDir, now: 3 });
  expect(fpCalls.length).toBe(first + 2); // E1: начало и конец
  expect(existsSync(m.cacheDir)).toBe(true);
});
