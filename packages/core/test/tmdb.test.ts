import { afterEach, describe, expect, test, vi } from "vitest";
import {
  TmdbError,
  normalizeDetails,
  normalizeSearchResults,
  normalizeSeasonEpisodes,
  searchMulti,
} from "../src/tmdb.js";

describe("normalizeSearchResults", () => {
  test("фильтрует не-movie/tv, сортирует по популярности, маппит поля", () => {
    const raw = {
      results: [
        { media_type: "person", id: 1, name: "Актёр", popularity: 99 },
        {
          media_type: "tv", id: 60625, name: "Рик и Морти",
          original_name: "Rick and Morty", first_air_date: "2013-12-02",
          overview: "Учёный Рик...", popularity: 100,
          poster_path: "/poster.jpg", vote_average: 8.7,
        },
        {
          media_type: "movie", id: 2, title: "Дюна 3",
          original_title: "Dune 3", release_date: "2026-12-01",
          overview: "", popularity: 200, poster_path: null, vote_average: 0,
        },
      ],
    };
    const out = normalizeSearchResults(raw);
    expect(out.map((r) => r.id)).toEqual([2, 60625]);
    expect(out[1]).toEqual({
      id: 60625,
      type: "tv",
      title: "Рик и Морти",
      originalTitle: "Rick and Morty",
      year: "2013",
      overview: "Учёный Рик...",
      posterPath: "/poster.jpg",
      rating: 8.7,
      popularity: 100,
    });
  });
});

describe("normalizeDetails", () => {
  test("tv: сезоны, статус, external_ids", () => {
    const out = normalizeDetails("tv", 60625, {
      name: "Рик и Морти", original_name: "Rick and Morty",
      overview: "...", first_air_date: "2013-12-02", last_air_date: "2026-06-08",
      number_of_seasons: 9, number_of_episodes: 91, status: "Returning Series",
      genres: [{ name: "Анимация" }, { name: "Комедия" }],
      poster_path: "/poster.jpg", vote_average: 8.7,
      external_ids: { imdb_id: "tt2861424", tvdb_id: 275274 },
    });
    expect(out).toMatchObject({
      id: 60625, type: "tv", title: "Рик и Морти",
      originalTitle: "Rick and Morty", year: "2013",
      seasons: 9, episodes: 91, status: "Returning Series",
      genres: ["Анимация", "Комедия"], imdbId: "tt2861424", tvdbId: 275274,
      posterPath: "/poster.jpg", rating: 8.7,
    });
  });
});

describe("normalizeSeasonEpisodes", () => {
  test("маппит эпизоды сезона", () => {
    const out = normalizeSeasonEpisodes({
      season_number: 1,
      episodes: [
        { season_number: 1, episode_number: 1, air_date: "2013-12-02", name: "Пилот" },
        { season_number: 1, episode_number: 2, air_date: null, name: "" },
      ],
    });
    expect(out).toEqual([
      { season: 1, episode: 1, airDate: "2013-12-02", name: "Пилот" },
      { season: 1, episode: 2, airDate: null, name: "" },
    ]);
  });

  test("нет episodes → пустой массив", () => {
    expect(normalizeSeasonEpisodes({})).toEqual([]);
  });
});

describe("TmdbError", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("не-2xx ответ → TmdbError со status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response('{"status_message":"not found"}', {
          status: 404,
          statusText: "Not Found",
        }),
      ),
    );
    const err = await searchMulti("x", "key").catch((e) => e);
    expect(err).toBeInstanceOf(TmdbError);
    expect((err as TmdbError).status).toBe(404);
    expect((err as TmdbError).message).toContain("404");
  });
});
