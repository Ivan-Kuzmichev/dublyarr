import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { openDb } from "../src/db/index.js";
import { getAllSettings, getSetting, setSetting } from "../src/db/settings.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-test-"));
const { db, sqlite } = openDb(join(dir, "test.db"));

afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("openDb", () => {
  test("включает WAL и применяет миграции", () => {
    expect(sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(getSetting(db, "tmdb_api_key")).toBeNull();
  });
});

describe("settings", () => {
  test("set/get/overwrite", () => {
    setSetting(db, "tmdb_api_key", "abc");
    expect(getSetting(db, "tmdb_api_key")).toBe("abc");
    setSetting(db, "tmdb_api_key", "xyz");
    expect(getSetting(db, "tmdb_api_key")).toBe("xyz");
  });

  test("getAllSettings возвращает все известные ключи", () => {
    const all = getAllSettings(db);
    expect(all.tmdb_api_key).toBe("xyz");
    expect(all.jackett_url).toBeNull();
  });
});

describe("миграция 0001_tracking", () => {
  test("foreign_keys включён", () => {
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  test("таблицы созданы, пресеты засеяны", () => {
    const names = (
      sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
        .all() as { name: string }[]
    ).map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining(["quality_presets", "titles", "episodes"]),
    );
    const presets = sqlite
      .prepare(`SELECT name FROM quality_presets ORDER BY id`)
      .all() as { name: string }[];
    expect(presets.map((p) => p.name)).toEqual(["FullHD", "4K"]);
  });

  test("повторное открытие БД идемпотентно", () => {
    const second = openDb(join(dir, "test.db"));
    const presets = second.sqlite
      .prepare(`SELECT count(*) AS n FROM quality_presets`)
      .get() as { n: number };
    expect(presets.n).toBe(2);
    second.sqlite.close();
  });
});

describe("миграция 0002: files и downloads", () => {
  const m2bDir = mkdtempSync(join(tmpdir(), "dublyarr-m2b-"));
  const { sqlite: m2bSqlite } = openDb(join(m2bDir, "m2b.db"));

  afterAll(() => {
    m2bSqlite.close();
    rmSync(m2bDir, { recursive: true, force: true });
  });

  test("таблицы созданы", () => {
    const names = (
      m2bSqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('files','downloads')`)
        .all() as { name: string }[]
    ).map((r) => r.name);
    expect(names.sort()).toEqual(["downloads", "files"]);
  });

  test("удаление тайтла каскадит downloads и files", () => {
    m2bSqlite
      .prepare(
        `INSERT INTO titles (tmdb_id, type, title_ru, title_original, quality_preset_id)
         VALUES (1, 'movie', 'Тест', 'Test', 1)`,
      )
      .run();
    const titleId = m2bSqlite.prepare(`SELECT id FROM titles WHERE tmdb_id = 1`).get() as { id: number };
    m2bSqlite
      .prepare(`INSERT INTO downloads (title_id, tag) VALUES (?, 'dublyarr-x')`)
      .run(titleId.id);
    m2bSqlite
      .prepare(`INSERT INTO files (title_id, path) VALUES (?, '/lib/a.mkv')`)
      .run(titleId.id);
    m2bSqlite.prepare(`DELETE FROM titles WHERE id = ?`).run(titleId.id);
    expect(m2bSqlite.prepare(`SELECT count(*) AS c FROM downloads`).get()).toEqual({ c: 0 });
    expect(m2bSqlite.prepare(`SELECT count(*) AS c FROM files`).get()).toEqual({ c: 0 });
  });

  test("downloads.status ограничен CHECK", () => {
    m2bSqlite
      .prepare(
        `INSERT INTO titles (tmdb_id, type, title_ru, title_original, quality_preset_id)
         VALUES (2, 'movie', 'Т2', 'T2', 1)`,
      )
      .run();
    const t = m2bSqlite.prepare(`SELECT id FROM titles WHERE tmdb_id = 2`).get() as { id: number };
    expect(() =>
      m2bSqlite
        .prepare(`INSERT INTO downloads (title_id, tag, status) VALUES (?, 'dublyarr-y', 'bogus')`)
        .run(t.id),
    ).toThrow();
  });
});
