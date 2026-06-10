import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
  addTitle,
  createDownload,
  getDownload,
  listEpisodes,
  listFiles,
  openDb,
  syncEpisodes,
} from "../src/db/index.js";
import { importDownload } from "../src/import.js";
import { DEFAULT_NAMING_MOVIE, DEFAULT_NAMING_TV } from "../src/naming.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-import-"));
const { db, sqlite } = openDb(join(dir, "import.db"));
const libraryDir = join(dir, "library");

afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

function makeDownload(titleId: number) {
  return createDownload(db, {
    titleId,
    releaseGuid: "guid-imp",
    releaseTitle: "rel",
    episodesCovered: [],
    voiceoverStudio: "Сыендук",
    qualitySource: "WEB-DL",
    qualityResolution: "1080p",
  });
}

describe("importDownload: сериал", () => {
  const title = addTitle(db, {
    tmdbId: 60625,
    type: "tv",
    titleRu: "Рик и Морти",
    titleOriginal: "Rick and Morty",
    year: "2013",
    posterPath: null,
    overview: "",
    tmdbStatus: null,
    qualityPresetId: 1,
    voiceover: "Сыендук",
    monitorRule: "all",
  });
  syncEpisodes(
    db,
    title.id,
    [
      { season: 1, episode: 1, airDate: "2013-12-02", name: "Пилот" },
      { season: 1, episode: 2, airDate: "2013-12-09", name: "" },
    ],
    "all",
  );

  test("маппит файлы по SxxEyy, кладёт по шаблону, закрывает эпизоды", () => {
    const content = join(dir, "staging", "Rick.and.Morty.S01");
    mkdirSync(content, { recursive: true });
    writeFileSync(join(content, "Rick.and.Morty.S01E01.1080p.mkv"), "video-1");
    writeFileSync(join(content, "Rick.and.Morty.S01E02.1080p.mkv"), "video-22");
    writeFileSync(join(content, "readme.txt"), "не видео");

    const d = makeDownload(title.id);
    const result = importDownload(db, d, title, content, {
      libraryDir,
      template: DEFAULT_NAMING_TV,
    });
    expect(result.ok).toBe(true);
    const expected = join(
      libraryDir,
      "Rick and Morty",
      "Season 01",
      "Rick and Morty - S01E01 - WEB-DL 1080p Сыендук.mkv",
    );
    expect(existsSync(expected)).toBe(true);

    const eps = listEpisodes(db, title.id);
    expect(eps[0].fileId).not.toBeNull();
    expect(eps[1].fileId).not.toBeNull();
    expect(listFiles(db, title.id)).toHaveLength(2);
    expect(getDownload(db, d.id)?.status).toBe("imported");
  });

  test("нет видеофайлов → ошибка, статус не imported", () => {
    const content = join(dir, "staging", "empty-rel");
    mkdirSync(content, { recursive: true });
    writeFileSync(join(content, "только.txt"), "x");
    const d = makeDownload(title.id);
    const result = importDownload(db, d, title, content, {
      libraryDir,
      template: DEFAULT_NAMING_TV,
    });
    expect(result).toEqual({ ok: false, error: "В загрузке нет видеофайлов" });
    expect(getDownload(db, d.id)?.status).toBe("queued");
  });

  test("видео без метки серии → ошибка сопоставления", () => {
    const content = join(dir, "staging", "untagged");
    mkdirSync(content, { recursive: true });
    writeFileSync(join(content, "Rick.and.Morty.Full.1080p.mkv"), "x");
    const d = makeDownload(title.id);
    const result = importDownload(db, d, title, content, {
      libraryDir,
      template: DEFAULT_NAMING_TV,
    });
    expect(result).toEqual({
      ok: false,
      error: "Не удалось сопоставить файлы с сериями",
    });
  });
});

describe("importDownload: фильм", () => {
  const movie = addTitle(db, {
    tmdbId: 438631,
    type: "movie",
    titleRu: "Дюна",
    titleOriginal: "Dune",
    year: "2021",
    posterPath: null,
    overview: "",
    tmdbStatus: null,
    qualityPresetId: 1,
    voiceover: "any",
    monitorRule: "all",
  });

  test("берёт самый большой видеофайл, content_path может быть файлом", () => {
    const content = join(dir, "staging", "dune");
    mkdirSync(content, { recursive: true });
    writeFileSync(join(content, "sample.mkv"), "tiny");
    writeFileSync(join(content, "Dune.2021.BDRemux.mkv"), "big-movie-content");

    const d = createDownload(db, {
      titleId: movie.id,
      releaseGuid: "guid-dune",
      releaseTitle: "Dune BDRemux",
      episodesCovered: [],
      voiceoverStudio: "HDrezka",
      qualitySource: "BDRemux",
      qualityResolution: "2160p",
    });
    const result = importDownload(db, d, movie, content, {
      libraryDir,
      template: DEFAULT_NAMING_MOVIE,
    });
    expect(result.ok).toBe(true);
    const expected = join(
      libraryDir,
      "Dune (2021)",
      "Dune (2021) - BDRemux 2160p HDrezka.mkv",
    );
    expect(existsSync(expected)).toBe(true);
    const rows = listFiles(db, movie.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].episodeId).toBeNull();
    expect(rows[0].qualityResolution).toBe("2160p");
  });

  test("несуществующий contentPath → ошибка", () => {
    const d = makeDownload(movie.id);
    const result = importDownload(db, d, movie, join(dir, "нет-такого"), {
      libraryDir,
      template: DEFAULT_NAMING_MOVIE,
    });
    expect(result).toEqual({ ok: false, error: "Файлы загрузки не найдены на диске" });
  });
});

describe("importDownload: Duplicate Show (tmdbId 60626) — регрессии", () => {
  const dupTitle = addTitle(db, {
    tmdbId: 60626,
    type: "tv",
    titleRu: "Дубликат",
    titleOriginal: "Dup",
    year: "2020",
    posterPath: null,
    overview: "",
    tmdbStatus: null,
    qualityPresetId: 1,
    voiceover: "any",
    monitorRule: "all",
  });
  syncEpisodes(
    db,
    dupTitle.id,
    [
      { season: 1, episode: 1, airDate: "2020-01-01", name: "E1" },
      { season: 1, episode: 2, airDate: "2020-01-08", name: "E2" },
    ],
    "all",
  );

  function makeDupDownload() {
    return createDownload(db, {
      titleId: dupTitle.id,
      releaseGuid: `guid-dup-${Date.now()}-${Math.random()}`,
      releaseTitle: "Dup S01",
      episodesCovered: [],
      voiceoverStudio: null,
      qualitySource: "WEB-DL",
      qualityResolution: "1080p",
    });
  }

  test("дубликаты метки: два файла S01E01 — импортируется только первый, файлов в библиотеке 2", () => {
    const content = join(dir, "staging", "dup-label");
    mkdirSync(content, { recursive: true });
    writeFileSync(join(content, "Dup.S01E01.1080p.mkv"), "first");
    writeFileSync(join(content, "Dup.S01E01.PROPER.1080p.mkv"), "second");
    writeFileSync(join(content, "Dup.S01E02.1080p.mkv"), "e2");

    const d = makeDupDownload();
    const result = importDownload(db, d, dupTitle, content, {
      libraryDir,
      template: DEFAULT_NAMING_TV,
    });
    expect(result.ok).toBe(true);

    const files = listFiles(db, dupTitle.id);
    // Только 2 файла: S01E01 (первый) и S01E02 — не 3
    expect(files).toHaveLength(2);

    // Контент файла E01 в библиотеке === "first" (не перезаписан)
    const e01Path = files.find((f) => f.path.includes("E01"))?.path;
    expect(e01Path).toBeDefined();
    expect(readFileSync(e01Path!, "utf8")).toBe("first");
  });

  test("повторный импорт: уже импортированный контент → ok true, files [], статус imported", () => {
    // Создаём второй download того же тайтла с тем же контентом
    const content = join(dir, "staging", "dup-label"); // тот же content что в прошлом тесте

    const d2 = makeDupDownload();
    const result = importDownload(db, d2, dupTitle, content, {
      libraryDir,
      template: DEFAULT_NAMING_TV,
    });
    expect(result).toEqual({ ok: true, files: [] });
    expect(getDownload(db, d2.id)?.status).toBe("imported");

    // Количество файлов не изменилось — всё ещё 2
    expect(listFiles(db, dupTitle.id)).toHaveLength(2);
  });

  test("пустой шаблон: {VO} при vo='' → ошибка пустого пути", () => {
    // Нужен тайтл с незаполненными fileId (отдельный, чтобы не зависеть от
    // состояния dupTitle после предыдущих тестов)
    const tmplTitle = addTitle(db, {
      tmdbId: 60627,
      type: "tv",
      titleRu: "Шаблон тест",
      titleOriginal: "TmplTest",
      year: "2021",
      posterPath: null,
      overview: "",
      tmdbStatus: null,
      qualityPresetId: 1,
      voiceover: "any",
      monitorRule: "all",
    });
    syncEpisodes(
      db,
      tmplTitle.id,
      [{ season: 1, episode: 1, airDate: "2021-01-01", name: "E1" }],
      "all",
    );

    const content = join(dir, "staging", "dup-empty-tmpl");
    mkdirSync(content, { recursive: true });
    writeFileSync(join(content, "TmplTest.S01E01.1080p.mkv"), "x");

    const d = createDownload(db, {
      titleId: tmplTitle.id,
      releaseGuid: `guid-empty-tmpl-${Date.now()}`,
      releaseTitle: "TmplTest empty",
      episodesCovered: [],
      voiceoverStudio: null, // vo будет ""
      qualitySource: "WEB-DL",
      qualityResolution: "1080p",
    });
    const result = importDownload(db, d, tmplTitle, content, {
      libraryDir,
      template: "{VO}", // при vo="" → renderTemplate вернёт ""
    });
    expect(result).toEqual({ ok: false, error: "Шаблон имени дал пустой путь" });
  });
});
