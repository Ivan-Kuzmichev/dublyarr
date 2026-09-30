import { expect, test } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb, migrateDb } from '@/lib/db/client';
import { users } from '@/lib/db/schema';

test('миграции создают таблицы, файл в WAL', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'dy-')), 'db.sqlite');
  const db = openDb(file);
  migrateDb(db);
  migrateDb(db); // идемпотентно
  db.insert(users).values({ username: 'a', passwordHash: 'h', createdAt: 1, updatedAt: 1 }).run();
  expect(db.select().from(users).all()).toHaveLength(1);
  expect(db.$client.pragma('journal_mode', { simple: true })).toBe('wal');
});
