import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import * as schema from './schema';
import { getConfig } from '../config';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  return drizzle(sqlite, { schema }) as Db;
}

export function migrateDb(db: Db): void {
  const folder = process.env.DUBLYARR_MIGRATIONS ?? path.join(process.cwd(), 'drizzle');
  migrate(db, { migrationsFolder: folder });
}

const g = globalThis as unknown as { __dublyarrDb?: Db };
export function getDb(): Db {
  return (g.__dublyarrDb ??= openDb(getConfig().dbPath));
}
