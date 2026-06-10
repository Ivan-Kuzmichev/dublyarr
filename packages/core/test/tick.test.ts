import { afterAll, describe, expect, test, vi } from "vitest";
import { openDb, setSetting } from "../src/db/index.js";
import { makeDeps } from "../src/tick.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-tick-"));
const { db, sqlite } = openDb(join(dir, "tick.db"));
afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("makeDeps", () => {
  test("search дергает searchJackett с настройками и парсит; minSeeders из настроек", async () => {
    setSetting(db, "jackett_url", "http://jk");
    setSetting(db, "jackett_api_key", "key");
    setSetting(db, "qbit_url", "http://qb");
    setSetting(db, "monitor_min_seeders", "3");

    const searchJackett = vi.fn().mockResolvedValue([]);
    const qbt = { addTorrent: vi.fn(), listTorrents: vi.fn().mockResolvedValue([]) } as never;

    const deps = makeDeps(db, { searchJackett, qbt });
    expect(deps.minSeeders).toBe(3);

    await deps.search("Запрос");
    expect(searchJackett).toHaveBeenCalledWith({ url: "http://jk", apiKey: "key" }, "Запрос");
  });
});
