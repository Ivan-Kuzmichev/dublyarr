import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

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
