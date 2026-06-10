import { describe, expect, test } from "vitest";
import { parseRelease, type ParsedRelease } from "../src/parser.js";
import type { JackettRelease } from "../src/jackett.js";
import { pickBestRelease, releaseMatches, scoreRelease, type ScoreContext } from "../src/scoring.js";

function rel(over: Partial<JackettRelease> & { title: string }): ParsedRelease<JackettRelease> {
  const base: JackettRelease = {
    title: over.title,
    description: over.description ?? "Сериал на русском языке",
    indexer: over.indexer ?? "RuTracker",
    trackerType: "public",
    guid: over.guid ?? over.title,
    comments: "",
    pubDate: "",
    size: over.size ?? 1_000_000,
    seeders: over.seeders ?? 10,
    peers: 0,
    grabs: 0,
    link: over.link ?? `magnet:${over.title}`,
  };
  return parseRelease(base);
}

const ctx: ScoreContext = {
  allowed: ["webdl-1080p", "bluray-1080p", "hdtv-1080p"],
  preferred: "bluray-1080p",
  voiceover: "Сыендук",
  minSeeders: 2,
};

describe("releaseMatches", () => {
  test("совпадение озвучки + качество в allowed + сиды ≥ min", () => {
    const r = rel({ title: "S01 1080p BluRay", description: "Сериал [Сезон: 1] VO (Сыендук)", seeders: 5 });
    expect(releaseMatches(r, ctx)).toBe(true);
  });

  test("чужая озвучка → нет", () => {
    const r = rel({ title: "S01 1080p BluRay", description: "Сериал [Сезон: 1] VO (HDrezka)", seeders: 5 });
    expect(releaseMatches(r, ctx)).toBe(false);
  });

  test("voiceover=any принимает любую студию", () => {
    const r = rel({ title: "S01 1080p BluRay", description: "Сериал [Сезон: 1] VO (HDrezka)", seeders: 5 });
    expect(releaseMatches(r, { ...ctx, voiceover: "any" })).toBe(true);
  });

  test("качество вне allowed → нет", () => {
    const r = rel({ title: "S01 2160p WEB-DL", description: "Сериал [Сезон: 1] VO (Сыендук)", seeders: 5 });
    expect(releaseMatches(r, ctx)).toBe(false);
  });

  test("мало сидов → нет", () => {
    const r = rel({ title: "S01 1080p BluRay", description: "Сериал [Сезон: 1] VO (Сыендук)", seeders: 1 });
    expect(releaseMatches(r, ctx)).toBe(false);
  });
});

describe("scoreRelease", () => {
  test("ближе к preferred → выше", () => {
    const exact = rel({ title: "S01 1080p BluRay", description: "Сериал [Сезон: 1] VO (Сыендук)" });
    const far = rel({ title: "S01 1080p HDTV", description: "Сериал [Сезон: 1] VO (Сыендук)" });
    expect(scoreRelease(exact, ctx)).toBeGreaterThan(scoreRelease(far, ctx));
  });

  test("при равном качестве больше сидов → выше", () => {
    const more = rel({ title: "S01 1080p BluRay", description: "Сериал [Сезон: 1] VO (Сыендук)", seeders: 50 });
    const less = rel({ title: "S01 1080p BluRay", description: "Сериал [Сезон: 1] VO (Сыендук)", seeders: 5 });
    expect(scoreRelease(more, ctx)).toBeGreaterThan(scoreRelease(less, ctx));
  });
});

describe("pickBestRelease", () => {
  test("выбирает лучший из подходящих, игнорит blacklisted", () => {
    const good = rel({ title: "S01 1080p BluRay", description: "Сериал [Сезон: 1] VO (Сыендук)", guid: "g-good", seeders: 30 });
    const bad = rel({ title: "S01 1080p HDTV", description: "Сериал [Сезон: 1] VO (Сыендук)", guid: "g-bad", seeders: 5 });
    const wrongVo = rel({ title: "S01 1080p BluRay", description: "Сериал [Сезон: 1] VO (HDrezka)", guid: "g-wrong" });
    const best = pickBestRelease([bad, good, wrongVo], ctx, (guid) => guid === "g-good");
    // g-good в блэклисте → должен выбрать bad (единственный оставшийся подходящий)
    expect(best?.guid).toBe("g-bad");
  });

  test("нет подходящих → null", () => {
    const wrongVo = rel({ title: "S01 1080p BluRay", description: "Сериал [Сезон: 1] VO (HDrezka)" });
    expect(pickBestRelease([wrongVo], ctx, () => false)).toBeNull();
  });
});
