import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
  addTitle,
  blacklistRelease,
  isBlacklisted,
  listBlacklist,
  openDb,
} from "../src/db/index.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-blacklist-"));
const { db, sqlite } = openDb(join(dir, "blacklist.db"));

afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const title = addTitle(db, {
  tmdbId: 1,
  type: "tv",
  titleRu: "Т",
  titleOriginal: "T",
  year: "2020",
  posterPath: null,
  overview: "",
  tmdbStatus: null,
  qualityPresetId: 1,
  voiceover: "any",
  monitorRule: "all",
});

describe("blacklist", () => {
  test("blacklistRelease + isBlacklisted", () => {
    expect(isBlacklisted(db, title.id, "guid-1")).toBe(false);
    blacklistRelease(db, title.id, "guid-1", "завис");
    expect(isBlacklisted(db, title.id, "guid-1")).toBe(true);
    expect(isBlacklisted(db, title.id, "guid-2")).toBe(false);
  });

  test("повторный blacklistRelease идемпотентен (UNIQUE не падает)", () => {
    expect(() => blacklistRelease(db, title.id, "guid-1", "снова")).not.toThrow();
    expect(listBlacklist(db, title.id)).toHaveLength(1);
  });

  test("listBlacklist по тайтлу", () => {
    blacklistRelease(db, title.id, "guid-3", "битая");
    const rows = listBlacklist(db, title.id);
    expect(rows.map((r) => r.releaseGuid).sort()).toEqual(["guid-1", "guid-3"]);
  });
});
