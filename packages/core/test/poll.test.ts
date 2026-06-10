import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test, vi } from "vitest";
import {
  addTitle,
  createDownload,
  getDownload,
  isBlacklisted,
  openDb,
  updateDownload,
} from "../src/db/index.js";
import { refreshDownload } from "../src/poll.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-poll-"));
const { db, sqlite } = openDb(join(dir, "poll.db"));

afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const title = addTitle(db, {
  tmdbId: 1, type: "movie", titleRu: "Ф", titleOriginal: "F", year: "2020",
  posterPath: null, overview: "", tmdbStatus: null,
  qualityPresetId: 1, voiceover: "any", monitorRule: "all",
});

function newDownload(guid: string) {
  return createDownload(db, {
    titleId: title.id, releaseGuid: guid, releaseTitle: "rel",
    episodesCovered: [], voiceoverStudio: null,
    qualitySource: null, qualityResolution: null,
  });
}

describe("refreshDownload", () => {
  test("queued → downloading при появлении торрента", async () => {
    const d = newDownload("g-1");
    const qbt = {
      listTorrents: vi.fn().mockResolvedValue([{ hash: "H", state: "downloading", progress: 0.3, contentPath: "" }]),
    } as never;
    await refreshDownload(db, qbt, d, { now: new Date("2030-01-01T00:00:00Z") });
    const fresh = getDownload(db, d.id)!;
    expect(fresh.status).toBe("downloading");
    expect(fresh.qbitHash).toBe("H");
    expect(fresh.progress).toBeCloseTo(0.3);
  });

  test("downloading без торрента → failed", async () => {
    const d = newDownload("g-2");
    updateDownload(db, d.id, { status: "downloading", qbitHash: "H2", progress: 0.5 });
    const qbt = { listTorrents: vi.fn().mockResolvedValue([]) } as never;
    await refreshDownload(db, qbt, getDownload(db, d.id)!, { now: new Date("2030-01-01T00:00:00Z") });
    expect(getDownload(db, d.id)!.status).toBe("failed");
  });

  test("зависший downloading дольше stall_hours → failed + blacklist", async () => {
    const d = newDownload("g-stall");
    sqlite.prepare(`UPDATE downloads SET status='downloading', qbit_hash='H3', created_at='2030-01-01T00:00:00Z' WHERE id=?`).run(d.id);
    const qbt = {
      listTorrents: vi.fn().mockResolvedValue([{ hash: "H3", state: "stalledDL", progress: 0.1, contentPath: "" }]),
    } as never;
    await refreshDownload(db, qbt, getDownload(db, d.id)!, {
      now: new Date("2030-01-01T10:00:00Z"), // +10ч > stall 6ч
      stallHours: 6,
    });
    expect(getDownload(db, d.id)!.status).toBe("failed");
    expect(isBlacklisted(db, title.id, "g-stall")).toBe(true);
  });
});
