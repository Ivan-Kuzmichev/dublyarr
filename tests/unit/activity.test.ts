import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { activityQueue, controlDownload } from '@/lib/activity';
import { fakeQbit } from './fake-qbit';
import { eq } from 'drizzle-orm';
import type { ParsedRelease } from '@/lib/parse/types';
import { downloads, releases, sources, titles } from '@/lib/db/schema';

const HOUR = 3_600_000;
const NOW = 100 * HOUR;

test('очередь: тексты состояний и порядок', () => {
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 7, kind: 'series', nameRu: 'Эль', nameOriginal: 'Elle', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  const base = { titleId: t.id, season: 1, size: 1e9, addedAt: NOW - HOUR, files: null };
  const add = (o: Partial<typeof downloads.$inferInsert> & { hash: string }) => db.insert(downloads).values({ kind: 'episode', episodes: [{ season: 1, number: 3 }], state: 'downloading', name: 'Elle.S01E03.2160p', ...base, ...o }).run();
  add({ hash: 'a', progress: 0.64, eta: 240, dlSpeed: 12_900_000, addedAt: NOW - 2 * HOUR });
  add({
    hash: 'b', kind: 'pack', progress: 0.21, eta: 1020, dlSpeed: 6_000_000, episodes: [{ season: 1, number: 3 }],
    files: [0, 1, 2].map((i) => ({ index: i, name: `E0${i + 1}.mkv`, size: 1, priority: i === 2 ? 1 : 0 })),
  });
  add({ hash: 'c', state: 'stalled', progress: 0.08, lastSeededAt: NOW - 30 * HOUR, addedAt: NOW - 40 * HOUR });
  add({ hash: 'd', state: 'error', lastError: 'В раздаче нет файла S01E05' });
  add({ hash: 'e', state: 'imported', importedAt: NOW - HOUR, progress: 1 });
  add({ hash: 'f', state: 'imported', importedAt: NOW - 30 * HOUR, progress: 1 });
  add({ hash: 'g', state: 'paused', progress: 0.5 });
  add({ hash: 'h', state: 'removed' });
  const q = activityQueue(db, NOW);
  expect(q.map((r) => r.hash)).toEqual(['b', 'g', 'a', 'c', 'd', 'e']);
  const by = (h: string) => q.find((r) => r.hash === h)!;
  expect(by('a')).toMatchObject({ title: 'Эль', code: 'S01E03', pct: 64, state: 'Качается · 64 % · 4 мин', speed: '12,3 МБ/с', tone: 'progress', canPause: true });
  expect(by('b')).toMatchObject({ state: 'Из пака: 1 файл из 3 · 21 % · 17 мин' });
  expect(by('c')).toMatchObject({ state: 'Нет сидов 30 ч · 8 %', tone: 'danger' });
  expect(by('d')).toMatchObject({ state: 'Ошибка: В раздаче нет файла S01E05', tone: 'danger', canPause: false });
  expect(by('e')).toMatchObject({ state: 'В медиатеке', tone: 'ok' });
  expect(by('g')).toMatchObject({ state: 'На паузе · 50 %', canResume: true });
});

test('заменённая загрузка видна сутки с заметкой; пак с топиком — «следим за обновлениями»', async () => {
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 7, kind: 'series', nameRu: 'Эль', nameOriginal: 'Elle', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  const s = db.insert(sources).values({ name: 'J', url: 'http://j', createdAt: 1 }).returning().get();
  const parsed = { base: 'x', names: [], year: null, seasons: [1], episodes: null, totalInSeason: null, absolute: false, pack: true, resolution: 1080, source: null, hdr: false, dv: false, screener: false, dubs: [], original: false, subs: false } as ParsedRelease;
  const r = db.insert(releases).values({ titleId: t.id, sourceId: s.id, trackerName: 'X', title: 'Elle S01', size: 1, firstSeenAt: 1, lastSeenAt: 1, parsed, match: { score: 1, level: 'match', reasons: [] }, detailsUrl: 'https://t/1' }).returning().get();
  const base = { titleId: t.id, releaseId: r.id, season: 1, kind: 'pack' as const, size: 1, name: 'Elle S01', episodes: [{ season: 1, number: 3 }] };
  const files = [0, 1, 2].map((i) => ({ index: i, name: `E0${i + 1}.mkv`, size: 1, priority: i === 2 ? 1 : 0 }));
  const fresh = db.insert(downloads).values({ ...base, hash: 'new', state: 'downloading', progress: 0.5, files, addedAt: NOW - HOUR }).returning().get();
  db.insert(downloads).values({ ...base, hash: 'old', state: 'replaced', replacedById: fresh.id, note: 'Обновлена: +серия 3', addedAt: NOW - 50 * HOUR }).run();
  db.insert(downloads).values({ ...base, hash: 'older', state: 'replaced', note: 'Заменена: нет сидов', addedAt: NOW - 90 * HOUR }).run();
  const q = activityQueue(db, NOW);
  expect(q.map((x) => x.hash)).toEqual(['new', 'old']);
  expect(q[0].state).toBe('Пак · следим за обновлениями · Из пака: 1 файл из 3 · 50 %');
  expect(q[1]).toMatchObject({ state: 'Обновлена: +серия 3', tone: 'muted', canPause: false, canResume: false, canRemove: false });
});

test('кнопки управления проверяют состояние и qBittorrent', async () => {
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 7, kind: 'series', nameRu: 'Эль', nameOriginal: 'Elle', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  const fq = fakeQbit();
  const base = { titleId: t.id, season: 1, kind: 'episode' as const, size: 1, name: 'x', episodes: [], addedAt: 1 };
  const imp = db.insert(downloads).values({ ...base, hash: 'a', state: 'imported' }).returning().get();
  const dl = db.insert(downloads).values({ ...base, hash: 'b', state: 'downloading' }).returning().get();
  expect(await controlDownload(db, fq.qbit, imp.id, 'resume')).toEqual({ error: 'Эту загрузку нельзя продолжить' });
  expect(db.select().from(downloads).where(eq(downloads.id, imp.id)).get()!.state).toBe('imported');
  expect(await controlDownload(db, null, dl.id, 'pause')).toEqual({ error: 'qBittorrent не подключён' });
  expect(await controlDownload(db, fq.qbit, dl.id, 'pause')).toEqual({ ok: true });
  expect(db.select().from(downloads).where(eq(downloads.id, dl.id)).get()!.state).toBe('paused');
  expect(await controlDownload(db, fq.qbit, 999, 'pause')).toEqual({ error: 'Загрузка не найдена' });
});

test('идёт пересборка — «Пересборка…»', () => {
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 7, kind: 'series', nameRu: 'Эль', nameOriginal: 'Elle', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  db.insert(downloads).values({ hash: 'p', titleId: t.id, season: 1, kind: 'episode', episodes: [{ season: 1, number: 1 }], state: 'completed', processing: true, progress: 1, name: 'x', size: 1, addedAt: NOW }).run();
  expect(activityQueue(db, NOW)[0].state).toBe('Пересборка…');
});
