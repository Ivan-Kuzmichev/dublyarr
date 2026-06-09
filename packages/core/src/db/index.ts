import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { migrations } from "./migrations.js";
import * as schema from "./schema.js";

export type Db = BetterSQLite3Database<typeof schema>;

function applyMigrations(sqlite: Database.Database): void {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY)`);
  const applied = new Set(
    (sqlite.prepare(`SELECT id FROM _migrations`).all() as { id: string }[]).map(
      (r) => r.id,
    ),
  );
  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    sqlite.transaction(() => {
      sqlite.exec(m.sql);
      sqlite.prepare(`INSERT INTO _migrations (id) VALUES (?)`).run(m.id);
    })();
  }
}

export function openDb(path: string): { db: Db; sqlite: Database.Database } {
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  applyMigrations(sqlite);
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

export * from "./schema.js";
export * from "./settings.js";
