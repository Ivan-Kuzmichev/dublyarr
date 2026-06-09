import { and, asc, eq, inArray } from "drizzle-orm";
import type { TmdbEpisode } from "../tmdb.js";
import type { Db } from "./index.js";
import { episodes, titles } from "./schema.js";

export type MonitorRule = "all" | "future_only" | "manual";
export type TitleType = "movie" | "tv";

export type Title = typeof titles.$inferSelect;

export interface TitleInput {
  tmdbId: number;
  type: TitleType;
  titleRu: string;
  titleOriginal: string;
  year: string;
  posterPath: string | null;
  overview: string;
  tmdbStatus: string | null;
  qualityPresetId: number;
  voiceover: string;
  monitorRule: MonitorRule;
}

export interface Episode {
  id: number;
  titleId: number;
  season: number;
  episode: number;
  airDate: string | null;
  nameRu: string;
  wanted: boolean;
  fileId: number | null;
}

export function addTitle(db: Db, input: TitleInput): Title {
  return db.insert(titles).values(input).returning().get();
}

export function getTitle(db: Db, id: number): Title | null {
  return db.select().from(titles).where(eq(titles.id, id)).get() ?? null;
}

export function getTitleByTmdb(db: Db, type: TitleType, tmdbId: number): Title | null {
  return (
    db
      .select()
      .from(titles)
      .where(and(eq(titles.type, type), eq(titles.tmdbId, tmdbId)))
      .get() ?? null
  );
}

export function listTrackedTitles(db: Db): Title[] {
  return db
    .select()
    .from(titles)
    .where(eq(titles.tracked, 1))
    .orderBy(asc(titles.titleRu))
    .all();
}

/** Ключи вида "tv:60625" для бейджа «✓ отслеживается» в поиске. */
export function listTrackedTmdbKeys(db: Db): Set<string> {
  const rows = db
    .select({ type: titles.type, tmdbId: titles.tmdbId })
    .from(titles)
    .where(eq(titles.tracked, 1))
    .all();
  return new Set(rows.map((r) => `${r.type}:${r.tmdbId}`));
}

export interface TitlePatch {
  voiceover?: string;
  qualityPresetId?: number;
  monitorRule?: MonitorRule;
}

export function updateTitle(db: Db, id: number, patch: TitlePatch): Title | null {
  if (Object.keys(patch).length === 0) return getTitle(db, id);
  return (
    db.update(titles).set(patch).where(eq(titles.id, id)).returning().get() ?? null
  );
}

export function deleteTitle(db: Db, id: number): void {
  db.delete(titles).where(eq(titles.id, id)).run();
}

function wantedFor(rule: MonitorRule, airDate: string | null, today: string): number {
  if (rule === "manual") return 0;
  if (rule === "all") return 1;
  return airDate === null || airDate > today ? 1 : 0;
}

/** Upsert эпизодов из TMDb: метаданные обновляются, wanted у существующих не трогаем. */
export function syncEpisodes(
  db: Db,
  titleId: number,
  eps: TmdbEpisode[],
  rule: MonitorRule,
  today: string = new Date().toISOString().slice(0, 10),
): void {
  for (const e of eps) {
    db.insert(episodes)
      .values({
        titleId,
        season: e.season,
        episode: e.episode,
        airDate: e.airDate,
        nameRu: e.name,
        wanted: wantedFor(rule, e.airDate, today),
      })
      .onConflictDoUpdate({
        target: [episodes.titleId, episodes.season, episodes.episode],
        set: { airDate: e.airDate, nameRu: e.name },
      })
      .run();
  }
}

function rowToEpisode(row: typeof episodes.$inferSelect): Episode {
  return { ...row, wanted: row.wanted === 1 };
}

export function listEpisodes(db: Db, titleId: number): Episode[] {
  return db
    .select()
    .from(episodes)
    .where(eq(episodes.titleId, titleId))
    .orderBy(asc(episodes.season), asc(episodes.episode))
    .all()
    .map(rowToEpisode);
}

export function setEpisodesWanted(
  db: Db,
  titleId: number,
  episodeIds: number[],
  wanted: boolean,
): void {
  if (episodeIds.length === 0) return;
  db.update(episodes)
    .set({ wanted: wanted ? 1 : 0 })
    .where(and(eq(episodes.titleId, titleId), inArray(episodes.id, episodeIds)))
    .run();
}

export function setSeasonWanted(
  db: Db,
  titleId: number,
  season: number,
  wanted: boolean,
): void {
  db.update(episodes)
    .set({ wanted: wanted ? 1 : 0 })
    .where(and(eq(episodes.titleId, titleId), eq(episodes.season, season)))
    .run();
}
