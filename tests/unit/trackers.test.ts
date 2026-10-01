import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { addSource } from '@/lib/sources';
import { syncTrackers, setPrimary, trackersTable, kindFromCategories } from '@/lib/trackers';
import { trackers } from '@/lib/db/schema';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const indexers = [
  { id: 'rutracker', name: 'RuTracker.org', categories: [2000, 5000, 5070] },
  { id: 'kinozal', name: 'Kinozal', categories: [5000] },
  { id: 'anilibria', name: 'Anilibria', categories: [5070] },
];

test('тип контента по категориям', () => {
  expect(kindFromCategories([5000, 5070])).toBe('both');
  expect(kindFromCategories([5070])).toBe('anime');
  expect(kindFromCategories([5000, 5040])).toBe('series');
  expect(kindFromCategories([2000])).toBe('unknown');
});

test('трекер в двух источниках: основной у добавленного раньше; можно поменять', () => {
  const db = testDb();
  const a = addSource(db, { name: 'A', url: 'http://a/api', apiKey: 'k' });
  const b = addSource(db, { name: 'B', url: 'http://b/api', apiKey: 'k' });
  syncTrackers(db, a.id, indexers);
  syncTrackers(db, b.id, indexers.slice(0, 2));
  syncTrackers(db, a.id, indexers); // повторно — без дублей
  expect(db.select().from(trackers).all()).toHaveLength(5);
  const role = (src: number, ix: string) => db.select().from(trackers).all().find((t) => t.sourceId === src && t.indexerId === ix)!;
  expect(role(a.id, 'rutracker').role).toBe('primary');
  expect(role(b.id, 'rutracker').role).toBe('backup');
  setPrimary(db, role(b.id, 'rutracker').id);
  expect(role(b.id, 'rutracker').role).toBe('primary');
  expect(role(a.id, 'rutracker').role).toBe('backup');
  const table = trackersTable(db);
  expect(table.find((r) => r.indexerId === 'rutracker')).toMatchObject({ name: 'RuTracker.org', kind: 'both', primary: { sourceName: 'B' }, backups: [{ sourceName: 'A' }] });
  expect(table.find((r) => r.indexerId === 'anilibria')).toMatchObject({ kind: 'anime', backups: [] });
});
