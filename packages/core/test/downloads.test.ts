import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
  addTitle,
  createDownload,
  deleteDownload,
  getDownload,
  listDownloadsForTitle,
  openDb,
  updateDownload,
} from "../src/db/index.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-downloads-"));
const { db, sqlite } = openDb(join(dir, "downloads.db"));

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

describe("downloads", () => {
  test("createDownload: уникальный tag с префиксом, JSON-поля парсятся", () => {
    const d = createDownload(db, {
      titleId: title.id,
      releaseGuid: "guid-1",
      releaseTitle: "Rick.and.Morty.S01.WEB-DL",
      episodesCovered: [1, 2, 3],
      voiceoverStudio: "Сыендук",
      qualitySource: "WEB-DL",
      qualityResolution: "1080p",
    });
    expect(d.tag).toMatch(/^dublyarr-/);
    expect(d.status).toBe("queued");
    expect(d.progress).toBe(0);
    expect(d.qbitHash).toBeNull();
    expect(d.episodesCovered).toEqual([1, 2, 3]);
  });

  test("updateDownload: статус, прогресс, hash", () => {
    const d = listDownloadsForTitle(db, title.id)[0];
    const up = updateDownload(db, d.id, {
      qbitHash: "deadbeef",
      status: "downloading",
      progress: 0.5,
    });
    expect(up).toMatchObject({ qbitHash: "deadbeef", status: "downloading", progress: 0.5 });
  });

  test("пустой patch возвращает текущую строку", () => {
    const d = listDownloadsForTitle(db, title.id)[0];
    expect(updateDownload(db, d.id, {})).toMatchObject({ id: d.id, status: "downloading" });
  });

  test("listDownloadsForTitle — новые сверху", () => {
    createDownload(db, {
      titleId: title.id,
      releaseGuid: "guid-2",
      releaseTitle: "второй",
      episodesCovered: [],
      voiceoverStudio: null,
      qualitySource: null,
      qualityResolution: null,
    });
    const rows = listDownloadsForTitle(db, title.id);
    expect(rows).toHaveLength(2);
    expect(rows[0].releaseGuid).toBe("guid-2");
  });

  test("deleteDownload удаляет, getDownload → null", () => {
    const rows = listDownloadsForTitle(db, title.id);
    deleteDownload(db, rows[0].id);
    expect(getDownload(db, rows[0].id)).toBeNull();
    expect(listDownloadsForTitle(db, title.id)).toHaveLength(1);
  });
});
