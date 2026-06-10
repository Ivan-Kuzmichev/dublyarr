import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  addFile,
  addTitle,
  deleteFileRecord,
  listEpisodes,
  listFiles,
  openDb,
  syncEpisodes,
  titleFileStats,
} from "../src/db/index.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-files-"));
const { db } = openDb(join(dir, "files.db"));

const title = addTitle(db, {
  tmdbId: 60625,
  type: "tv",
  titleRu: "Рик и Морти",
  titleOriginal: "Rick and Morty",
  year: "2013",
  posterPath: null,
  overview: "",
  tmdbStatus: null,
  qualityPresetId: 1,
  voiceover: "Сыендук",
  monitorRule: "all",
});
syncEpisodes(
  db,
  title.id,
  [
    { season: 1, episode: 1, airDate: "2013-12-02", name: "Пилот" },
    { season: 1, episode: 2, airDate: "2013-12-09", name: "" },
  ],
  "all",
);

describe("files", () => {
  test("addFile с episodeId проставляет episodes.file_id", () => {
    const ep = listEpisodes(db, title.id)[0];
    const f = addFile(db, {
      titleId: title.id,
      episodeId: ep.id,
      path: "/lib/Rick/Season 01/e1.mkv",
      size: 1000,
      qualitySource: "WEB-DL",
      qualityResolution: "1080p",
      voiceoverStudio: "Сыендук",
      releaseGuid: "guid-1",
    });
    expect(f.id).toBeGreaterThan(0);
    expect(listEpisodes(db, title.id)[0].fileId).toBe(f.id);
  });

  test("listFiles отдаёт файлы тайтла", () => {
    const rows = listFiles(db, title.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe("/lib/Rick/Season 01/e1.mkv");
  });

  test("titleFileStats: файлы и недостающие wanted", () => {
    const stats = titleFileStats(db);
    expect(stats.get(title.id)).toEqual({ files: 1, missingWanted: 1 });
  });

  test("deleteFileRecord возвращает строку и чистит file_id", () => {
    const f = listFiles(db, title.id)[0];
    const removed = deleteFileRecord(db, f.id);
    expect(removed?.path).toBe("/lib/Rick/Season 01/e1.mkv");
    expect(listFiles(db, title.id)).toHaveLength(0);
    expect(listEpisodes(db, title.id)[0].fileId).toBeNull();
  });

  test("deleteFileRecord по несуществующему id → null", () => {
    expect(deleteFileRecord(db, 9999)).toBeNull();
  });
});
