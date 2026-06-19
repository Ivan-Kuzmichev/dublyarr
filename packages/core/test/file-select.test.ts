import { describe, expect, test } from "vitest";
import { unwantedFileIndices } from "../src/grab.js";

describe("unwantedFileIndices", () => {
  test("season-пак: оставляет только нужные серии, остальные распознанные — на сброс", () => {
    const files = [
      { name: "Show/Show.S01E01.1080p.mkv" },
      { name: "Show/Show.S01E02.1080p.mkv" },
      { name: "Show/Show.S01E03.1080p.mkv" },
    ];
    const drop = unwantedFileIndices(files, [{ season: 1, episode: 3 }]);
    expect(drop).toEqual([0, 1]);
  });

  test("нужны несколько серий — обе остаются", () => {
    const files = [
      { name: "Show.S01E08.mkv" },
      { name: "Show.S01E09.mkv" },
      { name: "Show.S01E10.mkv" },
    ];
    const drop = unwantedFileIndices(files, [
      { season: 1, episode: 9 },
      { season: 1, episode: 10 },
    ]);
    expect(drop).toEqual([0]);
  });

  test("раздача покрывает только нужное — сбрасывать нечего", () => {
    const files = [{ name: "Show.S01E10.mkv" }];
    expect(unwantedFileIndices(files, [{ season: 1, episode: 10 }])).toEqual([]);
  });

  test("нераспознанные файлы (sample/nfo) не трогаем", () => {
    const files = [
      { name: "Show.S01E10.mkv" },
      { name: "sample.mkv" },
      { name: "info.nfo" },
    ];
    expect(unwantedFileIndices(files, [{ season: 1, episode: 10 }])).toEqual([]);
  });

  test("пустой keep — ничего не сбрасываем (защита от полного дропа)", () => {
    const files = [{ name: "Show.S01E01.mkv" }];
    expect(unwantedFileIndices(files, [])).toEqual([]);
  });

  test("аниме [NN] без сезона: матчим по номеру серии (keep — один сезон)", () => {
    const files = [
      { name: "Devil_May_Cry_2_[06]_[HEVC].mkv" },
      { name: "Devil_May_Cry_2_[07]_[HEVC].mkv" },
      { name: "Devil_May_Cry_2_[09]_[HEVC].mkv" },
    ];
    const keep = [
      { season: 2, episode: 6 },
      { season: 2, episode: 7 },
    ];
    expect(unwantedFileIndices(files, keep)).toEqual([2]); // только [09] лишний
  });
});
