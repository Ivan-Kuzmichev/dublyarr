import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, test, vi } from "vitest";
import { addTitle, getDownload, openDb } from "../src/db/index.js";
import { grabRelease } from "../src/grab.js";
import { QbtError } from "../src/qbittorrent.js";

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

  test("season-пак: качаем только нужные серии, остальным priority=0", async () => {
    const files = [
      { index: 0, name: "Show/Show.S01E08.mkv", size: 1, progress: 0 },
      { index: 1, name: "Show/Show.S01E09.mkv", size: 1, progress: 0 },
      { index: 2, name: "Show/Show.S01E10.mkv", size: 1, progress: 0 },
    ];
    const setFilePriority = vi.fn().mockResolvedValue(undefined);
    const qbt = {
      addTorrent: vi.fn().mockResolvedValue(undefined),
      listTorrents: vi.fn().mockResolvedValue([{ hash: "PACK", progress: 0 }]),
      listFiles: vi.fn().mockResolvedValue(files),
      setFilePriority,
    } as never;

    await grabRelease(
      db,
      qbt,
      { ...input, guid: "g-pack", wantedEpisodes: [{ season: 1, episode: 10 }] },
      { waitMs: 0 },
    );
    expect(setFilePriority).toHaveBeenCalledTimes(1);
    expect(setFilePriority).toHaveBeenCalledWith("PACK", [0, 1], 0);
  });

  test("нужны все серии раздачи → priority не трогаем", async () => {
    const files = [{ index: 0, name: "Show.S01E10.mkv", size: 1, progress: 0 }];
    const setFilePriority = vi.fn().mockResolvedValue(undefined);
    const qbt = {
      addTorrent: vi.fn().mockResolvedValue(undefined),
      listTorrents: vi.fn().mockResolvedValue([{ hash: "ONE", progress: 0 }]),
      listFiles: vi.fn().mockResolvedValue(files),
      setFilePriority,
    } as never;

    await grabRelease(
      db,
      qbt,
      { ...input, guid: "g-one", wantedEpisodes: [{ season: 1, episode: 10 }] },
      { waitMs: 0 },
    );
    expect(setFilePriority).not.toHaveBeenCalled();
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

describe("grabRelease: http-ссылка — скачиваем .torrent сами", () => {
  afterEach(() => vi.unstubAllGlobals());

  const httpInput = { ...input, link: "http://jackett.local/dl/rutracker/?path=abc" };
  const bencode = Buffer.from("d8:announce3:url4:infod4:name4:teste e");

  test("torrent-файл скачан и отдан qbt файлом (addTorrentFile)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(bencode, { status: 200, headers: { "content-type": "application/x-bittorrent" } }),
      ),
    );
    const addTorrentFile = vi.fn().mockResolvedValue(undefined);
    const addTorrent = vi.fn();
    const listTorrents = vi.fn().mockResolvedValue([{ hash: "H", progress: 0 }]);
    const qbt = { addTorrent, addTorrentFile, listTorrents } as never;

    const d = await grabRelease(db, qbt, { ...httpInput, guid: "g-http" }, { stagingDir: "/st", waitMs: 0 });
    expect(addTorrent).not.toHaveBeenCalled();
    expect(addTorrentFile).toHaveBeenCalledTimes(1);
    const arg = addTorrentFile.mock.calls[0][0];
    expect(Buffer.from(arg.file)[0]).toBe(0x64); // 'd' — bencode
    expect(arg.category).toBe("dublyarr");
    expect(arg.savePath).toBe("/st");
    expect(arg.tags).toBe(d.tag);
    expect(d.status).toBe("downloading");
  });

  test("redirect на magnet → addTorrent с магнитом", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, { status: 302, headers: { location: "magnet:?xt=urn:btih:dead" } }),
      ),
    );
    const addTorrent = vi.fn().mockResolvedValue(undefined);
    const addTorrentFile = vi.fn();
    const qbt = { addTorrent, addTorrentFile, listTorrents: vi.fn().mockResolvedValue([]) } as never;

    await grabRelease(db, qbt, { ...httpInput, guid: "g-magnet-redir" }, { waitMs: 0, attempts: 1 });
    expect(addTorrentFile).not.toHaveBeenCalled();
    expect(addTorrent.mock.calls[0][0].url).toBe("magnet:?xt=urn:btih:dead");
  });

  test("HTTP 500 от источника → download failed с кодом, исключение проброшено", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("err", { status: 500 })));
    const qbt = { addTorrent: vi.fn(), addTorrentFile: vi.fn(), listTorrents: vi.fn() } as never;

    const err = await grabRelease(db, qbt, { ...httpInput, guid: "g-500" }, { waitMs: 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(QbtError);
    const row = sqlite
      .prepare(`SELECT status, error FROM downloads WHERE release_guid = 'g-500'`)
      .get() as { status: string; error: string };
    expect(row.status).toBe("failed");
    expect(row.error).toContain("500");
  });

  test("HTML вместо торрента → failed «не torrent-файл»", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>login</html>", { status: 200 })),
    );
    const qbt = { addTorrent: vi.fn(), addTorrentFile: vi.fn(), listTorrents: vi.fn() } as never;

    const err = await grabRelease(db, qbt, { ...httpInput, guid: "g-html" }, { waitMs: 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(QbtError);
    const row = sqlite
      .prepare(`SELECT status, error FROM downloads WHERE release_guid = 'g-html'`)
      .get() as { status: string; error: string };
    expect(row.status).toBe("failed");
    expect(row.error).toContain("не torrent-файл");
  });
});
