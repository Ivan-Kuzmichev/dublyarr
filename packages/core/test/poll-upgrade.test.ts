import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test, vi } from "vitest";
import {
  addFile,
  addTitle,
  createDownload,
  listEpisodes,
  listHistory,
  openDb,
  setSetting,
  syncEpisodes,
  updateDownload,
} from "../src/db/index.js";
import { refreshDownload } from "../src/poll.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-pollup-"));
const { db, sqlite } = openDb(join(dir, "pu.db"));
const lib = join(dir, "lib");
afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

setSetting(db, "library_tv", lib);

const tv = addTitle(db, {
  tmdbId: 1, type: "tv", titleRu: "С", titleOriginal: "Series", year: "2020",
  posterPath: null, overview: "", tmdbStatus: null,
  qualityPresetId: 1, voiceover: "Сыендук", monitorRule: "all",
});
syncEpisodes(db, tv.id, [{ season: 1, episode: 1, airDate: "2020-01-01", name: "" }], "all", "2020-06-01");

test("замена файла при импорте → history kind=upgrade", async () => {
  const ep = listEpisodes(db, tv.id)[0];
  mkdirSync(lib, { recursive: true });
  const oldPath = join(lib, "old.mkv");
  writeFileSync(oldPath, "x");
  addFile(db, {
    titleId: tv.id, episodeId: ep.id, path: oldPath, size: 1,
    qualitySource: "HDTV", qualityResolution: "1080p", voiceoverStudio: "Сыендук", releaseGuid: "old",
  });

  const content = join(dir, "content");
  mkdirSync(content, { recursive: true });
  writeFileSync(join(content, "Series.S01E01.1080p.BluRay.mkv"), "better");

  const d = createDownload(db, {
    titleId: tv.id, releaseGuid: "new", releaseTitle: "Series S01E01 BluRay",
    episodesCovered: [ep.id], voiceoverStudio: "Сыендук",
    qualitySource: "BluRay", qualityResolution: "1080p",
  });
  updateDownload(db, d.id, { status: "completed", qbitHash: "H", progress: 1 });

  const qbt = {
    listTorrents: vi.fn().mockResolvedValue([
      { hash: "H", state: "uploading", progress: 1, contentPath: content },
    ]),
  } as never;

  await refreshDownload(db, qbt, { ...d, status: "completed", qbitHash: "H", progress: 1 });

  const kinds = listHistory(db, 20, 0).filter((h) => h.titleId === tv.id).map((h) => h.kind);
  expect(kinds).toContain("upgrade");
  expect(existsSync(oldPath)).toBe(false);
});
