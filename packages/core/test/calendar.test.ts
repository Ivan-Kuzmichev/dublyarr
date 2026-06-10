import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
  addFile,
  addTitle,
  listCalendar,
  listEpisodes,
  openDb,
  syncEpisodes,
} from "../src/db/index.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-cal-"));
const { db, sqlite } = openDb(join(dir, "c.db"));
afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const tv = addTitle(db, {
  tmdbId: 1,
  type: "tv",
  titleRu: "Сериал",
  titleOriginal: "Series",
  year: "2020",
  posterPath: null,
  overview: "",
  tmdbStatus: null,
  qualityPresetId: 1,
  voiceover: "Сыендук",
  monitorRule: "all",
});
syncEpisodes(
  db,
  tv.id,
  [
    { season: 1, episode: 1, airDate: "2024-03-01", name: "Пилот" },
    { season: 1, episode: 2, airDate: "2024-03-08", name: "" },
    { season: 1, episode: 3, airDate: "2024-09-01", name: "" },
    { season: 1, episode: 4, airDate: null, name: "" },
  ],
  "all",
  "2024-01-01",
);

describe("listCalendar", () => {
  test("серии трекаемого tv в диапазоне дат, отсортированы по airDate", () => {
    const rows = listCalendar(db, "2024-02-01", "2024-04-01");
    expect(rows.map((r) => `${r.season}x${r.episode}`)).toEqual(["1x1", "1x2"]);
    expect(rows[0]).toMatchObject({
      titleId: tv.id,
      titleRu: "Сериал",
      season: 1,
      episode: 1,
      nameRu: "Пилот",
      airDate: "2024-03-01",
      wanted: true,
      hasFile: false,
      voiceover: "Сыендук",
    });
  });

  test("hasFile=true когда у эпизода есть файл", () => {
    const ep = listEpisodes(db, tv.id).find((e) => e.episode === 1)!;
    addFile(db, {
      titleId: tv.id,
      episodeId: ep.id,
      path: "/lib/e1.mkv",
      size: 1,
      qualitySource: "WEB-DL",
      qualityResolution: "1080p",
      voiceoverStudio: "Сыендук",
      releaseGuid: null,
    });
    const row = listCalendar(db, "2024-02-01", "2024-04-01").find(
      (r) => r.episode === 1,
    )!;
    expect(row.hasFile).toBe(true);
  });

  test("нетрекаемый tv не попадает", () => {
    const tv2 = addTitle(db, {
      tmdbId: 2,
      type: "tv",
      titleRu: "Другой",
      titleOriginal: "Other",
      year: "2020",
      posterPath: null,
      overview: "",
      tmdbStatus: null,
      qualityPresetId: 1,
      voiceover: "any",
      monitorRule: "all",
    });
    syncEpisodes(
      db,
      tv2.id,
      [{ season: 1, episode: 1, airDate: "2024-03-15", name: "" }],
      "all",
      "2024-01-01",
    );
    sqlite
      .prepare(`UPDATE titles SET tracked = 0 WHERE id = ?`)
      .run(tv2.id);
    const rows = listCalendar(db, "2024-02-01", "2024-04-01");
    expect(rows.some((r) => r.titleId === tv2.id)).toBe(false);
  });
});
