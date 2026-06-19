import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test, vi } from "vitest";
import {
  addFile,
  addHistory,
  addTitle,
  createDownload,
  listEpisodes,
  listHistory,
  openDb,
  syncEpisodes,
  updateDownload,
} from "../src/db/index.js";
import { parseRelease } from "../src/parser.js";
import type { JackettRelease } from "../src/jackett.js";
import { selectCandidates, runTitle } from "../src/pipeline.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-pipeline-"));
const { db, sqlite } = openDb(join(dir, "pipeline.db"));
afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

function rawRel(over: Partial<JackettRelease> & { title: string }): JackettRelease {
  return {
    title: over.title, description: over.description ?? "", indexer: "RuTracker",
    trackerType: "public", guid: over.guid ?? over.title, comments: "", pubDate: "",
    size: 1_000_000, seeders: over.seeders ?? 10, peers: 0, grabs: 0,
    link: over.link ?? `magnet:${over.title}`,
  };
}

const TODAY = "2024-01-01";

describe("selectCandidates", () => {
  test("сериал с wanted-эпизодами без файла → кандидат missing с нужными сезонами", () => {
    const tv = addTitle(db, {
      tmdbId: 100, type: "tv", titleRu: "Сериал", titleOriginal: "Series", year: "2020",
      posterPath: null, overview: "", tmdbStatus: null,
      qualityPresetId: 1, voiceover: "Сыендук", monitorRule: "all",
    });
    syncEpisodes(db, tv.id, [
      { season: 1, episode: 1, airDate: "2020-01-01", name: "" },
      { season: 2, episode: 1, airDate: "2020-02-01", name: "" },
    ], "all", TODAY);
    const cands = selectCandidates(db, TODAY);
    const c = cands.find((x) => x.title.id === tv.id);
    expect(c?.reason).toBe("missing");
    expect(c?.wantedSeasons.sort()).toEqual([1, 2]);
  });

  test("фильм tracked без файла → кандидат missing", () => {
    const movie = addTitle(db, {
      tmdbId: 200, type: "movie", titleRu: "Фильм", titleOriginal: "Movie", year: "2020",
      posterPath: null, overview: "", tmdbStatus: null,
      qualityPresetId: 1, voiceover: "any", monitorRule: "all",
    });
    const c = selectCandidates(db, TODAY).find((x) => x.title.id === movie.id);
    expect(c?.reason).toBe("missing");
  });

  test("фильм с файлом → не кандидат", () => {
    const movie = addTitle(db, {
      tmdbId: 201, type: "movie", titleRu: "Готов", titleOriginal: "Done", year: "2020",
      posterPath: null, overview: "", tmdbStatus: null,
      qualityPresetId: 1, voiceover: "any", monitorRule: "all",
    });
    addFile(db, {
      titleId: movie.id, episodeId: null, path: "/lib/done.mkv", size: 1,
      qualitySource: "WEB-DL", qualityResolution: "1080p", voiceoverStudio: null, releaseGuid: null,
    });
    expect(selectCandidates(db, TODAY).some((x) => x.title.id === movie.id)).toBe(false);
  });

  test("невышедшие wanted-серии не дают кандидата", () => {
    const tv = addTitle(db, {
      tmdbId: 400, type: "tv", titleRu: "Будущее", titleOriginal: "Future", year: "2024",
      posterPath: null, overview: "", tmdbStatus: null,
      qualityPresetId: 1, voiceover: "any", monitorRule: "all",
    });
    syncEpisodes(db, tv.id, [
      { season: 1, episode: 9, airDate: "2024-06-09", name: "" },
      { season: 1, episode: 10, airDate: "2024-06-16", name: "" },
    ], "all", TODAY);
    expect(selectCandidates(db, TODAY).some((x) => x.title.id === tv.id)).toBe(false);
  });

  test("вышедшие и невышедшие вперемешку → в кандидате только вышедшие", () => {
    const tv = addTitle(db, {
      tmdbId: 401, type: "tv", titleRu: "Смесь", titleOriginal: "Mixed", year: "2023",
      posterPath: null, overview: "", tmdbStatus: null,
      qualityPresetId: 1, voiceover: "any", monitorRule: "all",
    });
    syncEpisodes(db, tv.id, [
      { season: 1, episode: 1, airDate: "2023-12-01", name: "" },
      { season: 1, episode: 2, airDate: null, name: "" },
      { season: 1, episode: 3, airDate: "2024-06-01", name: "" },
    ], "all", TODAY);
    const c = selectCandidates(db, TODAY).find((x) => x.title.id === tv.id);
    // серия без даты выхода считается потенциально вышедшей, будущая — нет
    expect(c?.wantedEpisodes.map((e) => e.episode).sort()).toEqual([1, 2]);
  });

  test("рейт-лимит: искали меньше интервала назад → пропуск", () => {
    const movie = addTitle(db, {
      tmdbId: 202, type: "movie", titleRu: "Свежий", titleOriginal: "Fresh", year: "2020",
      posterPath: null, overview: "", tmdbStatus: null,
      qualityPresetId: 1, voiceover: "any", monitorRule: "all",
    });
    addHistory(db, { titleId: movie.id, kind: "search", message: "только что", createdAt: "2024-01-01T11:59:00Z" });
    const now = new Date("2024-01-01T12:00:00Z"); // 1 минута назад
    const cands = selectCandidates(db, TODAY, { now, rateLimitMinutes: 60 });
    expect(cands.some((x) => x.title.id === movie.id)).toBe(false);
  });

  test("серия уже качается (активная загрузка покрывает её) → не кандидат", () => {
    const tv = addTitle(db, {
      tmdbId: 500, type: "tv", titleRu: "Качается", titleOriginal: "Downloading", year: "2023",
      posterPath: null, overview: "", tmdbStatus: null,
      qualityPresetId: 1, voiceover: "any", monitorRule: "all",
    });
    syncEpisodes(db, tv.id, [{ season: 1, episode: 1, airDate: "2023-01-01", name: "" }], "all", TODAY);
    const ep = listEpisodes(db, tv.id)[0];
    createDownload(db, {
      titleId: tv.id, releaseGuid: "g-active", releaseTitle: "rel",
      episodesCovered: [ep.id], voiceoverStudio: null, qualitySource: null, qualityResolution: null,
    }); // статус по умолчанию queued — активная
    expect(selectCandidates(db, TODAY).some((x) => x.title.id === tv.id)).toBe(false);
  });

  test("активная загрузка покрывает часть серий → кандидат только из остальных", () => {
    const tv = addTitle(db, {
      tmdbId: 501, type: "tv", titleRu: "Частично", titleOriginal: "Partial", year: "2023",
      posterPath: null, overview: "", tmdbStatus: null,
      qualityPresetId: 1, voiceover: "any", monitorRule: "all",
    });
    syncEpisodes(db, tv.id, [
      { season: 1, episode: 1, airDate: "2023-01-01", name: "" },
      { season: 1, episode: 2, airDate: "2023-01-08", name: "" },
    ], "all", TODAY);
    const eps = listEpisodes(db, tv.id);
    createDownload(db, {
      titleId: tv.id, releaseGuid: "g-partial", releaseTitle: "rel",
      episodesCovered: [eps[0].id], voiceoverStudio: null, qualitySource: null, qualityResolution: null,
    });
    const c = selectCandidates(db, TODAY).find((x) => x.title.id === tv.id);
    expect(c?.wantedEpisodes.map((e) => e.episode)).toEqual([2]);
  });

  test("упавшая загрузка НЕ блокирует повторный подбор (только активные)", () => {
    const tv = addTitle(db, {
      tmdbId: 502, type: "tv", titleRu: "Упала", titleOriginal: "Failed", year: "2023",
      posterPath: null, overview: "", tmdbStatus: null,
      qualityPresetId: 1, voiceover: "any", monitorRule: "all",
    });
    syncEpisodes(db, tv.id, [{ season: 1, episode: 1, airDate: "2023-01-01", name: "" }], "all", TODAY);
    const ep = listEpisodes(db, tv.id)[0];
    const d = createDownload(db, {
      titleId: tv.id, releaseGuid: "g-failed", releaseTitle: "rel",
      episodesCovered: [ep.id], voiceoverStudio: null, qualitySource: null, qualityResolution: null,
    });
    updateDownload(db, d.id, { status: "failed", error: "boom" });
    expect(selectCandidates(db, TODAY).some((x) => x.title.id === tv.id)).toBe(true);
  });

  test("фильм с активной загрузкой → не кандидат", () => {
    const movie = addTitle(db, {
      tmdbId: 503, type: "movie", titleRu: "ФильмКач", titleOriginal: "MovieDl", year: "2020",
      posterPath: null, overview: "", tmdbStatus: null,
      qualityPresetId: 1, voiceover: "any", monitorRule: "all",
    });
    createDownload(db, {
      titleId: movie.id, releaseGuid: "g-movie-active", releaseTitle: "rel",
      episodesCovered: [], voiceoverStudio: null, qualitySource: null, qualityResolution: null,
    });
    expect(selectCandidates(db, TODAY).some((x) => x.title.id === movie.id)).toBe(false);
  });
});

describe("runTitle", () => {
  test("находит подходящую раздачу → grab + history", async () => {
    const tv = addTitle(db, {
      tmdbId: 300, type: "tv", titleRu: "Ран", titleOriginal: "Run", year: "2020",
      posterPath: null, overview: "", tmdbStatus: null,
      qualityPresetId: 1, voiceover: "Сыендук", monitorRule: "all",
    });
    syncEpisodes(db, tv.id, [{ season: 1, episode: 1, airDate: "2020-01-01", name: "" }], "all", TODAY);

    const search = vi.fn().mockResolvedValue([
      rawRel({
        title: "Run.S01.1080p.WEB-DL",
        description: "Ран / Run / Сезон: 1 / Серии: 1-10 из 10 [2020, WEB-DL, 1080p] VO (Сыендук) + Original",
        guid: "ok",
        seeders: 20,
      }),
      rawRel({
        title: "Run.S01.1080p.WEB-DL",
        description: "Ран / Run / Сезон: 1 / Серии: 1-10 из 10 [2020, WEB-DL, 1080p] VO (HDrezka)",
        guid: "wrong",
      }),
    ].map(parseRelease));
    const grab = vi.fn().mockResolvedValue(undefined);

    const cand = selectCandidates(db, TODAY).find((x) => x.title.id === tv.id)!;
    await runTitle(db, cand, { search, grab, minSeeders: 1, now: new Date("2024-06-01T00:00:00Z") });

    expect(search).toHaveBeenCalledWith("Run");
    expect(grab).toHaveBeenCalledTimes(1);
    const grabArg = grab.mock.calls[0][0];
    expect(grabArg.guid).toBe("ok");
    expect(grabArg.voiceoverStudio).toBe("Сыендук");
    const kinds = listHistory(db, 20, 0).filter((h) => h.titleId === tv.id).map((h) => h.kind);
    expect(kinds).toContain("search");
    expect(kinds).toContain("grab");
  });

  test("раздача не покрывает ни одной нужной серии → not_found", async () => {
    const tv = addTitle(db, {
      tmdbId: 302, type: "tv", titleRu: "Уидоус-Бэй", titleOriginal: "Widows Bay", year: "2024",
      posterPath: null, overview: "", tmdbStatus: null,
      qualityPresetId: 1, voiceover: "any", monitorRule: "manual",
    });
    syncEpisodes(db, tv.id, [
      { season: 1, episode: 9, airDate: "2023-12-01", name: "" },
      { season: 1, episode: 10, airDate: "2023-12-08", name: "" },
    ], "all", TODAY);

    const search = vi.fn().mockResolvedValue([
      parseRelease(rawRel({
        title: "Widows.Bay.S01.1080p.WEB-DL",
        description: "Уидоус-Бэй / Widows Bay / Сезон: 1 / Серии: 1-8 из 10 [2024, WEB-DL, 1080p] MVO (LostFilm)",
        guid: "pack-1-8",
        seeders: 30,
      })),
    ]);
    const grab = vi.fn();
    const cand = selectCandidates(db, TODAY).find((x) => x.title.id === tv.id)!;
    await runTitle(db, cand, { search, grab, minSeeders: 1, now: new Date() });
    expect(grab).not.toHaveBeenCalled();
    expect(listHistory(db, 50, 0).some((h) => h.titleId === tv.id && h.kind === "not_found")).toBe(true);
  });

  test("episodesCovered — только нужные серии в диапазоне раздачи", async () => {
    const tv = addTitle(db, {
      tmdbId: 303, type: "tv", titleRu: "Диапазон", titleOriginal: "Ranged", year: "2023",
      posterPath: null, overview: "", tmdbStatus: null,
      qualityPresetId: 1, voiceover: "any", monitorRule: "all",
    });
    syncEpisodes(db, tv.id, [
      { season: 1, episode: 7, airDate: "2023-11-01", name: "" },
      { season: 1, episode: 8, airDate: "2023-11-08", name: "" },
      { season: 1, episode: 9, airDate: "2023-11-15", name: "" },
      { season: 1, episode: 10, airDate: "2023-11-22", name: "" },
    ], "all", TODAY);

    const search = vi.fn().mockResolvedValue([
      parseRelease(rawRel({
        title: "Ranged.S01.1080p.WEB-DL",
        description: "Диапазон / Ranged / Сезон: 1 / Серии: 1-8 из 10 [2023, WEB-DL, 1080p] MVO (LostFilm)",
        guid: "pack-1-8-ranged",
        seeders: 30,
      })),
    ]);
    const grab = vi.fn().mockResolvedValue(undefined);
    const cand = selectCandidates(db, TODAY).find((x) => x.title.id === tv.id)!;
    await runTitle(db, cand, { search, grab, minSeeders: 1, now: new Date() });

    expect(grab).toHaveBeenCalledTimes(1);
    const covered: number[] = grab.mock.calls[0][0].episodesCovered;
    const eps = listEpisodes(db, tv.id);
    const numOf = (id: number) => eps.find((e) => e.id === id)?.episode;
    expect(covered.map(numOf).sort((a, b) => a! - b!)).toEqual([7, 8]);

    // те же серии передаём как wantedEpisodes (для выборочного скачивания пака)
    const wanted: { season: number; episode: number }[] = grab.mock.calls[0][0].wantedEpisodes;
    expect(wanted.map((e) => e.episode).sort((a, b) => a - b)).toEqual([7, 8]);
    expect(wanted.every((e) => e.season === 1)).toBe(true);
  });

  test("ничего не подошло → history not_found, grab не зван", async () => {
    const tv = addTitle(db, {
      tmdbId: 301, type: "tv", titleRu: "Пусто", titleOriginal: "Empty", year: "2020",
      posterPath: null, overview: "", tmdbStatus: null,
      qualityPresetId: 1, voiceover: "Сыендук", monitorRule: "all",
    });
    syncEpisodes(db, tv.id, [{ season: 1, episode: 1, airDate: "2020-01-01", name: "" }], "all", TODAY);
    const search = vi.fn().mockResolvedValue([
      parseRelease(rawRel({
        title: "Empty.S01.1080p.WEB-DL",
        description: "Пусто / Empty / Сезон: 1 [2020, WEB-DL, 1080p] VO (HDrezka)",
        guid: "x",
      })),
    ]);
    const grab = vi.fn();
    const cand = selectCandidates(db, TODAY).find((x) => x.title.id === tv.id)!;
    await runTitle(db, cand, { search, grab, minSeeders: 1, now: new Date() });
    expect(grab).not.toHaveBeenCalled();
    expect(listHistory(db, 50, 0).some((h) => h.titleId === tv.id && h.kind === "not_found")).toBe(true);
  });
});
