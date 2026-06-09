import { describe, expect, test } from "vitest";
import {
  QUALITY_LADDER,
  highestAllowed,
  qualityKeyFor,
  qualityLabel,
  qualityRank,
} from "../src/quality.js";

describe("QUALITY_LADDER", () => {
  test("порядок: лучшее сверху", () => {
    expect(QUALITY_LADDER.map((q) => q.key)).toEqual([
      "bdremux-2160p",
      "webdl-2160p",
      "bdremux-1080p",
      "bluray-1080p",
      "bdrip-1080p",
      "webdl-1080p",
      "webrip-1080p",
      "hdtv-1080p",
      "720p",
      "sd",
    ]);
  });
});

describe("qualityRank", () => {
  test("выше по лестнице — больше ранг", () => {
    expect(qualityRank("bdremux-2160p")).toBeGreaterThan(qualityRank("webdl-1080p"));
    expect(qualityRank("720p")).toBeGreaterThan(qualityRank("sd"));
  });
  test("неизвестный ключ → -1", () => {
    expect(qualityRank("vhs")).toBe(-1);
  });
});

describe("qualityKeyFor (парсер → ключ лестницы)", () => {
  test("точные совпадения", () => {
    expect(qualityKeyFor("BDRemux", "2160p")).toBe("bdremux-2160p");
    expect(qualityKeyFor("WEB-DL", "2160p")).toBe("webdl-2160p");
    expect(qualityKeyFor("BluRay", "1080p")).toBe("bluray-1080p");
    expect(qualityKeyFor("BDRip", "1080p")).toBe("bdrip-1080p");
    expect(qualityKeyFor("WEB-DL", "1080p")).toBe("webdl-1080p");
    expect(qualityKeyFor("WEBRip", "1080p")).toBe("webrip-1080p");
    expect(qualityKeyFor("HDTV", "1080p")).toBe("hdtv-1080p");
  });
  test("Remux считается BDRemux", () => {
    expect(qualityKeyFor("Remux", "2160p")).toBe("bdremux-2160p");
    expect(qualityKeyFor("Remux", "1080p")).toBe("bdremux-1080p");
  });
  test("неизвестный источник падает в нижнюю ступень разрешения", () => {
    expect(qualityKeyFor("HDRip", "2160p")).toBe("webdl-2160p");
    expect(qualityKeyFor("HDRip", "1080p")).toBe("hdtv-1080p");
    expect(qualityKeyFor(null, "1080p")).toBe("hdtv-1080p");
  });
  test("720p и ниже", () => {
    expect(qualityKeyFor("WEB-DL", "720p")).toBe("720p");
    expect(qualityKeyFor("DVDRip", "480p")).toBe("sd");
    expect(qualityKeyFor("DVDRip", null)).toBe("sd");
  });
  test("совсем ничего → null", () => {
    expect(qualityKeyFor(null, null)).toBeNull();
  });
});

describe("qualityLabel", () => {
  test("человекочитаемая метка", () => {
    expect(qualityLabel("webdl-1080p")).toBe("WEB-DL 1080p");
    expect(qualityLabel("nope")).toBe("nope");
  });
});

describe("highestAllowed", () => {
  test("самое высокое из отмеченных", () => {
    expect(highestAllowed(["hdtv-1080p", "webdl-1080p", "720p"])).toBe("webdl-1080p");
  });
  test("пустой список → null", () => {
    expect(highestAllowed([])).toBeNull();
  });
});
