import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test, vi } from "vitest";
import { addTitle, getDownload, openDb } from "../src/db/index.js";
import { grabRelease } from "../src/grab.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-grab-"));
const { db, sqlite } = openDb(join(dir, "grab.db"));

afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const title = addTitle(db, {
  tmdbId: 1, type: "tv", titleRu: "Т", titleOriginal: "T", year: "2020",
  posterPath: null, overview: "", tmdbStatus: null,
  qualityPresetId: 1, voiceover: "Сыендук", monitorRule: "all",
});

const input = {
  titleId: title.id,
  link: "magnet:?xt=urn:btih:abc",
  guid: "g-1",
  releaseTitle: "Show.S01.1080p",
  episodesCovered: [10, 11],
  voiceoverStudio: "Сыендук",
  qualitySource: "BluRay",
  qualityResolution: "1080p",
};

describe("grabRelease", () => {
  test("создаёт download, зовёт addTorrent с тегом, резолвит hash", async () => {
    const addTorrent = vi.fn().mockResolvedValue(undefined);
    const listTorrents = vi
      .fn()
      .mockResolvedValue([{ hash: "HASH1", progress: 0.1 }]);
    const qbt = { addTorrent, listTorrents } as never;

    const d = await grabRelease(db, qbt, input, { stagingDir: "/staging", waitMs: 0 });
    expect(d.qbitHash).toBe("HASH1");
    expect(d.status).toBe("downloading");
    expect(d.episodesCovered).toEqual([10, 11]);

    const addArg = addTorrent.mock.calls[0][0];
    expect(addArg.url).toBe(input.link);
    expect(addArg.category).toBe("dublyarr");
    expect(addArg.savePath).toBe("/staging");
    expect(addArg.tags).toBe(d.tag);
  });

  test("addTorrent падает → download failed, исключение проброшено", async () => {
    const qbt = {
      addTorrent: vi.fn().mockRejectedValue(new Error("qbt down")),
      listTorrents: vi.fn(),
    } as never;
    const err = await grabRelease(db, qbt, { ...input, guid: "g-2" }, { waitMs: 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    const all = sqlite.prepare(`SELECT * FROM downloads ORDER BY id DESC LIMIT 1`).get() as {
      status: string;
      error: string;
    };
    expect(all.status).toBe("failed");
    expect(all.error).toContain("qbt down");
  });

  test("hash не нашёлся за отведённые попытки → download остаётся queued", async () => {
    const qbt = {
      addTorrent: vi.fn().mockResolvedValue(undefined),
      listTorrents: vi.fn().mockResolvedValue([]),
    } as never;
    const d = await grabRelease(db, qbt, { ...input, guid: "g-3" }, { waitMs: 0, attempts: 2 });
    expect(d.status).toBe("queued");
    expect(d.qbitHash).toBeNull();
    expect(getDownload(db, d.id)?.status).toBe("queued");
  });
});
