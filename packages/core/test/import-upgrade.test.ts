import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
  addFile,
  addTitle,
  createDownload,
  getFile,
  listEpisodes,
  listFiles,
  openDb,
  syncEpisodes,
} from "../src/db/index.js";
import { importDownload } from "../src/import.js";
import { DEFAULT_NAMING_MOVIE, DEFAULT_NAMING_TV } from "../src/naming.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-upg-"));
const { db, sqlite } = openDb(join(dir, "upg.db"));
const libraryDir = join(dir, "library");
afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

function dl(titleId: number, source: string, resolution: string, guid: string) {
  return createDownload(db, {
    titleId,
    releaseGuid: guid,
    releaseTitle: "rel",
    episodesCovered: [],
    voiceoverStudio: "Сыендук",
    qualitySource: source,
    qualityResolution: resolution,
  });
}

describe("апгрейд сериала", () => {
  const tv = addTitle(db, {
    tmdbId: 1, type: "tv", titleRu: "Сериал", titleOriginal: "Series", year: "2020",
    posterPath: null, overview: "", tmdbStatus: null,
    qualityPresetId: 1, voiceover: "Сыендук", monitorRule: "all",
  });
  syncEpisodes(db, tv.id, [{ season: 1, episode: 1, airDate: "2020-01-01", name: "" }], "all", "2020-06-01");

  test("новый файл строго лучше → старый удалён, эпизод перепривязан, replaced=1", () => {
    const ep = listEpisodes(db, tv.id)[0];
    const oldDest = join(libraryDir, "old-s01e01.mkv");
    mkdirSync(libraryDir, { recursive: true });
    writeFileSync(oldDest, "old-low");
    const old = addFile(db, {
      titleId: tv.id, episodeId: ep.id, path: oldDest, size: 10,
      qualitySource: "HDTV", qualityResolution: "1080p", voiceoverStudio: "Сыендук", releaseGuid: "g-old",
    });
    expect(listEpisodes(db, tv.id)[0].fileId).toBe(old.id);

    const content = join(dir, "staging-up");
    mkdirSync(content, { recursive: true });
    writeFileSync(join(content, "Series.S01E01.1080p.BluRay.mkv"), "new-better");
    const d = dl(tv.id, "BluRay", "1080p", "g-new");

    const result = importDownload(db, d, tv, content, { libraryDir, template: DEFAULT_NAMING_TV });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.replaced).toBe(1);

    expect(existsSync(oldDest)).toBe(false);
    expect(getFile(db, old.id)).toBeNull();
    const files = listFiles(db, tv.id);
    expect(files).toHaveLength(1);
    expect(listEpisodes(db, tv.id)[0].fileId).toBe(files[0].id);
    expect(files[0].qualitySource).toBe("BluRay");
  });

  test("новый файл не лучше → пропуск, replaced=0, старый цел", () => {
    const ep = listEpisodes(db, tv.id)[0];
    const before = ep.fileId;
    const content = join(dir, "staging-same");
    mkdirSync(content, { recursive: true });
    writeFileSync(join(content, "Series.S01E01.1080p.HDTV.mkv"), "same-low");
    const d = dl(tv.id, "HDTV", "1080p", "g-same");
    const result = importDownload(db, d, tv, content, { libraryDir, template: DEFAULT_NAMING_TV });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.replaced).toBe(0);
    expect(listEpisodes(db, tv.id)[0].fileId).toBe(before);
    expect(listFiles(db, tv.id)).toHaveLength(1);
  });
});

describe("апгрейд фильма", () => {
  const movie = addTitle(db, {
    tmdbId: 2, type: "movie", titleRu: "Фильм", titleOriginal: "Movie", year: "2020",
    posterPath: null, overview: "", tmdbStatus: null,
    qualityPresetId: 2, voiceover: "any", monitorRule: "all",
  });

  test("замена фильма на лучшее качество", () => {
    const oldDest = join(libraryDir, "movie-old.mkv");
    writeFileSync(oldDest, "m-old");
    const old = addFile(db, {
      titleId: movie.id, episodeId: null, path: oldDest, size: 5,
      qualitySource: "WEB-DL", qualityResolution: "1080p", voiceoverStudio: "HDrezka", releaseGuid: "m-old",
    });
    const content = join(dir, "staging-movie");
    mkdirSync(content, { recursive: true });
    writeFileSync(join(content, "Movie.2020.2160p.BDRemux.mkv"), "m-new-better-big");
    const d = dl(movie.id, "BDRemux", "2160p", "m-new");

    const result = importDownload(db, d, movie, content, { libraryDir, template: DEFAULT_NAMING_MOVIE });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.replaced).toBe(1);
    expect(existsSync(oldDest)).toBe(false);
    expect(getFile(db, old.id)).toBeNull();
    expect(listFiles(db, movie.id)).toHaveLength(1);
    expect(listFiles(db, movie.id)[0].qualityResolution).toBe("2160p");
  });

  test("фильм: новый не лучше → пропуск без дубля", () => {
    const content = join(dir, "staging-movie2");
    mkdirSync(content, { recursive: true });
    writeFileSync(join(content, "Movie.2020.1080p.WEB-DL.mkv"), "m-same");
    const d = dl(movie.id, "WEB-DL", "1080p", "m-same2");
    const result = importDownload(db, d, movie, content, { libraryDir, template: DEFAULT_NAMING_MOVIE });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.replaced).toBe(0);
    expect(listFiles(db, movie.id)).toHaveLength(1);
    expect(listFiles(db, movie.id)[0].qualityResolution).toBe("2160p");
  });
});
