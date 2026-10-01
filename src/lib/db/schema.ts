import type { ParsedRelease } from '../parse/types';
import type { MatchResult } from '../match-types';
import type { Profile } from '../profile';
import type { MovieProfile } from '../movie-profile';
import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

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
  failingSince: ts('failing_since'), // с какого момента источник не отвечает
  downNotified: integer('down_notified', { mode: 'boolean' }).notNull().default(false),
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

export const titles = sqliteTable(
  'titles',
  {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tmdbId: integer('tmdb_id').notNull(),
  tmdbType: text('tmdb_type', { enum: ['tv', 'movie'] }).notNull().default('tv'), // id сериалов и фильмов в TMDB пересекаются
  kind: text('kind', { enum: ['series', 'anime', 'movie'] }).notNull(),
  kindManual: integer('kind_manual', { mode: 'boolean' }).notNull().default(false),
  nameRu: text('name_ru').notNull(),
  nameOriginal: text('name_original').notNull(),
  originalLanguage: text('original_language').notNull(),
  altNames: json<string[]>('alt_names').notNull().default([]),
  year: integer('year'),
  status: text('status', { enum: ['returning', 'ended', 'canceled', 'in_production', 'planned', 'released'] }).notNull(),
  overview: text('overview').notNull().default(''),
  genres: json<string[]>('genres').notNull().default([]),
  originCountries: json<string[]>('origin_countries').notNull().default([]),
  networks: json<string[]>('networks').notNull().default([]),
  posterPath: text('poster_path'),
  backdropPath: text('backdrop_path'),
  nextAirDate: text('next_air_date'),
  lastAirDate: text('last_air_date'),
  runtime: integer('runtime'), // фильм: минуты
  releaseDates: json<{ theatrical: string | null; digital: string | null; physical: string | null }>('release_dates'), // фильм: TMDB release_dates
  digitalSeenAt: text('digital_seen_at'), // фильм: первая цифровая раздача на трекерах
  refreshedAt: ts('refreshed_at').notNull(),
  createdAt: ts('created_at').notNull(),
  },
  (t) => [uniqueIndex('titles_tmdb').on(t.tmdbType, t.tmdbId)],
);

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
  profile: json<Profile | MovieProfile>('profile').notNull(), // фильм — MovieProfile (type: 'movie')
  maxSeason: integer('max_season'),
  lastSearchedAt: ts('last_searched_at'),
  keepAll: integer('keep_all', { mode: 'boolean' }).notNull().default(false), // исключение: хранить все сезоны
  autoDelete: integer('auto_delete', { mode: 'boolean' }).notNull().default(false), // удалять через N дней после скачивания // последний сезон, на который распространяется подписка (null — без границы)
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

// Загрузки (фаза 1d)

export type EpisodeRef = { season: number; number: number };

export const downloads = sqliteTable(
  'downloads',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    hash: text('hash').notNull().unique(),
    titleId: integer('title_id')
      .notNull()
      .references(() => titles.id, { onDelete: 'cascade' }),
    releaseId: integer('release_id').references(() => releases.id, { onDelete: 'set null' }),
    season: integer('season').notNull(),
    kind: text('kind', { enum: ['episode', 'pack', 'season', 'movie'] }).notNull(),
    episodes: json<EpisodeRef[]>('episodes').notNull().default([]), // что из этой раздачи нужно
    files: json<DownloadFile[]>('files'), // снимок файлов раздачи с приоритетами
    state: text('state', { enum: ['adding', 'downloading', 'paused', 'stalled', 'completed', 'imported', 'error', 'removed', 'replaced'] }).notNull(),
    progress: real('progress').notNull().default(0),
    dlSpeed: integer('dl_speed').notNull().default(0),
    eta: integer('eta'),
    size: integer('size').notNull(),
    name: text('name').notNull(),
    contentPath: text('content_path'),
    studioLabel: text('studio_label'),
    resolution: integer('resolution'),
    addedAt: ts('added_at').notNull(),
    completedAt: ts('completed_at'),
    importedAt: ts('imported_at'),
    lastSeededAt: ts('last_seeded_at'),
    lastError: text('last_error'),
    dubPosition: integer('dub_position'),
    pausedBySchedule: integer('paused_by_schedule', { mode: 'boolean' }).notNull().default(false),
    processing: integer('processing', { mode: 'boolean' }).notNull().default(false), // идёт пересборка
    replacedById: integer('replaced_by_id').references((): AnySQLiteColumn => downloads.id, { onDelete: 'set null' }),
    note: text('note'),
  },
  (t) => [index('downloads_title_state').on(t.titleId, t.state)],
);

export const episodeFiles = sqliteTable(
  'episode_files',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    titleId: integer('title_id')
      .notNull()
      .references(() => titles.id, { onDelete: 'cascade' }),
    season: integer('season').notNull(),
    number: integer('number').notNull(),
    path: text('path').notNull(), // относительно медиатеки
    size: integer('size').notNull(),
    downloadId: integer('download_id').references(() => downloads.id, { onDelete: 'set null' }),
    studioLabel: text('studio_label'),
    resolution: integer('resolution'),
    method: text('method', { enum: ['hardlink', 'copy'] }).notNull(),
    importedAt: ts('imported_at').notNull(),
    dubPosition: integer('dub_position'), // позиция профиля, по которой взята серия
    processed: integer('processed', { mode: 'boolean' }).notNull().default(false), // пересобран mkvmerge
    hdr: integer('hdr', { mode: 'boolean' }).notNull().default(false),
    duration: integer('duration'), // секунды, по ffprobe
    tracks: json<{ before: { kind: string; name: string; flag?: string }[]; after: { kind: string; name: string; flag?: string }[] }>('tracks'),
  },
  (t) => [uniqueIndex('episode_files_title_season_number').on(t.titleId, t.season, t.number)],
);

export const wantedState = sqliteTable(
  'wanted_state',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    titleId: integer('title_id')
      .notNull()
      .references(() => titles.id, { onDelete: 'cascade' }),
    season: integer('season').notNull(),
    number: integer('number').notNull(),
    state: text('state', { enum: ['waiting', 'missing', 'ask'] }).notNull(),
    reason: text('reason').notNull(),
    until: text('until'), // дата открытия ближайшей позиции (для waiting)
    releaseId: integer('release_id').references(() => releases.id, { onDelete: 'set null' }), // о какой раздаче вопрос (для ask)
    checkedAt: ts('checked_at').notNull(),
  },
  (t) => [uniqueIndex('wanted_state_title_season_number').on(t.titleId, t.season, t.number)],
);

export type Download = typeof downloads.$inferSelect;
export type EpisodeFile = typeof episodeFiles.$inferSelect;
export type WantedState = typeof wantedState.$inferSelect;

export type DownloadFile = { index: number; name: string; size: number; priority: number };

/** Когда Dublyarr впервые увидел серию в озвучке студии (spec §9). */
export const studioSightings = sqliteTable(
  'studio_sightings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    titleId: integer('title_id')
      .notNull()
      .references(() => titles.id, { onDelete: 'cascade' }),
    studioId: integer('studio_id')
      .notNull()
      .references(() => studios.id, { onDelete: 'cascade' }),
    season: integer('season').notNull(),
    number: integer('number').notNull(),
    seenAt: ts('seen_at').notNull(),
    basis: text('basis', { enum: ['seen', 'published'] }).notNull(),
    fromPack: integer('from_pack', { mode: 'boolean' }).notNull(),
  },
  (t) => [uniqueIndex('studio_sightings_key').on(t.titleId, t.studioId, t.season, t.number)],
);
export type StudioSighting = typeof studioSightings.$inferSelect;

/** Старые копии после улучшения, ждущие подтверждения правила (spec §8). */
export const oldCopies = sqliteTable('old_copies', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  titleId: integer('title_id')
    .notNull()
    .references(() => titles.id, { onDelete: 'cascade' }),
  season: integer('season').notNull(),
  number: integer('number').notNull(),
  path: text('path').notNull(), // относительно медиатеки, внутри .dublyarr-old
  size: integer('size').notNull(),
  reason: text('reason').notNull(),
  createdAt: ts('created_at').notNull(),
  // правило уже подтверждено, копия ждёт уборки («через 3 дня» / «при уборке»); false — ждёт подтверждения или оставлена пользователем
  due: integer('due', { mode: 'boolean' }).notNull().default(false),
});
export type OldCopy = typeof oldCopies.$inferSelect;

/** Заметки для «Сегодня» (и Telegram в 2d). */
export const notices = sqliteTable('notices', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  titleId: integer('title_id')
    .notNull()
    .references(() => titles.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['season-subscribed', 'season-not-included'] }).notNull(),
  text: text('text').notNull(),
  createdAt: ts('created_at').notNull(),
});

/** Очередь сообщений в Telegram (spec §12). */
export const notifications = sqliteTable(
  'notifications',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    key: text('key').notNull(), // от повторов: «import:42»
    kind: text('kind', { enum: ['downloaded', 'stuck', 'ask', 'original', 'source-down'] }).notNull(),
    text: text('text').notNull(),
    buttons: json<{ text: string; data?: string; url?: string }[][]>('buttons'),
    ref: json<Record<string, unknown>>('ref'),
    createdAt: ts('created_at').notNull(),
    nextAt: ts('next_at').notNull(),
    sentAt: ts('sent_at'),
    messageId: integer('message_id'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    answer: text('answer'),
  },
  (t) => [uniqueIndex('notifications_key').on(t.key), index('notifications_pending').on(t.sentAt, t.nextAt)],
);
export type Notification = typeof notifications.$inferSelect;

/** Серии, удалённые правилами хранения или вручную: поиск их больше не качает (до новой подписки). */
export const retiredEpisodes = sqliteTable(
  'retired_episodes',
  {
    titleId: integer('title_id')
      .notNull()
      .references(() => titles.id, { onDelete: 'cascade' }),
    season: integer('season').notNull(),
    number: integer('number').notNull(),
    at: ts('at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.titleId, t.season, t.number] })],
);

/** История удалений медиатеки («Недавно удалено»). */
export const deletions = sqliteTable('deletions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  titleId: integer('title_id').references(() => titles.id, { onDelete: 'set null' }),
  label: text('label').notNull(),
  why: text('why').notNull(),
  size: integer('size').notNull(),
  at: ts('at').notNull(),
});
