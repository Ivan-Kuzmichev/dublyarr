import { describe, expect, test } from "vitest";
import {
  compressSeasons,
  groupBySeason,
  parseRelease,
  summarizeStudioAvailability,
} from "../src/parser.js";

const rutrackerItem = {
  title: "Rick and Morty S09E01-02 1080p WEB-DL",
  description:
    "Рик и Морти / Rick and Morty [Сезон: 9, Серии: 1-2 из 10] (2026) WEB-DL 1080p | VO (Сыендук, RedRussian1337) + MVO (TVShows, HDrezka) + Original + Sub (Rus, Eng)",
  indexer: "RuTracker.org",
};

describe("parseRelease", () => {
  test("извлекает озвучки из description (VO + MVO), SUB — не озвучка", () => {
    const r = parseRelease(rutrackerItem);
    expect(r.parsed.voiceovers).toEqual([
      { kind: "VO", studios: ["Сыендук", "RedRussian1337"] },
      { kind: "MVO", studios: ["TVShows", "HDrezka"] },
    ]);
    expect(r.parsed.subs).toEqual(["Rus", "Eng"]);
    expect(r.parsed.hasOriginal).toBe(true);
  });

  test("сезон, качество, источник текста", () => {
    const r = parseRelease(rutrackerItem);
    expect(r.parsed.source).toBe("description");
    expect(r.parsed.seasons).toEqual([9]);
    expect(r.parsed.quality).toEqual({ source: "WEB-DL", resolution: "1080p" });
    expect(r.parsed.episodes).toEqual({ range: "1-2", total: 10 });
  });

  test("нормализация алиасов студий", () => {
    const r = parseRelease({
      title: "x",
      description: "Что-то [Сезон: 1] MVO (HDrezka Studio, кубик в кубе)",
      indexer: "RuTracker.org",
    });
    expect(r.parsed.voiceovers[0].studios).toEqual(["HDrezka", "Кубик в Кубе"]);
  });

  test("fallback: трекер = студия (LostFilm)", () => {
    const r = parseRelease({
      title: "Severance S02 1080p WEB-DL",
      description: "",
      indexer: "LostFilm.tv",
    });
    expect(r.parsed.voiceovers).toEqual([
      { kind: "MVO", studios: ["LostFilm"] },
    ]);
    expect(r.parsed.seasons).toEqual([2]);
  });

  test("диапазон сезонов «Сезоны: 6-8»", () => {
    const r = parseRelease({
      title: "x",
      description: "Сериал [Сезоны: 6-8] BDRip 1080p VO (Сыендук)",
      indexer: "RuTracker.org",
    });
    expect(r.parsed.seasons).toEqual([6, 7, 8]);
  });
});

describe("summarizeStudioAvailability", () => {
  test("группирует по студия+тип, дедуп качеств (голый source убирается)", () => {
    const releases = [
      parseRelease({
        title: "x S01 BDRip 1080p",
        description: "Тайтл [Сезон: 1] BDRip 1080p VO (Сыендук)",
        indexer: "RuTracker.org",
      }),
      parseRelease({
        title: "x S02 BDRip",
        description: "Тайтл [Сезон: 2] BDRip VO (Сыендук)",
        indexer: "RuTracker.org",
      }),
    ];
    const rows = summarizeStudioAvailability(releases);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      studio: "Сыендук",
      kind: "VO",
      seasons: [1, 2],
      count: 2,
    });
    expect(rows[0].qualities).toEqual(["BDRip 1080p"]);
  });

  test("сортировка по числу раздач (desc)", () => {
    const mk = (studio: string) =>
      parseRelease({
        title: "x",
        description: `Тайтл [Сезон: 1] WEB-DL 1080p VO (${studio})`,
        indexer: "RuTracker.org",
      });
    const rows = summarizeStudioAvailability([mk("A"), mk("B"), mk("B")]);
    expect(rows.map((r) => r.studio)).toEqual(["B", "A"]);
  });
});

test("compressSeasons", () => {
  expect(compressSeasons([1, 2, 3, 7, 8])).toBe("1–3, 7–8");
  expect(compressSeasons([5])).toBe("5");
  expect(compressSeasons([])).toBe("—");
});

describe("groupBySeason", () => {
  test("группирует по сезонам, без сезона — в «—» последним", () => {
    const mk = (description: string) =>
      parseRelease({ title: "x", description, indexer: "RuTracker.org" });
    const releases = [
      mk("Тайтл [Сезон: 2] WEB-DL 1080p VO (Сыендук)"),
      mk("Тайтл [Сезон: 1] WEB-DL 1080p VO (Сыендук)"),
      mk("Фильм (2026) WEB-DL 1080p VO (Сыендук)"),
    ];
    const groups = groupBySeason(releases);
    expect(groups.map(([season]) => season)).toEqual(["1", "2", "—"]);
    expect(groups[0][1]).toHaveLength(1);
  });
});
