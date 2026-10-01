import { expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { jackettEndpoint, jackettBase, endpointFor } from '@/lib/source-kinds';
import { testDb } from './helpers';
import { sources } from '@/lib/db/schema';

test('адрес Jackett: база, со слэшем, полный путь — один и тот же endpoint', () => {
  const e = 'http://192.168.1.10:9117/api/v2.0/indexers/all/results/torznab/api';
  for (const u of ['http://192.168.1.10:9117', 'http://192.168.1.10:9117/', 'http://192.168.1.10:9117/api/v2.0/indexers/all/results/torznab/', 'http://192.168.1.10:9117/api/v2.0/indexers/all/results/torznab/api'])
    expect(jackettEndpoint(u)).toBe(e);
  expect(jackettBase('http://j:9117/api/v2.0/indexers/all/results/torznab/')).toBe('http://j:9117');
  expect(jackettBase('http://prowlarr:9696/1/api')).toBeNull();
  expect(endpointFor({ kind: 'torznab', url: 'http://prowlarr:9696/1/api' })).toBe('http://prowlarr:9696/1/api');
});

test('адрес одного трекера Jackett сохраняет трекер', () => {
  expect(jackettEndpoint('http://j:9117/api/v2.0/indexers/rutracker/results/torznab/')).toBe('http://j:9117/api/v2.0/indexers/rutracker/results/torznab/api');
  expect(jackettBase('http://j:9117/api/v2.0/indexers/rutracker/results/torznab/')).toBeNull();
});

test('миграция: старые источники Jackett (все трекеры) → тип jackett и адрес без пути; остальные — torznab', () => {
  const db = testDb();
  const file = readdirSync('drizzle').find((f) => f.startsWith('0019_'))!;
  const update = readFileSync(`drizzle/${file}`, 'utf8').split('--> statement-breakpoint').find((s) => s.includes('UPDATE'))!;
  db.insert(sources).values([
    { name: 'J', url: 'http://j:9117/api/v2.0/indexers/all/results/torznab/', createdAt: 1, kind: 'torznab' },
    { name: 'R', url: 'http://j:9117/api/v2.0/indexers/rutracker/results/torznab/', createdAt: 1, kind: 'torznab' },
    { name: 'P', url: 'http://prowlarr:9696/1/api', createdAt: 1, kind: 'torznab' },
  ]).run();
  db.$client.exec(update);
  expect(db.select({ kind: sources.kind, url: sources.url }).from(sources).all()).toEqual([
    { kind: 'jackett', url: 'http://j:9117' },
    { kind: 'torznab', url: 'http://j:9117/api/v2.0/indexers/rutracker/results/torznab/' },
    { kind: 'torznab', url: 'http://prowlarr:9696/1/api' },
  ]);
});
