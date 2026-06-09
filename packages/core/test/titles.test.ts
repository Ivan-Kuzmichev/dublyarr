import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { openDb } from "../src/db/index.js";
import { listPresets } from "../src/db/presets.js";
import {
  addTitle,
  deleteTitle,
  getTitle,
  getTitleByTmdb,
  listEpisodes,
  listTrackedTitles,
  listTrackedTmdbKeys,
  setEpisodesWanted,
  setSeasonWanted,
  syncEpisodes,
  updateTitle,
} from "../src/db/titles.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-titles-"));
const { db, sqlite } = openDb(join(dir, "test.db"));
const presetId = listPresets(db)[0].id;

afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const rick = {
  tmdbId: 60625,
  type: "tv" as const,
  titleRu: "Рик и Морти",
  titleOriginal: "Rick and Morty",
  year: "2013",
  posterPath: "/poster.jpg",
  overview: "Учёный Рик...",
  tmdbStatus: "Returning Series",
  qualityPresetId: presetId,
  voiceover: "Сыендук",
  monitorRule: "all" as const,
};

describe("addTitle / get / list", () => {
  test("добавляет и находит тайтл", () => {
    const t = addTitle(db, rick);
    expect(t.id).toBeGreaterThan(0);
    expect(getTitle(db, t.id)?.titleRu).toBe("Рик и Морти");
    expect(getTitleByTmdb(db, "tv", 60625)?.id).toBe(t.id);
    expect(getTitleByTmdb(db, "movie", 60625)).toBeNull();
    expect(listTrackedTitles(db).map((x) => x.tmdbId)).toEqual([60625]);
    expect(listTrackedTmdbKeys(db)).toEqual(new Set(["tv:60625"]));
  });

  test("дубль (tmdb_id, type) бросает", () => {
    expect(() => addTitle(db, rick)).toThrow();
  });
});

describe("syncEpisodes", () => {
  const titleId = () => getTitleByTmdb(db, "tv", 60625)!.id;
  const eps = [
    { season: 1, episode: 1, airDate: "2013-12-02", name: "Пилот" },
    { season: 1, episode: 2, airDate: "2013-12-09", name: "Пёс-газонокосильщик" },
    { season: 2, episode: 1, airDate: "2099-01-01", name: "Будущая серия" },
    { season: 2, episode: 2, airDate: null, name: "Без даты" },
  ];

  test("monitor_rule=all → все wanted", () => {
    syncEpisodes(db, titleId(), eps, "all", "2026-06-09");
    const rows = listEpisodes(db, titleId());
    expect(rows).toHaveLength(4);
    expect(rows.every((e) => e.wanted)).toBe(true);
  });

  test("повторный синк не трогает ручные wanted, обновляет метаданные", () => {
    const first = listEpisodes(db, titleId())[0];
    setEpisodesWanted(db, titleId(), [first.id], false);
    syncEpisodes(
      db,
      titleId(),
      [{ season: 1, episode: 1, airDate: "2013-12-02", name: "Пилот (обновлено)" }],
      "all",
      "2026-06-09",
    );
    const rows = listEpisodes(db, titleId());
    const e11 = rows.find((e) => e.season === 1 && e.episode === 1)!;
    expect(e11.wanted).toBe(false);
    expect(e11.nameRu).toBe("Пилот (обновлено)");
    expect(rows).toHaveLength(4);
  });

  test("monitor_rule=future_only → wanted только будущие и без даты", () => {
    const t = addTitle(db, { ...rick, tmdbId: 1399, titleRu: "Игра престолов", titleOriginal: "Game of Thrones", monitorRule: "future_only" });
    syncEpisodes(db, t.id, eps, "future_only", "2026-06-09");
    const bySeason = listEpisodes(db, t.id);
    expect(bySeason.find((e) => e.season === 1 && e.episode === 1)!.wanted).toBe(false);
    expect(bySeason.find((e) => e.season === 2 && e.episode === 1)!.wanted).toBe(true);
    expect(bySeason.find((e) => e.season === 2 && e.episode === 2)!.wanted).toBe(true);
  });

  test("monitor_rule=manual → ничего не wanted", () => {
    const t = addTitle(db, { ...rick, tmdbId: 456, titleRu: "Симпсоны", titleOriginal: "The Simpsons", monitorRule: "manual" });
    syncEpisodes(db, t.id, eps, "manual", "2026-06-09");
    expect(listEpisodes(db, t.id).some((e) => e.wanted)).toBe(false);
  });
});

describe("setSeasonWanted / updateTitle / deleteTitle", () => {
  test("сезон целиком", () => {
    const id = getTitleByTmdb(db, "tv", 456)!.id;
    setSeasonWanted(db, id, 1, true);
    const rows = listEpisodes(db, id);
    expect(rows.filter((e) => e.season === 1).every((e) => e.wanted)).toBe(true);
    expect(rows.filter((e) => e.season === 2).some((e) => e.wanted)).toBe(false);
  });

  test("updateTitle меняет озвучку/правило", () => {
    const id = getTitleByTmdb(db, "tv", 60625)!.id;
    const t = updateTitle(db, id, { voiceover: "any", monitorRule: "manual" });
    expect(t?.voiceover).toBe("any");
    expect(t?.monitorRule).toBe("manual");
  });

  test("deleteTitle каскадно удаляет эпизоды", () => {
    const id = getTitleByTmdb(db, "tv", 456)!.id;
    deleteTitle(db, id);
    expect(getTitle(db, id)).toBeNull();
    const n = sqlite
      .prepare(`SELECT count(*) AS n FROM episodes WHERE title_id = ?`)
      .get(id) as { n: number };
    expect(n.n).toBe(0);
  });
});
