import { describe, expect, test } from "vitest";
import {
  DEFAULT_NAMING_MOVIE,
  DEFAULT_NAMING_TV,
  renderTemplate,
  sanitizeName,
} from "../src/naming.js";

describe("sanitizeName", () => {
  test("вырезает запрещённые символы и схлопывает пробелы", () => {
    expect(sanitizeName('Rick: and/Morty *<"?>|')).toBe("Rick and Morty");
  });
});

describe("renderTemplate", () => {
  test("сериал по дефолтному шаблону", () => {
    const out = renderTemplate(DEFAULT_NAMING_TV, {
      show: "Rick and Morty",
      year: "2013",
      season: 1,
      episode: 3,
      quality: "WEB-DL 1080p",
      vo: "Сыендук",
    });
    expect(out).toBe(
      "Rick and Morty/Season 01/Rick and Morty - S01E03 - WEB-DL 1080p Сыендук",
    );
  });

  test("фильм по дефолтному шаблону", () => {
    const out = renderTemplate(DEFAULT_NAMING_MOVIE, {
      show: "Dune",
      year: "2021",
      quality: "BDRemux 2160p",
      vo: "HDrezka",
    });
    expect(out).toBe("Dune (2021)/Dune (2021) - BDRemux 2160p HDrezka");
  });

  test("пустые quality/vo не оставляют висячих разделителей", () => {
    const out = renderTemplate(DEFAULT_NAMING_TV, {
      show: "Show",
      year: "2020",
      season: 2,
      episode: 11,
      quality: "",
      vo: "",
    });
    expect(out).toBe("Show/Season 02/Show - S02E11");
  });

  test("show с запрещёнными символами чистится в каждом сегменте", () => {
    const out = renderTemplate(DEFAULT_NAMING_MOVIE, {
      show: "What/If: Tales",
      year: "2024",
      quality: "WEB-DL 1080p",
      vo: "",
    });
    expect(out).toBe("What If Tales (2024)/What If Tales (2024) - WEB-DL 1080p");
  });

  test("слэши и .. в quality/vo/year не создают сегментов пути", () => {
    const out = renderTemplate(DEFAULT_NAMING_TV, {
      show: "Show",
      year: "2020",
      season: 1,
      episode: 2,
      quality: "WEB-DL/1080p",
      vo: "../../../etc/passwd",
    });
    expect(out).not.toContain("..");
    expect(out.split("/")).toHaveLength(3);
  });
});
