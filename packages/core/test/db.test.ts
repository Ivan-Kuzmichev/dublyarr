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
