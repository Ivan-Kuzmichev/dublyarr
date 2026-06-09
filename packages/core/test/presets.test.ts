import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { openDb } from "../src/db/index.js";
import {
  createPreset,
  deletePreset,
  getPreset,
  listPresets,
  updatePreset,
} from "../src/db/presets.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-presets-"));
const { db, sqlite } = openDb(join(dir, "test.db"));

afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("listPresets / getPreset", () => {
  test("видит засеянные пресеты с распарсенным allowed", () => {
    const all = listPresets(db);
    expect(all.map((p) => p.name)).toEqual(["FullHD", "4K"]);
    expect(all[0].allowed).toContain("webdl-1080p");
    expect(all[0].preferred).toBe("webdl-1080p");
    expect(all[0].upgradeEnabled).toBe(false);
    expect(all[1].upgradeEnabled).toBe(true);
    expect(getPreset(db, all[0].id)?.name).toBe("FullHD");
    expect(getPreset(db, 9999)).toBeNull();
  });
});

describe("createPreset", () => {
  test("создаёт валидный пресет", () => {
    const r = createPreset(db, {
      name: "720p эконом",
      allowed: ["720p", "sd"],
      preferred: "720p",
      upgradeEnabled: false,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.preset.id).toBeGreaterThan(0);
  });

  test("отклоняет preferred вне allowed", () => {
    const r = createPreset(db, {
      name: "Битый",
      allowed: ["720p"],
      preferred: "webdl-1080p",
      upgradeEnabled: false,
    });
    expect(r).toEqual({ ok: false, error: "Предпочитаемое качество должно быть среди отмеченных" });
  });

  test("отклоняет неизвестный ключ качества и пустые поля", () => {
    expect(
      createPreset(db, { name: "X", allowed: ["vhs"], preferred: "vhs", upgradeEnabled: false }).ok,
    ).toBe(false);
    expect(
      createPreset(db, { name: " ", allowed: ["720p"], preferred: "720p", upgradeEnabled: false }).ok,
    ).toBe(false);
    expect(
      createPreset(db, { name: "Y", allowed: [], preferred: "720p", upgradeEnabled: false }).ok,
    ).toBe(false);
  });

  test("отклоняет дубль имени", () => {
    const r = createPreset(db, {
      name: "FullHD",
      allowed: ["720p"],
      preferred: "720p",
      upgradeEnabled: false,
    });
    expect(r.ok).toBe(false);
  });
});

describe("updatePreset / deletePreset", () => {
  test("обновляет пресет", () => {
    const id = listPresets(db).find((p) => p.name === "720p эконом")!.id;
    const r = updatePreset(db, id, {
      name: "720p эконом",
      allowed: ["webdl-1080p", "720p"],
      preferred: "webdl-1080p",
      upgradeEnabled: true,
    });
    expect(r.ok).toBe(true);
    expect(getPreset(db, id)?.upgradeEnabled).toBe(true);
  });

  test("удаляет неиспользуемый пресет", () => {
    const id = listPresets(db).find((p) => p.name === "720p эконом")!.id;
    expect(deletePreset(db, id)).toEqual({ ok: true });
    expect(getPreset(db, id)).toBeNull();
  });

  test("отказывается удалять пресет, на который ссылается тайтл", () => {
    const presetId = listPresets(db)[0].id;
    sqlite
      .prepare(
        `INSERT INTO titles (tmdb_id, type, title_ru, title_original, quality_preset_id)
         VALUES (1, 'movie', 'Тест', 'Test', ?)`,
      )
      .run(presetId);
    const r = deletePreset(db, presetId);
    expect(r.ok).toBe(false);
    sqlite.prepare(`DELETE FROM titles WHERE tmdb_id = 1`).run();
  });
});
