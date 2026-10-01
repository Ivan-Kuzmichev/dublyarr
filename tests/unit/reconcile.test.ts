import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { fakeQbit } from './fake-qbit';
import { reconcile } from '@/lib/reconcile';
import { downloads, titles } from '@/lib/db/schema';

test('сверка: остановлен в клиенте, нет в клиенте, все файлы выключены, всё хорошо', async () => {
  const db = testDb();
  const fq = fakeQbit();
  const t = db.insert(titles).values({ tmdbId: 7, kind: 'series', nameRu: 'Эль', nameOriginal: 'Elle', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  const add = (hash: string, kind: 'episode' | 'pack') =>
    db.insert(downloads).values({ hash, titleId: t.id, season: 1, kind, episodes: [{ season: 1, number: 1 }], state: 'downloading', name: hash, size: 1, addedAt: 1 }).run();
  const torrent = (hash: string, state: string, prios: number[]) =>
    fq.torrents.set(hash, { hash, name: hash, state, progress: 0.2, dlspeed: 0, eta: 0, size: 1, num_seeds: 1, save_path: '/d', content_path: '/d', category: 'dublyarr', paused: false, files: prios.map((p, i) => ({ index: i, name: `${i}.mkv`, size: 1, progress: 0, priority: p })) });
  add('a', 'episode');
  torrent('a', 'stoppedDL', [1]);
  add('b', 'episode');
  add('c', 'pack');
  torrent('c', 'downloading', [0, 0]);
  add('d', 'pack');
  torrent('d', 'downloading', [0, 1]);
  const rows = await reconcile(db, fq.qbit);
  expect(rows.map((r) => [r.name, r.problem, r.qbitState, `${r.filesOn}/${r.filesTotal}`])).toEqual([
    ['a', 'stopped', 'stoppedDL', '1/1'],
    ['b', 'missing', null, '0/0'],
    ['c', 'files-off', 'downloading', '0/2'],
    ['d', null, 'downloading', '1/2'],
  ]);
  expect(rows[0]).toMatchObject({ title: 'Эль', state: 'downloading' });
});
