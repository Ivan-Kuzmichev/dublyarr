import { sql } from "drizzle-orm";
import {
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const qualityPresets = sqliteTable("quality_presets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  allowed: text("allowed").notNull(),
  preferred: text("preferred").notNull(),
  upgradeEnabled: integer("upgrade_enabled").notNull().default(0),
});

export const titles = sqliteTable(
  "titles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tmdbId: integer("tmdb_id").notNull(),
    type: text("type", { enum: ["movie", "tv"] }).notNull(),
    titleRu: text("title_ru").notNull(),
    titleOriginal: text("title_original").notNull(),
    year: text("year").notNull().default(""),
    posterPath: text("poster_path"),
    overview: text("overview").notNull().default(""),
    tmdbStatus: text("tmdb_status"),
    tracked: integer("tracked").notNull().default(1),
    qualityPresetId: integer("quality_preset_id")
      .notNull()
      .references(() => qualityPresets.id),
    voiceover: text("voiceover").notNull().default("any"),
    monitorRule: text("monitor_rule", { enum: ["all", "future_only", "manual"] })
      .notNull()
      .default("all"),
    rootFolder: text("root_folder"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [uniqueIndex("titles_tmdb_unique").on(t.tmdbId, t.type)],
);

export const episodes = sqliteTable(
  "episodes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    titleId: integer("title_id")
      .notNull()
      .references(() => titles.id, { onDelete: "cascade" }),
    season: integer("season").notNull(),
    episode: integer("episode").notNull(),
    airDate: text("air_date"),
    nameRu: text("name_ru").notNull().default(""),
    wanted: integer("wanted").notNull().default(0),
    fileId: integer("file_id"),
  },
  (t) => [uniqueIndex("episodes_unique").on(t.titleId, t.season, t.episode)],
);

export const files = sqliteTable("files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  titleId: integer("title_id")
    .notNull()
    .references(() => titles.id, { onDelete: "cascade" }),
  episodeId: integer("episode_id").references(() => episodes.id, {
    onDelete: "set null",
  }),
  path: text("path").notNull(),
  size: integer("size").notNull().default(0),
  qualitySource: text("quality_source"),
  qualityResolution: text("quality_resolution"),
  voiceoverStudio: text("voiceover_studio"),
  releaseGuid: text("release_guid"),
  downloadedAt: text("downloaded_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const downloads = sqliteTable("downloads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  titleId: integer("title_id")
    .notNull()
    .references(() => titles.id, { onDelete: "cascade" }),
  releaseGuid: text("release_guid").notNull().default(""),
  releaseTitle: text("release_title").notNull().default(""),
  qbitHash: text("qbit_hash"),
  tag: text("tag").notNull().unique(),
  episodesCovered: text("episodes_covered").notNull().default("[]"),
  voiceoverStudio: text("voiceover_studio"),
  qualitySource: text("quality_source"),
  qualityResolution: text("quality_resolution"),
  status: text("status", {
    enum: ["queued", "downloading", "completed", "failed", "imported"],
  })
    .notNull()
    .default("queued"),
  progress: real("progress").notNull().default(0),
  error: text("error"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});
