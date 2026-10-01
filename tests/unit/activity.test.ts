import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { activityQueue } from '@/lib/activity';
import { downloads, titles } from '@/lib/db/schema';

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
