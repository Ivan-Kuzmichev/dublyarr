import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test, vi } from "vitest";
import {
  addTitle,
  createDownload,
  getDownload,
  openDb,
} from "../src/db/index.js";
import { pollAll } from "../src/poll.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-pollall-"));
const { db, sqlite } = openDb(join(dir, "pa.db"));
afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const t1 = addTitle(db, {
  tmdbId: 1, type: "movie", titleRu: "A", titleOriginal: "A", year: "2020",
  posterPath: null, overview: "", tmdbStatus: null, qualityPresetId: 1, voiceover: "any", monitorRule: "all",
});
const t2 = addTitle(db, {
  tmdbId: 2, type: "movie", titleRu: "B", titleOriginal: "B", year: "2020",
  posterPath: null, overview: "", tmdbStatus: null, qualityPresetId: 1, voiceover: "any", monitorRule: "all",
});

test("pollAll продвигает queued→downloading по всем тайтлам", async () => {
  const d1 = createDownload(db, { titleId: t1.id, releaseGuid: "g1", releaseTitle: "g1", episodesCovered: [], voiceoverStudio: null, qualitySource: null, qualityResolution: null });
  const d2 = createDownload(db, { titleId: t2.id, releaseGuid: "g2", releaseTitle: "g2", episodesCovered: [], voiceoverStudio: null, qualitySource: null, qualityResolution: null });
  const qbt = {
    listTorrents: vi.fn(async ({ tag }: { tag: string }) => [
      { hash: `H-${tag}`, state: "downloading", progress: 0.2, contentPath: "" },
    ]),
  } as never;

  const { active, qbtError } = await pollAll(db, qbt, { now: new Date("2030-01-01T00:00:00Z") });
  expect(qbtError).toBeNull();
  expect(getDownload(db, d1.id)?.status).toBe("downloading");
  expect(getDownload(db, d2.id)?.status).toBe("downloading");
  expect(active.map((d) => d.id).sort()).toEqual([d1.id, d2.id].sort());
});
