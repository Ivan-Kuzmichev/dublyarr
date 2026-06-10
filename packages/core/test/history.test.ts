import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
  addHistory,
  addTitle,
  listHistory,
  openDb,
  recentSearchAt,
} from "../src/db/index.js";
import { listPresets } from "../src/db/presets.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-history-"));
const { db, sqlite } = openDb(join(dir, "history.db"));
const presetId = listPresets(db)[0].id;

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
  qualityPresetId: presetId,
  voiceover: "any",
  monitorRule: "all",
});

describe("history", () => {
  test("addHistory + listHistory: новые сверху", () => {
    addHistory(db, { titleId: title.id, kind: "search", message: "ищу" });
    addHistory(db, { titleId: title.id, kind: "grab", message: "качаю" });
    const rows = listHistory(db, 10, 0);
    expect(rows).toHaveLength(2);
    expect(rows[0].kind).toBe("grab");
    expect(rows[0].titleId).toBe(title.id);
  });

  test("listHistory пагинация через limit/offset", () => {
    const page = listHistory(db, 1, 1);
    expect(page).toHaveLength(1);
    expect(page[0].kind).toBe("search");
  });

  test("recentSearchAt: ISO-время последнего search или null", () => {
    addHistory(db, {
      titleId: title.id,
      kind: "search",
      message: "явное время",
      createdAt: "2030-01-01T00:00:00Z",
    });
    expect(recentSearchAt(db, title.id)).toBe("2030-01-01T00:00:00Z");
    addHistory(db, { titleId: null, kind: "search", message: "без тайтла" });
    expect(recentSearchAt(db, 12345)).toBeNull();
  });
});
