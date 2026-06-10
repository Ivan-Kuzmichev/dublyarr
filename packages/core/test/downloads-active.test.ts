import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
  addTitle,
  countActiveDownloads,
  createDownload,
  listActiveDownloads,
  openDb,
  updateDownload,
} from "../src/db/index.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-active-"));
const { db, sqlite } = openDb(join(dir, "a.db"));
afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const t = addTitle(db, {
  tmdbId: 1, type: "movie", titleRu: "Ф", titleOriginal: "F", year: "2020",
  posterPath: null, overview: "", tmdbStatus: null,
  qualityPresetId: 1, voiceover: "any", monitorRule: "all",
});
function mk(guid: string) {
  return createDownload(db, {
    titleId: t.id, releaseGuid: guid, releaseTitle: guid, episodesCovered: [],
    voiceoverStudio: null, qualitySource: null, qualityResolution: null,
  });
}

describe("active downloads", () => {
  test("активные = queued/downloading/completed; imported/failed исключены", () => {
    const a = mk("a");
    const b = mk("b"); updateDownload(db, b.id, { status: "downloading" });
    const c = mk("c"); updateDownload(db, c.id, { status: "imported" });
    const d = mk("d"); updateDownload(db, d.id, { status: "failed" });

    const active = listActiveDownloads(db);
    const guids = active.map((x) => x.releaseGuid).sort();
    expect(guids).toEqual(["a", "b"]);
    expect(countActiveDownloads(db)).toBe(2);
  });

  test("новые сверху", () => {
    const rows = listActiveDownloads(db);
    expect(rows[0].id).toBeGreaterThan(rows[rows.length - 1].id);
  });
});
