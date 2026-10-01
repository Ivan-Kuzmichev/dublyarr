import type { ParsedRelease } from '../parse/types';
import type { MatchResult } from '../match-types';
import type { Profile } from '../profile';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** Время — миллисекунды unix. */
const ts = (name: string) => integer(name, { mode: 'number' });

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  totpSecretEnc: text('totp_secret_enc'),
  totpEnabled: integer('totp_enabled', { mode: 'boolean' }).notNull().default(false),
  totpLastStep: integer('totp_last_step'),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(), // sha256(token) hex
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  persistent: integer('persistent', { mode: 'boolean' }).notNull(),
  userAgent: text('user_agent'),
  ip: text('ip'),
  createdAt: ts('created_at').notNull(),
  lastSeenAt: ts('last_seen_at').notNull(),
  expiresAt: ts('expires_at').notNull(),
});

export const pendingLogins = sqliteTable('pending_logins', {
  id: text('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  remember: integer('remember', { mode: 'boolean' }).notNull(),
  expiresAt: ts('expires_at').notNull(),
});

export const trustedDevices = sqliteTable('trusted_devices', {
  id: text('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  userAgent: text('user_agent'),
  createdAt: ts('created_at').notNull(),
  expiresAt: ts('expires_at').notNull(),
});

export const authFailures = sqliteTable(
  'auth_failures',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    key: text('key').notNull(), // 'ip:1.2.3.4' | 'user:admin'
    at: ts('at').notNull(),
  },
  (t) => [index('auth_failures_key_at').on(t.key, t.at)],
);

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(), // JSON или v1:... для секретов
  encrypted: integer('encrypted', { mode: 'boolean' }).notNull().default(false),
  updatedAt: ts('updated_at').notNull(),
});

export const sources = sqliteTable('sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  url: text('url').notNull(),
  apiKeyEnc: text('api_key_enc'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  timeoutMs: integer('timeout_ms').notNull().default(15000),
  createdAt: ts('created_at').notNull(),
});

export const jobs = sqliteTable(
  'jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type').notNull(),
    payload: text('payload').notNull().default('{}'),
    status: text('status', { enum: ['queued', 'running', 'done', 'failed'] })
      .notNull()
      .default('queued'),
    runAt: ts('run_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [index('jobs_status_run_at').on(t.status, t.runAt)],
);

export const heartbeats = sqliteTable('heartbeats', {
  name: text('name').primaryKey(), // 'worker' | 'laya'
  ok: integer('ok', { mode: 'boolean' }).notNull(),
  info: text('info'),
  at: ts('at').notNull(),
});

// Каталог TMDB (фаза 1a)

const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();

export const titles = sqliteTable('titles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tmdbId: integer('tmdb_id').notNull().unique(),
  kind: text('kind', { enum: ['series', 'anime'] }).notNull(),
  kindManual: integer('kind_manual', { mode: 'boolean' }).notNull().default(false),
  nameRu: text('name_ru').notNull(),
  nameOriginal: text('name_original').notNull(),
  originalLanguage: text('original_language').notNull(),
  altNames: json<string[]>('alt_names').notNull().default([]),
  year: integer('year'),
  status: text('status', { enum: ['returning', 'ended', 'canceled', 'in_production', 'planned'] }).notNull(),
  overview: text('overview').notNull().default(''),
  genres: json<string[]>('genres').notNull().default([]),
  originCountries: json<string[]>('origin_countries').notNull().default([]),
  networks: json<string[]>('networks').notNull().default([]),
  posterPath: text('poster_path'),
  backdropPath: text('backdrop_path'),
  nextAirDate: text('next_air_date'),
  lastAirDate: text('last_air_date'),
  refreshedAt: ts('refreshed_at').notNull(),
  createdAt: ts('created_at').notNull(),
});

export const seasons = sqliteTable(
  'seasons',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    titleId: integer('title_id')
      .notNull()
      .references(() => titles.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    name: text('name').notNull(),
    airDate: text('air_date'),
    episodeCount: integer('episode_count').notNull().default(0),
    posterPath: text('poster_path'),
  },
  (t) => [uniqueIndex('seasons_title_number').on(t.titleId, t.number)],
);

export const episodes = sqliteTable(
  'episodes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    titleId: integer('title_id')
      .notNull()
      .references(() => titles.id, { onDelete: 'cascade' }),
    season: integer('season').notNull(),
    number: integer('number').notNull(),
    name: text('name').notNull(),
    airDate: text('air_date'),
    runtime: integer('runtime'),
  },
  (t) => [uniqueIndex('episodes_title_season_number').on(t.titleId, t.season, t.number)],
);

export type Title = typeof titles.$inferSelect;
export type Season = typeof seasons.$inferSelect;
export type Episode = typeof episodes.$inferSelect;

// Подписки и словарь студий (фаза 1b)

export const studios = sqliteTable('studios', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  aliases: json<string[]>('aliases').notNull().default([]),
  kind: text('kind', { enum: ['series', 'anime', 'both'] }).notNull(),
  trackers: json<string[]>('trackers').notNull().default([]),
  source: text('source', { enum: ['seed', 'manual', 'laya'] }).notNull(),
  confirmed: integer('confirmed', { mode: 'boolean' }).notNull().default(true),
  createdAt: ts('created_at').notNull(),
});

export const subscriptions = sqliteTable('subscriptions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  titleId: integer('title_id')
    .notNull()
    .unique()
    .references(() => titles.id, { onDelete: 'cascade' }),
  profile: json<Profile>('profile').notNull(),
  subscribedAt: ts('subscribed_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
});

export type Studio = typeof studios.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;

// Поиск раздач (фаза 1c)

export const trackers = sqliteTable(
  'trackers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceId: integer('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    indexerId: text('indexer_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['series', 'anime', 'both', 'unknown'] })
      .notNull()
      .default('unknown'),
    role: text('role', { enum: ['primary', 'backup'] }).notNull(),
    lastOkAt: ts('last_ok_at'),
    lastError: text('last_error'),
    lastErrorAt: ts('last_error_at'),
  },
  (t) => [uniqueIndex('trackers_source_indexer').on(t.sourceId, t.indexerId)],
);

export const releases = sqliteTable(
  'releases',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    titleId: integer('title_id')
      .notNull()
      .references(() => titles.id, { onDelete: 'cascade' }),
    sourceId: integer('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    trackerId: integer('tracker_id').references(() => trackers.id, { onDelete: 'set null' }),
    trackerName: text('tracker_name').notNull(),
    title: text('title').notNull(),
    attrs: json<Record<string, string | string[]>>('attrs').notNull().default({}),
    size: integer('size').notNull(),
    seeders: integer('seeders'),
    peers: integer('peers'),
    infohash: text('infohash'),
    downloadEnc: text('download_enc'), // ссылка на .torrent содержит ключ источника — хранится зашифрованной
    magnet: text('magnet'),
    detailsUrl: text('details_url'),
    publishedAt: ts('published_at'),
    firstSeenAt: ts('first_seen_at').notNull(),
    lastSeenAt: ts('last_seen_at').notNull(),
    parsed: json<ParsedRelease>('parsed').notNull(),
    match: json<MatchResult>('match').notNull(),
  },
  (t) => [
    uniqueIndex('releases_title_infohash').on(t.titleId, t.infohash),
    uniqueIndex('releases_title_tracker_name_size').on(t.titleId, t.trackerName, t.title, t.size),
  ],
);

export const releaseRules = sqliteTable(
  'release_rules',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    titleId: integer('title_id')
      .notNull()
      .references(() => titles.id, { onDelete: 'cascade' }),
    trackerName: text('tracker_name'), // null — любой трекер
    pattern: text('pattern').notNull(), // нормализованная основа заголовка
    verdict: text('verdict', { enum: ['match', 'reject'] }).notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [uniqueIndex('release_rules_unique').on(t.titleId, t.trackerName, t.pattern)],
);

export type Tracker = typeof trackers.$inferSelect;
export type Release = typeof releases.$inferSelect;
export type ReleaseRule = typeof releaseRules.$inferSelect;
