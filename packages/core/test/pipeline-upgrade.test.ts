import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test, vi } from "vitest";
import {
  addFile,
  addTitle,
  createPreset,
  listHistory,
  openDb,
  syncEpisodes,
} from "../src/db/index.js";
import { parseRelease } from "../src/parser.js";
import type { JackettRelease } from "../src/jackett.js";
import { selectCandidates, runTitle } from "../src/pipeline.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-pipeup-"));
const { db, sqlite } = openDb(join(dir, "pu.db"));
afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const preset = createPreset(db, {
  name: "UpgFullHD",
  allowed: ["hdtv-1080p", "webdl-1080p", "bluray-1080p"],
  preferred: "bluray-1080p",
  upgradeEnabled: true,
});
const presetId = preset.ok ? preset.preset.id : 0;
const TODAY = "2024-01-01";

function rawRel(over: Partial<JackettRelease> & { title: string }): JackettRelease {
  return {
    title: over.title, description: over.description ?? "", indexer: "RuTracker",
    trackerType: "public", guid: over.guid ?? over.title, comments: "", pubDate: "",
    size: 1_000_000, seeders: over.seeders ?? 10, peers: 0, grabs: 0,
    link: over.link ?? `magnet:${over.title}`,
  };
}

describe("selectCandidates: апгрейд", () => {
  test("фильм с файлом ниже preferred при upgradeEnabled → upgrade-кандидат", () => {
    const movie = addTitle(db, {
      tmdbId: 10, type: "movie", titleRu: "Ф", titleOriginal: "Mv", year: "2020",
      posterPath: null, overview: "", tmdbStatus: null,
      qualityPresetId: presetId, voiceover: "any", monitorRule: "all",
    });
    addFile(db, {
      titleId: movie.id, episodeId: null, path: "/lib/mv.mkv", size: 1,
      qualitySource: "HDTV", qualityResolution: "1080p", voiceoverStudio: null, releaseGuid: null,
    });
    const c = selectCandidates(db, TODAY).find((x) => x.title.id === movie.id);
    expect(c?.reason).toBe("upgrade");
  });

  test("фильм уже на preferred → не кандидат", () => {
    const movie = addTitle(db, {
      tmdbId: 11, type: "movie", titleRu: "Ф2", titleOriginal: "Mv2", year: "2020",
      posterPath: null, overview: "", tmdbStatus: null,
      qualityPresetId: presetId, voiceover: "any", monitorRule: "all",
    });
    addFile(db, {
      titleId: movie.id, episodeId: null, path: "/lib/mv2.mkv", size: 1,
      qualitySource: "BluRay", qualityResolution: "1080p", voiceoverStudio: null, releaseGuid: null,
    });
    expect(selectCandidates(db, TODAY).some((x) => x.title.id === movie.id)).toBe(false);
  });

  test("upgrade выключён в пресете → не кандидат", () => {
    const noUpg = createPreset(db, {
      name: "NoUpg", allowed: ["hdtv-1080p", "bluray-1080p"], preferred: "bluray-1080p", upgradeEnabled: false,
    });
    const pid = noUpg.ok ? noUpg.preset.id : 0;
    const movie = addTitle(db, {
      tmdbId: 12, type: "movie", titleRu: "Ф3", titleOriginal: "Mv3", year: "2020",
      posterPath: null, overview: "", tmdbStatus: null,
      qualityPresetId: pid, voiceover: "any", monitorRule: "all",
    });
    addFile(db, {
      titleId: movie.id, episodeId: null, path: "/lib/mv3.mkv", size: 1,
      qualitySource: "HDTV", qualityResolution: "1080p", voiceoverStudio: null, releaseGuid: null,
    });
    expect(selectCandidates(db, TODAY).some((x) => x.title.id === movie.id)).toBe(false);
  });
});

describe("runTitle: апгрейд", () => {
  test("грабит раздачу лучше текущей; равные/худшие отфильтрованы", async () => {
    const movie = addTitle(db, {
      tmdbId: 20, type: "movie", titleRu: "Ап", titleOriginal: "Up", year: "2020",
      posterPath: null, overview: "", tmdbStatus: null,
      qualityPresetId: presetId, voiceover: "any", monitorRule: "all",
    });
    addFile(db, {
      titleId: movie.id, episodeId: null, path: "/lib/up.mkv", size: 1,
      qualitySource: "WEB-DL", qualityResolution: "1080p", voiceoverStudio: null, releaseGuid: null,
    });
    const cand = selectCandidates(db, TODAY).find((x) => x.title.id === movie.id)!;
    expect(cand.reason).toBe("upgrade");

    const search = vi.fn().mockResolvedValue([
      rawRel({ title: "Up 2020 1080p BluRay", description: "VO (Сыендук)", guid: "better", seeders: 30 }),
      rawRel({ title: "Up 2020 1080p WEB-DL", description: "VO (Сыендук)", guid: "same", seeders: 99 }),
    ].map(parseRelease));
    const grab = vi.fn().mockResolvedValue(undefined);
    await runTitle(db, cand, { search, grab, minSeeders: 1, now: new Date() });

    expect(grab).toHaveBeenCalledTimes(1);
    expect(grab.mock.calls[0][0].guid).toBe("better");
    expect(listHistory(db, 50, 0).some((h) => h.titleId === movie.id && h.kind === "search")).toBe(true);
  });
});
