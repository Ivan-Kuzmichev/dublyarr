# Фаза 0 «Фундамент»: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** рабочий Docker-образ Dublyarr: вход (пароль + TOTP + сеансы), первый запуск, «Настройки → Безопасность»,
адаптивная оболочка (боковая/нижняя навигация) с дизайн-токенами, SQLite + миграции, шифрование секретов,
супервизор с воркером и заглушкой laya-serve.

**Architecture:** один pnpm-пакет. Next.js 16 (App Router) рендерит интерфейс и выполняет server actions; доменная логика —
чистые модули в `src/lib/*`, принимающие `db` параметром (тестируются на `:memory:`). Супервизор `src/entry/supervisor.ts`
применяет миграции и запускает дочерние процессы: `next start`, воркер (`src/worker`), `laya/serve.py`. Процессы делят
SQLite в режиме WAL. Воркер и CLI собираются esbuild в `dist/*.cjs`.

**Tech Stack:** Node 24, pnpm, Next.js 16.3, React 19, TypeScript (strict), Tailwind CSS 4, Drizzle ORM 0.45 + drizzle-kit,
better-sqlite3, @node-rs/argon2, qrcode, pino, Vitest, Playwright, esbuild, Python 3 (stdlib), Docker (linux/amd64).

**Spec:** `docs/spec.md` (§14 «Вход», §15), `docs/plan.md` (фаза 0), `design/README.md` (токены), `CLAUDE.md` (решения фазы 0).

## Global Constraints

- Все тексты интерфейса на русском.
- Тёмная тема, светлой нет. Цвета только из токенов `design/README.md` (таблица «Дизайн-токены»).
- Шрифты: заголовки Unbounded 500/600/700, текст Onest 400/500/600/700, цифры/коды JetBrains Mono 400/500.
- Цели нажатия ≥ 44 px. Радиусы: 8–12 px кнопки/плашки, 14–18 px карточки, 22–24 px модалки/шторки.
- Секреты (токены qBittorrent, Jackett, Telegram, TMDB, TOTP-секрет) — только в зашифрованном виде в БД или в env, никогда в логах.
- Резервных кодов нет. Восстановление доступа — `dublyarr reset-password [--disable-2fa]` внутри контейнера.
- TypeScript `strict: true`, без `any` в доменном коде.
- Том данных: `DATA_DIR` (по умолчанию `/data`), база `${DATA_DIR}/db.sqlite`.
- Образ только `linux/amd64`.
- Next.js 16: `cookies()`/`headers()` асинхронные; middleware называется `src/proxy.ts` и экспортирует функцию `proxy`.

## Review Focus

1. **Повторное использование TOTP-кода** (перехват кода за плечом) — тот же код в том же 30-секундном окне второй раз отклоняется. Тест в Task 5.
2. **NAS открыт по http в LAN** — cookie без `Secure`, иначе браузер их не сохранит и вход «молча» не работает; при `https`/`x-forwarded-proto: https` — с `Secure`. Тест в Task 7.
3. **Перебор пароля/кода** — после 10 неудачных попыток за 15 минут с одного IP или на один логин вход блокируется с понятным сообщением, даже при верном пароле. Тест в Task 6.
4. **Нет ключа шифрования в env и том `/data` пересоздан** — сгенерированный ключ сохраняется с правами 0600 и переживает перезапуск; расшифровка чужим ключом даёт понятную ошибку, а не мусор. Тест в Task 3.
5. **Повторный заход на `/setup` после создания аккаунта** (кто-то в LAN открыл мастер) — создать второго пользователя нельзя, `/setup` без сеанса отправляет на `/login`. Тест в Task 10.

---

## Структура файлов

```
package.json, pnpm-workspace.yaml (не нужен), tsconfig.json, next.config.ts, eslint.config.mjs,
vitest.config.ts, playwright.config.ts, drizzle.config.ts, postcss.config.mjs, esbuild.mjs, Dockerfile, .dockerignore
drizzle/                       сгенерированные SQL-миграции
laya/serve.py                  заглушка laya-serve (/health)
bin/dublyarr                   shell-обёртка CLI
src/lib/config.ts              env → конфиг
src/lib/log.ts                 pino + redact
src/lib/db/schema.ts           таблицы Drizzle
src/lib/db/client.ts           openDb / getDb / migrateDb
src/lib/crypto/key.ts          загрузка/генерация мастер-ключа
src/lib/crypto/secretbox.ts    encrypt/decrypt AES-256-GCM
src/lib/settings.ts            app_settings: get/set (+ шифрованные)
src/lib/auth/password.ts       argon2 hash/verify, правила пароля
src/lib/auth/totp.ts           RFC 6238, base32, otpauth URI
src/lib/auth/tokens.ts         случайные токены + sha256
src/lib/auth/sessions.ts       сеансы, ожидающие входы, доверенные устройства
src/lib/auth/ratelimit.ts      учёт неудачных попыток
src/lib/auth/users.ts          пользователь: создать, найти, сменить пароль, 2FA вкл/выкл
src/lib/auth/login.ts          сценарий входа (шаг пароля → шаг кода)
src/lib/auth/cookies.ts        имена/опции cookie, флаг Secure
src/lib/auth/current.ts        requireSession() для серверных компонентов/экшенов
src/lib/integrations/qbittorrent.ts  проверка подключения
src/lib/integrations/torznab.ts      проверка источника (t=caps)
src/lib/fs-check.ts            проверка папки на запись
src/lib/setup.ts               состояние мастера первого запуска
src/lib/heartbeat.ts           heartbeats процессов
src/worker/main.ts, src/worker/jobs.ts
src/entry/supervisor.ts, src/entry/backoff.ts
src/cli/main.ts, src/cli/reset-password.ts
src/proxy.ts
src/app/layout.tsx, src/app/globals.css, src/app/fonts.ts
src/app/login/page.tsx, src/app/login/2fa/page.tsx, src/app/login/actions.ts, src/app/login/AuthAside.tsx
src/app/setup/**               мастер
src/app/(app)/layout.tsx       AppShell + requireSession
src/app/(app)/page.tsx         «Сегодня» (заглушка)
src/app/(app)/{library,calendar,discover,activity,storage,more}/page.tsx  заглушки
src/app/(app)/settings/layout.tsx, [section]/page.tsx, security/page.tsx, security/actions.ts
src/components/ui/*.tsx        Button, Field, Checkbox, Segmented, Card, Table, Badge, CodeInput, Logo
src/components/shell/*.tsx     Sidebar, MobileTabs, AppShell, nav.ts, Placeholder
tests/unit/**                  Vitest
tests/e2e/auth.spec.ts         Playwright
```

---

### Task 1: Каркас проекта, токены, шрифты, тестовый контур

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`, `vitest.config.ts`,
  `src/app/layout.tsx`, `src/app/globals.css`, `src/app/fonts.ts`, `src/app/page.tsx` (временная), `tests/unit/smoke.test.ts`, `.env.example`

**Interfaces:**
- Produces: CSS-переменные/утилиты Tailwind `bg-bg, bg-surface, bg-surface-2, bg-sidebar, border-line, border-line-soft,
  border-line-strong, text-text, text-text-2, text-muted, text-faint, text-accent, bg-accent, text-on-accent, text-progress,
  text-danger, bg-danger-bg, border-danger-line, bg-destructive`, семейства `font-display` (Unbounded), `font-sans` (Onest), `font-mono` (JetBrains Mono).
- Скрипты: `pnpm dev`, `pnpm build`, `pnpm start`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm db:generate`, `pnpm e2e`.

- [ ] **Step 1: Инициализировать пакет и зависимости**

```bash
pnpm init
pnpm add next@16 react@19 react-dom@19 drizzle-orm better-sqlite3 @node-rs/argon2 qrcode pino
pnpm add -D typescript @types/node @types/react @types/react-dom @types/better-sqlite3 @types/qrcode \
  tailwindcss @tailwindcss/postcss eslint eslint-config-next vitest drizzle-kit esbuild tsx @playwright/test
```

В `package.json`:

```json
{
  "name": "dublyarr",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build && node esbuild.mjs",
    "start": "node dist/supervisor.cjs",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "db:generate": "drizzle-kit generate",
    "e2e": "playwright test"
  },
  "pnpm": { "onlyBuiltDependencies": ["better-sqlite3", "esbuild"] }
}
```

Если `next build` не принимает TypeScript 7 — зафиксировать `typescript@~5.9` и отметить в CLAUDE.md.

- [ ] **Step 2: Конфиги**

`tsconfig.json`: стандартный от Next (`"strict": true`, `"paths": {"@/*": ["./src/*"]}`, `"moduleResolution": "bundler"`).

`next.config.ts`:
```ts
import type { NextConfig } from 'next';
const config: NextConfig = {
  serverExternalPackages: ['better-sqlite3', '@node-rs/argon2'],
  poweredByHeader: false,
};
export default config;
```

`postcss.config.mjs`: `export default { plugins: { '@tailwindcss/postcss': {} } };`

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
```

`eslint.config.mjs`: flat-конфиг из `eslint-config-next` (`core-web-vitals` + `typescript`), игнор `dist/ .next/ drizzle/`.

- [ ] **Step 3: Токены и шрифты**

`src/app/fonts.ts`:
```ts
import { Onest, Unbounded, JetBrains_Mono } from 'next/font/google';
export const onest = Onest({ subsets: ['latin', 'cyrillic'], weight: ['400', '500', '600', '700'], variable: '--font-onest' });
export const unbounded = Unbounded({ subsets: ['latin', 'cyrillic'], weight: ['500', '600', '700'], variable: '--font-unbounded' });
export const mono = JetBrains_Mono({ subsets: ['latin', 'cyrillic'], weight: ['400', '500'], variable: '--font-mono-jb' });
```

`src/app/globals.css`:
```css
@import 'tailwindcss';

@theme {
  --color-bg: #121110;
  --color-surface: #1B1A18;
  --color-surface-2: #242220;
  --color-surface-3: #1F1D1B;
  --color-sidebar: #171614;
  --color-line: #2E2B28;
  --color-line-soft: #242220;
  --color-line-strong: #3A3632;
  --color-field-line: #34302C;
  --color-nav-active: #2A2622;
  --color-text: #F3EFE8;
  --color-text-2: #D9D3C9;
  --color-text-3: #B5AEA4;
  --color-muted: #A39C92;
  --color-faint: #8A847B;
  --color-accent: #F0A442;
  --color-accent-hover: #FFC577;
  --color-on-accent: #1A1206;
  --color-progress: #7FB2FF;
  --color-danger: #FF8A7A;
  --color-danger-bg: #1F1916;
  --color-danger-line: #4A2F28;
  --color-destructive: #E5654F;
  --font-sans: var(--font-onest), 'Segoe UI', system-ui, sans-serif;
  --font-display: var(--font-unbounded), 'Segoe UI', sans-serif;
  --font-mono: var(--font-mono-jb), ui-monospace, monospace;
}

html { color-scheme: dark; }
body { margin: 0; background: var(--color-bg); color: var(--color-text); font-family: var(--font-sans); }
a { color: var(--color-accent); }
a:hover { color: var(--color-accent-hover); }
button, input, select { font-family: inherit; }
```

`src/app/layout.tsx`:
```tsx
import type { Metadata, Viewport } from 'next';
import { onest, unbounded, mono } from './fonts';
import './globals.css';

export const metadata: Metadata = { title: 'Dublyarr' };
export const viewport: Viewport = { themeColor: '#121110', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${onest.variable} ${unbounded.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

Временная `src/app/page.tsx` — заголовок «Dublyarr» классом `font-display text-accent` (удаляется в Task 8).

- [ ] **Step 4: Смоук-тест**

`tests/unit/smoke.test.ts`:
```ts
import { expect, test } from 'vitest';
test('vitest работает', () => { expect(1 + 1).toBe(2); });
```

- [ ] **Step 5: Проверить**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm next build`
Expected: всё зелёное, сборка успешна.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: каркас Next.js, токены, шрифты, vitest"
```

---

### Task 2: Конфиг и логгер с маскировкой секретов

**Files:**
- Create: `src/lib/config.ts`, `src/lib/log.ts`
- Test: `tests/unit/config.test.ts`, `tests/unit/log.test.ts`

**Interfaces:**
- Produces:
  - `loadConfig(env?: NodeJS.ProcessEnv): Config`, `type Config = { dataDir: string; dbPath: string; port: number; layaPort: number; secretKeyEnv: string | undefined; logLevel: string }`
  - `getConfig(): Config` (кэш от `process.env`)
  - `createLogger(opts?: { level?: string; destination?: pino.DestinationStream; name?: string }): pino.Logger`, `log: pino.Logger`
  - `redactUrl(url: string): string` — маскирует `apikey`, `api_key`, `token`, `passkey`, `password` в query и user:pass в authority.

- [ ] **Step 1: Failing tests**

```ts
// tests/unit/config.test.ts
import { expect, test } from 'vitest';
import { loadConfig } from '@/lib/config';

test('значения по умолчанию', () => {
  const c = loadConfig({});
  expect(c.dataDir).toBe('/data');
  expect(c.dbPath).toBe('/data/db.sqlite');
  expect(c.port).toBe(3000);
  expect(c.layaPort).toBe(8765);
});

test('DATA_DIR и порты из env', () => {
  const c = loadConfig({ DATA_DIR: '/tmp/x', PORT: '8080', LAYA_PORT: '9000', DUBLYARR_SECRET_KEY: 'k' });
  expect(c.dbPath).toBe('/tmp/x/db.sqlite');
  expect(c.port).toBe(8080);
  expect(c.layaPort).toBe(9000);
  expect(c.secretKeyEnv).toBe('k');
});
```

```ts
// tests/unit/log.test.ts
import { expect, test } from 'vitest';
import { Writable } from 'node:stream';
import { createLogger, redactUrl } from '@/lib/log';

function capture() {
  const lines: string[] = [];
  const destination = new Writable({ write(chunk, _e, cb) { lines.push(String(chunk)); cb(); } });
  return { lines, destination };
}

test('секреты в полях маскируются', () => {
  const { lines, destination } = capture();
  const log = createLogger({ destination });
  log.info({ password: 'p1', apiKey: 'k1', qbit: { password: 'p2' }, headers: { cookie: 'SID=1', authorization: 'Bearer t' }, totpSecret: 's' }, 'x');
  const out = lines.join('');
  for (const s of ['p1', 'k1', 'p2', 'SID=1', 'Bearer t', '"s"']) expect(out).not.toContain(s);
});

test('redactUrl прячет ключи и логин:пароль', () => {
  expect(redactUrl('http://j:9117/api?t=caps&apikey=SECRET&q=a')).toBe('http://j:9117/api?t=caps&apikey=***&q=a');
  expect(redactUrl('http://user:pass@host/x')).toBe('http://***:***@host/x');
  expect(redactUrl('не url')).toBe('не url');
});
```

- [ ] **Step 2: Run** `pnpm vitest run tests/unit/config.test.ts tests/unit/log.test.ts` — FAIL (модулей нет).

- [ ] **Step 3: Implement**

```ts
// src/lib/config.ts
import path from 'node:path';
export type Config = { dataDir: string; dbPath: string; port: number; layaPort: number; secretKeyEnv: string | undefined; logLevel: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = env.DATA_DIR || '/data';
  return {
    dataDir,
    dbPath: path.join(dataDir, 'db.sqlite'),
    port: Number(env.PORT || 3000),
    layaPort: Number(env.LAYA_PORT || 8765),
    secretKeyEnv: env.DUBLYARR_SECRET_KEY || undefined,
    logLevel: env.LOG_LEVEL || 'info',
  };
}

let cached: Config | undefined;
export function getConfig(): Config { return (cached ??= loadConfig()); }
```

```ts
// src/lib/log.ts
import pino from 'pino';

const SECRET_KEYS = ['password', 'apiKey', 'apikey', 'token', 'secret', 'totpSecret', 'cookie', 'authorization', 'passkey'];
const paths = SECRET_KEYS.flatMap((k) => [k, `*.${k}`, `*.*.${k}`]);

export function createLogger(opts: { level?: string; destination?: pino.DestinationStream; name?: string } = {}) {
  return pino({ level: opts.level ?? process.env.LOG_LEVEL ?? 'info', name: opts.name, redact: { paths, censor: '***' } }, opts.destination);
}

export const log = createLogger({ name: process.env.DUBLYARR_PROCESS ?? 'web' });

const SECRET_PARAMS = /^(apikey|api_key|token|passkey|password)$/i;
export function redactUrl(raw: string): string {
  let u: URL;
  try { u = new URL(raw); } catch { return raw; }
  if (u.username || u.password) { u.username = '***'; u.password = '***'; }
  for (const k of [...u.searchParams.keys()]) if (SECRET_PARAMS.test(k)) u.searchParams.set(k, '***');
  return u.toString().replace(/%2A%2A%2A/g, '***');
}
```

- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: конфиг и логгер с маскировкой секретов"` (с `git add` новых файлов).

---

### Task 3: База данных, миграции, мастер-ключ и шифрование секретов

**Files:**
- Create: `drizzle.config.ts`, `src/lib/db/schema.ts`, `src/lib/db/client.ts`, `src/lib/crypto/key.ts`, `src/lib/crypto/secretbox.ts`, `src/lib/settings.ts`, `drizzle/*` (сгенерировано)
- Test: `tests/unit/db.test.ts`, `tests/unit/secretbox.test.ts`, `tests/unit/settings.test.ts`, `tests/unit/helpers.ts`

**Interfaces:**
- Produces:
  - `type Db = BetterSQLite3Database<typeof schema>`; `openDb(file: string): Db` (WAL, foreign_keys=ON, busy_timeout=5000); `migrateDb(db: Db): void`; `getDb(): Db` (синглтон на `getConfig().dbPath`, создаёт каталог).
  - Таблицы (`schema.ts`): `users`, `sessions`, `pendingLogins`, `trustedDevices`, `authFailures`, `appSettings`, `sources`, `jobs`, `heartbeats` — поля ниже.
  - `loadMasterKey(cfg: Pick<Config,'dataDir'|'secretKeyEnv'>): Buffer` (32 байта); `getMasterKey(): Buffer`.
  - `encrypt(plain: string, key?: Buffer): string` → `v1:<base64(iv|tag|ct)>`; `decrypt(box: string, key?: Buffer): string`; `class SecretDecryptError extends Error`.
  - `getSetting<T>(db, key): T | undefined`, `setSetting(db, key, value: unknown)`, `getSecretSetting<T>(db, key): T | undefined`, `setSecretSetting(db, key, value: unknown)`.
  - `tests/unit/helpers.ts`: `testDb(): Db` — `openDb(':memory:')` + `migrateDb`.

Схема:

```ts
// src/lib/db/schema.ts
import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';

const ts = (name: string) => integer(name, { mode: 'number' }); // миллисекунды unix

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
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  persistent: integer('persistent', { mode: 'boolean' }).notNull(),
  userAgent: text('user_agent'),
  ip: text('ip'),
  createdAt: ts('created_at').notNull(),
  lastSeenAt: ts('last_seen_at').notNull(),
  expiresAt: ts('expires_at').notNull(),
});

export const pendingLogins = sqliteTable('pending_logins', {
  id: text('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  remember: integer('remember', { mode: 'boolean' }).notNull(),
  expiresAt: ts('expires_at').notNull(),
});

export const trustedDevices = sqliteTable('trusted_devices', {
  id: text('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  userAgent: text('user_agent'),
  createdAt: ts('created_at').notNull(),
  expiresAt: ts('expires_at').notNull(),
});

export const authFailures = sqliteTable('auth_failures', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull(), // 'ip:1.2.3.4' | 'user:admin'
  at: ts('at').notNull(),
}, (t) => [index('auth_failures_key_at').on(t.key, t.at)]);

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

export const jobs = sqliteTable('jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  payload: text('payload').notNull().default('{}'),
  status: text('status', { enum: ['queued', 'running', 'done', 'failed'] }).notNull().default('queued'),
  runAt: ts('run_at').notNull(),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
}, (t) => [index('jobs_status_run_at').on(t.status, t.runAt)]);

export const heartbeats = sqliteTable('heartbeats', {
  name: text('name').primaryKey(), // 'worker' | 'laya'
  ok: integer('ok', { mode: 'boolean' }).notNull(),
  info: text('info'),
  at: ts('at').notNull(),
});
```

`drizzle.config.ts`: `{ dialect: 'sqlite', schema: './src/lib/db/schema.ts', out: './drizzle' }`.

- [ ] **Step 1: Failing tests**

```ts
// tests/unit/helpers.ts
import { openDb, migrateDb, type Db } from '@/lib/db/client';
export function testDb(): Db { const db = openDb(':memory:'); migrateDb(db); return db; }
```

```ts
// tests/unit/db.test.ts
import { expect, test } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb, migrateDb } from '@/lib/db/client';
import { users } from '@/lib/db/schema';

test('миграции создают таблицы, файл в WAL', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'dy-')), 'db.sqlite');
  const db = openDb(file);
  migrateDb(db);
  migrateDb(db); // идемпотентно
  db.insert(users).values({ username: 'a', passwordHash: 'h', createdAt: 1, updatedAt: 1 }).run();
  expect(db.select().from(users).all()).toHaveLength(1);
  expect(db.$client.pragma('journal_mode', { simple: true })).toBe('wal');
});
```

```ts
// tests/unit/secretbox.test.ts
import { expect, test } from 'vitest';
import { mkdtempSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt, SecretDecryptError } from '@/lib/crypto/secretbox';
import { loadMasterKey } from '@/lib/crypto/key';

const key = randomBytes(32);

test('шифрование туда-обратно, каждый раз разный шифротекст', () => {
  const a = encrypt('токен', key), b = encrypt('токен', key);
  expect(a).toMatch(/^v1:/);
  expect(a).not.toBe(b);
  expect(decrypt(a, key)).toBe('токен');
});

test('чужой ключ или испорченные данные — SecretDecryptError', () => {
  const box = encrypt('x', key);
  expect(() => decrypt(box, randomBytes(32))).toThrow(SecretDecryptError);
  expect(() => decrypt('v1:AAAA', key)).toThrow(SecretDecryptError);
  expect(() => decrypt('plain', key)).toThrow(SecretDecryptError);
});

test('ключ из env: base64 32 байта', () => {
  const k = randomBytes(32);
  expect(loadMasterKey({ dataDir: '/nonexistent', secretKeyEnv: k.toString('base64') }).equals(k)).toBe(true);
  expect(() => loadMasterKey({ dataDir: '/nonexistent', secretKeyEnv: 'short' })).toThrow(/32 байта/);
});

test('без env ключ генерируется в файл 0600 и переживает перезапуск', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dy-'));
  const k1 = loadMasterKey({ dataDir: dir, secretKeyEnv: undefined });
  const file = path.join(dir, 'secret.key');
  expect(statSync(file).mode & 0o777).toBe(0o600);
  const k2 = loadMasterKey({ dataDir: dir, secretKeyEnv: undefined });
  expect(k2.equals(k1)).toBe(true);
  expect(readFileSync(file, 'utf8').trim()).toBe(k1.toString('base64'));
});
```

```ts
// tests/unit/settings.test.ts
import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { getSetting, setSetting, getSecretSetting, setSecretSetting } from '@/lib/settings';
import { appSettings } from '@/lib/db/schema';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');

test('обычные и секретные настройки', () => {
  const db = testDb();
  setSetting(db, 'paths', { media: '/media' });
  expect(getSetting(db, 'paths')).toEqual({ media: '/media' });
  setSecretSetting(db, 'qbittorrent', { url: 'http://q', password: 'pw' });
  expect(getSecretSetting(db, 'qbittorrent')).toEqual({ url: 'http://q', password: 'pw' });
  const raw = db.select().from(appSettings).all().find((r) => r.key === 'qbittorrent')!;
  expect(raw.encrypted).toBe(true);
  expect(raw.value).not.toContain('pw');
  expect(getSetting(db, 'nope')).toBeUndefined();
});
```

- [ ] **Step 2: Run** `pnpm test` — FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/db/client.ts
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import * as schema from './schema';
import { getConfig } from '../config';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  return drizzle(sqlite, { schema }) as Db;
}

export function migrateDb(db: Db): void {
  const folder = process.env.DUBLYARR_MIGRATIONS ?? path.join(process.cwd(), 'drizzle');
  migrate(db, { migrationsFolder: folder });
}

const g = globalThis as unknown as { __dublyarrDb?: Db };
export function getDb(): Db { return (g.__dublyarrDb ??= openDb(getConfig().dbPath)); }
```

```ts
// src/lib/crypto/key.ts
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { getConfig, type Config } from '../config';

export function loadMasterKey(cfg: Pick<Config, 'dataDir' | 'secretKeyEnv'>): Buffer {
  if (cfg.secretKeyEnv) {
    const k = Buffer.from(cfg.secretKeyEnv, 'base64');
    if (k.length !== 32) throw new Error('DUBLYARR_SECRET_KEY должен быть base64 от 32 байт (openssl rand -base64 32)');
    return k;
  }
  const file = path.join(cfg.dataDir, 'secret.key');
  if (existsSync(file)) {
    const k = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
    if (k.length !== 32) throw new Error(`${file}: ключ должен быть 32 байта`);
    return k;
  }
  mkdirSync(cfg.dataDir, { recursive: true });
  const k = randomBytes(32);
  writeFileSync(file, k.toString('base64') + '\n', { mode: 0o600, flag: 'wx' });
  chmodSync(file, 0o600);
  return k;
}

let cached: Buffer | undefined;
export function getMasterKey(): Buffer { return (cached ??= loadMasterKey(getConfig())); }
```

Предупреждение «ключ сгенерирован в файл, задайте DUBLYARR_SECRET_KEY» логирует супервизор (Task 12), а не этот модуль.

```ts
// src/lib/crypto/secretbox.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getMasterKey } from './key';

export class SecretDecryptError extends Error {
  constructor() { super('Не удалось расшифровать секрет: ключ шифрования не подходит или данные повреждены'); }
}

export function encrypt(plain: string, key: Buffer = getMasterKey()): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return 'v1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

export function decrypt(box: string, key: Buffer = getMasterKey()): string {
  if (!box.startsWith('v1:')) throw new SecretDecryptError();
  const raw = Buffer.from(box.slice(3), 'base64');
  if (raw.length < 29) throw new SecretDecryptError();
  try {
    const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch { throw new SecretDecryptError(); }
}
```

```ts
// src/lib/settings.ts
import { eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { appSettings } from './db/schema';
import { encrypt, decrypt } from './crypto/secretbox';

function write(db: Db, key: string, value: string, encrypted: boolean) {
  const row = { key, value, encrypted, updatedAt: Date.now() };
  db.insert(appSettings).values(row).onConflictDoUpdate({ target: appSettings.key, set: row }).run();
}
function read(db: Db, key: string) { return db.select().from(appSettings).where(eq(appSettings.key, key)).get(); }

export function setSetting(db: Db, key: string, value: unknown) { write(db, key, JSON.stringify(value), false); }
export function getSetting<T>(db: Db, key: string): T | undefined {
  const r = read(db, key);
  return r && !r.encrypted ? (JSON.parse(r.value) as T) : undefined;
}
export function setSecretSetting(db: Db, key: string, value: unknown) { write(db, key, encrypt(JSON.stringify(value)), true); }
export function getSecretSetting<T>(db: Db, key: string): T | undefined {
  const r = read(db, key);
  return r && r.encrypted ? (JSON.parse(decrypt(r.value)) as T) : undefined;
}
```

- [ ] **Step 4: Сгенерировать миграцию** `pnpm db:generate` → появится `drizzle/0000_*.sql` и `drizzle/meta/*`.
- [ ] **Step 5: Run** `pnpm test` — PASS.
- [ ] **Step 6: Commit** `feat: SQLite + Drizzle, мастер-ключ, шифрование секретов, настройки`.

---

### Task 4: Пароль и токены

**Files:**
- Create: `src/lib/auth/password.ts`, `src/lib/auth/tokens.ts`
- Test: `tests/unit/password.test.ts`

**Interfaces:**
- Produces:
  - `hashPassword(p: string): Promise<string>`, `verifyPassword(hash: string, p: string): Promise<boolean>` (ложь при битом хэше, без исключения).
  - `validateNewPassword(p: string): string | null` — текст ошибки на русском или `null`. Правило: ≥ 10 символов, не только цифры... — **только** «не короче 10 символов» (не усложняем).
  - `newToken(): string` (32 байта base64url), `hashToken(t: string): string` (sha256 hex).

- [ ] **Step 1: Failing test**

```ts
import { expect, test } from 'vitest';
import { hashPassword, verifyPassword, validateNewPassword } from '@/lib/auth/password';
import { newToken, hashToken } from '@/lib/auth/tokens';

test('argon2: верный/неверный пароль, битый хэш', async () => {
  const h = await hashPassword('длинный-пароль');
  expect(h).toMatch(/^\$argon2id\$/);
  expect(await verifyPassword(h, 'длинный-пароль')).toBe(true);
  expect(await verifyPassword(h, 'другой-пароль')).toBe(false);
  expect(await verifyPassword('мусор', 'x')).toBe(false);
});

test('правило пароля', () => {
  expect(validateNewPassword('123456789')).toBe('Пароль — не короче 10 символов');
  expect(validateNewPassword('1234567890')).toBeNull();
});

test('токены', () => {
  const t = newToken();
  expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(newToken()).not.toBe(t);
  expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
  expect(hashToken(t)).toBe(hashToken(t));
});
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**

```ts
// src/lib/auth/password.ts
import { hash, verify } from '@node-rs/argon2';
export const hashPassword = (p: string) => hash(p); // argon2id по умолчанию
export async function verifyPassword(h: string, p: string) { try { return await verify(h, p); } catch { return false; } }
export function validateNewPassword(p: string): string | null { return p.length < 10 ? 'Пароль — не короче 10 символов' : null; }
```

```ts
// src/lib/auth/tokens.ts
import { createHash, randomBytes } from 'node:crypto';
export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
```

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `feat: argon2 и токены`.

---

### Task 5: TOTP (RFC 6238) с защитой от повтора

**Files:**
- Create: `src/lib/auth/totp.ts`
- Test: `tests/unit/totp.test.ts`

**Interfaces:**
- Produces:
  - `generateTotpSecret(): string` (base32, 20 байт → 32 символа)
  - `base32Encode(b: Buffer): string`, `base32Decode(s: string): Buffer`
  - `totpAt(secretB32: string, step: number): string` (6 цифр, SHA-1)
  - `currentStep(nowMs: number): number` (= floor(now/30000))
  - `verifyTotp(secretB32: string, code: string, nowMs: number, lastUsedStep: number | null): { ok: true; step: number } | { ok: false }` — окно ±1 шаг, отклоняет `step <= lastUsedStep`, код нормализуется (пробелы убираются).
  - `otpauthUri(secretB32: string, username: string): string`

- [ ] **Step 1: Failing test** (векторы RFC 6238, SHA-1, секрет ASCII `12345678901234567890`; 8-значные коды RFC → берём последние 6 цифр)

```ts
import { expect, test } from 'vitest';
import { base32Encode, base32Decode, totpAt, verifyTotp, generateTotpSecret, otpauthUri, currentStep } from '@/lib/auth/totp';

const secret = base32Encode(Buffer.from('12345678901234567890'));

test('base32', () => {
  expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  expect(base32Decode(secret.toLowerCase()).toString()).toBe('12345678901234567890');
});

test.each([
  [59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'],
])('RFC 6238 t=%i', (t, code) => { expect(totpAt(secret, Math.floor(t / 30))).toBe(code); });

test('окно ±1 шаг и нормализация', () => {
  const now = 1234567890_000;
  const s = currentStep(now);
  expect(verifyTotp(secret, totpAt(secret, s - 1), now, null)).toEqual({ ok: true, step: s - 1 });
  expect(verifyTotp(secret, ' ' + totpAt(secret, s + 1).replace(/(\d{3})/, '$1 '), now, null).ok).toBe(true);
  expect(verifyTotp(secret, totpAt(secret, s - 2), now, null).ok).toBe(false);
  expect(verifyTotp(secret, '12345', now, null).ok).toBe(false);
});

test('повтор того же кода отклоняется', () => {
  const now = 1234567890_000;
  const code = totpAt(secret, currentStep(now));
  const first = verifyTotp(secret, code, now, null);
  expect(first.ok).toBe(true);
  expect(verifyTotp(secret, code, now + 1000, first.ok ? first.step : null).ok).toBe(false);
});

test('секрет и URI', () => {
  const s = generateTotpSecret();
  expect(s).toMatch(/^[A-Z2-7]{32}$/);
  expect(otpauthUri(s, 'admin')).toBe(`otpauth://totp/Dublyarr:admin?secret=${s}&issuer=Dublyarr&algorithm=SHA1&digits=6&period=30`);
});
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**

```ts
// src/lib/auth/totp.ts
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHA[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHA[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=]/g, '');
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHA.indexOf(ch);
    if (i < 0) throw new Error('Неверный base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const generateTotpSecret = () => base32Encode(randomBytes(20));
export const currentStep = (nowMs: number) => Math.floor(nowMs / 30_000);

export function totpAt(secretB32: string, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32Decode(secretB32)).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

export function verifyTotp(secretB32: string, code: string, nowMs: number, lastUsedStep: number | null):
  { ok: true; step: number } | { ok: false } {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return { ok: false };
  const now = currentStep(nowMs);
  for (const step of [now - 1, now, now + 1]) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    if (timingSafeEqual(Buffer.from(totpAt(secretB32, step)), Buffer.from(c))) return { ok: true, step };
  }
  return { ok: false };
}

export function otpauthUri(secretB32: string, username: string): string {
  return `otpauth://totp/Dublyarr:${encodeURIComponent(username)}?secret=${secretB32}&issuer=Dublyarr&algorithm=SHA1&digits=6&period=30`;
}
```

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `feat: TOTP по RFC 6238 с защитой от повтора`.

---

### Task 6: Пользователь, сеансы, доверенные устройства, ограничение попыток

**Files:**
- Create: `src/lib/auth/users.ts`, `src/lib/auth/sessions.ts`, `src/lib/auth/ratelimit.ts`
- Test: `tests/unit/sessions.test.ts`, `tests/unit/ratelimit.test.ts`, `tests/unit/users.test.ts`

**Interfaces:**
- Consumes: `Db`, схемы из Task 3; `hashPassword/verifyPassword` (Task 4); `newToken/hashToken` (Task 4); `encrypt/decrypt` (Task 3).
- Produces (все функции принимают `now: number = Date.now()` последним параметром, где есть время):
  - `users.ts`: `type User = typeof users.$inferSelect`; `hasAnyUser(db): boolean`; `createUser(db, username, password): Promise<User>` (бросает `Error('Пользователь уже создан')`, если есть любой пользователь); `findUserByName(db, username): User | undefined`; `getUser(db, id): User | undefined`; `setPassword(db, userId, password): Promise<void>`; `setTotpSecret(db, userId, secretB32 | null)` (шифрует; `null` — выключает 2FA и сбрасывает `totpLastStep`); `enableTotp(db, userId)`; `getTotpSecret(user): string | null`; `markTotpStep(db, userId, step)`.
  - `sessions.ts`:
    - константы `SESSION_TTL_PERSISTENT = 30 дней`, `SESSION_TTL_SHORT = 24 часа`, `PENDING_TTL = 5 минут`, `TRUST_TTL = 30 дней`.
    - `createSession(db, { userId, persistent, userAgent, ip }, now): { token: string; expiresAt: number }`
    - `validateSession(db, token, now): { session: Session; user: User } | null` — продлевает `lastSeenAt` и `expiresAt` (скользящее окно), удаляет просроченный.
    - `revokeSession(db, token)`, `revokeSessionById(db, id)`, `revokeAllSessions(db, userId, exceptId?: string)`, `listSessions(db, userId, now): Session[]` (только живые, по `lastSeenAt` desc).
    - `createPendingLogin(db, userId, remember, now): string`; `consumePendingLogin(db, token, now): { userId: number; remember: boolean } | null` (не удаляет — удаление через `deletePendingLogin(db, token)` после успешного кода, чтобы при неверном коде можно было повторить); `peekPendingLogin` = то же, что consume без удаления → **одна функция `getPendingLogin`** + `deletePendingLogin`.
    - `createTrustedDevice(db, userId, userAgent, now): { token: string; expiresAt: number }`; `isTrustedDevice(db, token, userId, now): boolean`; `revokeTrustedDevices(db, userId)`.
  - `ratelimit.ts`: `MAX_FAILURES = 10`, `WINDOW_MS = 15 минут`; `recordFailure(db, keys: string[], now)`; `isBlocked(db, keys: string[], now): boolean`; `clearFailures(db, keys: string[])`; `prune(db, now)`.

- [ ] **Step 1: Failing tests**

```ts
// tests/unit/sessions.test.ts
import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { createUser } from '@/lib/auth/users';
import {
  createSession, validateSession, revokeAllSessions, listSessions, revokeSession,
  createPendingLogin, getPendingLogin, deletePendingLogin,
  createTrustedDevice, isTrustedDevice, revokeTrustedDevices,
  SESSION_TTL_SHORT, SESSION_TTL_PERSISTENT, PENDING_TTL, TRUST_TTL,
} from '@/lib/auth/sessions';
import { sessions } from '@/lib/db/schema';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const T0 = 1_800_000_000_000;

test('сеанс: создаётся, в БД только хэш, скользящее продление, истечение', async () => {
  const db = testDb();
  const u = await createUser(db, 'admin', 'пароль-длинный');
  const { token, expiresAt } = createSession(db, { userId: u.id, persistent: false, userAgent: 'UA', ip: '1.1.1.1' }, T0);
  expect(expiresAt).toBe(T0 + SESSION_TTL_SHORT);
  expect(db.select().from(sessions).all()[0].id).not.toBe(token);
  const later = T0 + SESSION_TTL_SHORT - 1000;
  expect(validateSession(db, token, later)?.user.username).toBe('admin');
  expect(validateSession(db, token, later + SESSION_TTL_SHORT - 1000)).not.toBeNull(); // продлился
  expect(validateSession(db, token, later + 3 * SESSION_TTL_SHORT)).toBeNull();
  expect(validateSession(db, 'неизвестный', T0)).toBeNull();
});

test('запомнить устройство — 30 дней; выйти везде кроме текущего', async () => {
  const db = testDb();
  const u = await createUser(db, 'admin', 'пароль-длинный');
  const a = createSession(db, { userId: u.id, persistent: true, userAgent: null, ip: null }, T0);
  const b = createSession(db, { userId: u.id, persistent: false, userAgent: null, ip: null }, T0);
  expect(a.expiresAt).toBe(T0 + SESSION_TTL_PERSISTENT);
  const cur = validateSession(db, a.token, T0)!;
  revokeAllSessions(db, u.id, cur.session.id);
  expect(validateSession(db, b.token, T0)).toBeNull();
  expect(listSessions(db, u.id, T0)).toHaveLength(1);
  revokeSession(db, a.token);
  expect(validateSession(db, a.token, T0)).toBeNull();
});

test('ожидающий вход живёт 5 минут', async () => {
  const db = testDb();
  const u = await createUser(db, 'admin', 'пароль-длинный');
  const p = createPendingLogin(db, u.id, true, T0);
  expect(getPendingLogin(db, p, T0 + PENDING_TTL - 1)).toEqual({ userId: u.id, remember: true });
  expect(getPendingLogin(db, p, T0 + PENDING_TTL + 1)).toBeNull();
  const p2 = createPendingLogin(db, u.id, false, T0);
  deletePendingLogin(db, p2);
  expect(getPendingLogin(db, p2, T0)).toBeNull();
});

test('доверенное устройство 30 дней, отзывается', async () => {
  const db = testDb();
  const u = await createUser(db, 'admin', 'пароль-длинный');
  const d = createTrustedDevice(db, u.id, 'UA', T0);
  expect(isTrustedDevice(db, d.token, u.id, T0 + TRUST_TTL - 1)).toBe(true);
  expect(isTrustedDevice(db, d.token, u.id, T0 + TRUST_TTL + 1)).toBe(false);
  expect(isTrustedDevice(db, d.token, u.id + 1, T0)).toBe(false);
  revokeTrustedDevices(db, u.id);
  expect(isTrustedDevice(db, d.token, u.id, T0)).toBe(false);
});
```

```ts
// tests/unit/ratelimit.test.ts
import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { recordFailure, isBlocked, clearFailures, MAX_FAILURES, WINDOW_MS } from '@/lib/auth/ratelimit';

test('10 неудач за 15 минут блокируют, окно скользит, сброс по успеху', () => {
  const db = testDb();
  const keys = ['ip:1.1.1.1', 'user:admin'];
  const t = 1_800_000_000_000;
  for (let i = 0; i < MAX_FAILURES - 1; i++) recordFailure(db, keys, t + i);
  expect(isBlocked(db, keys, t + 100)).toBe(false);
  recordFailure(db, keys, t + 100);
  expect(isBlocked(db, keys, t + 101)).toBe(true);
  expect(isBlocked(db, ['user:admin'], t + 101)).toBe(true);    // блок по логину с другого IP
  expect(isBlocked(db, ['ip:2.2.2.2'], t + 101)).toBe(false);
  expect(isBlocked(db, keys, t + 100 + WINDOW_MS + 1)).toBe(false);
  clearFailures(db, keys);
  expect(isBlocked(db, keys, t + 101)).toBe(false);
});
```

```ts
// tests/unit/users.test.ts
import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { createUser, hasAnyUser, setTotpSecret, enableTotp, getUser, getTotpSecret, setPassword, findUserByName } from '@/lib/auth/users';
import { verifyPassword } from '@/lib/auth/password';
import { users } from '@/lib/db/schema';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');

test('второго пользователя создать нельзя', async () => {
  const db = testDb();
  expect(hasAnyUser(db)).toBe(false);
  await createUser(db, 'admin', 'пароль-длинный');
  expect(hasAnyUser(db)).toBe(true);
  await expect(createUser(db, 'other', 'пароль-длинный')).rejects.toThrow('Пользователь уже создан');
});

test('TOTP-секрет хранится зашифрованным; выключение сбрасывает', async () => {
  const db = testDb();
  const u = await createUser(db, 'admin', 'пароль-длинный');
  setTotpSecret(db, u.id, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  expect(db.select().from(users).get()!.totpSecretEnc).not.toContain('GEZD');
  expect(getUser(db, u.id)!.totpEnabled).toBe(false);
  enableTotp(db, u.id);
  expect(getTotpSecret(getUser(db, u.id)!)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  setTotpSecret(db, u.id, null);
  const after = getUser(db, u.id)!;
  expect(after.totpEnabled).toBe(false);
  expect(getTotpSecret(after)).toBeNull();
});

test('смена пароля', async () => {
  const db = testDb();
  const u = await createUser(db, 'admin', 'пароль-длинный');
  await setPassword(db, u.id, 'новый-пароль-123');
  expect(await verifyPassword(findUserByName(db, 'admin')!.passwordHash, 'новый-пароль-123')).toBe(true);
});
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**

```ts
// src/lib/auth/users.ts
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { hashPassword } from './password';
import { encrypt, decrypt } from '../crypto/secretbox';

export type User = typeof users.$inferSelect;

export const hasAnyUser = (db: Db) => (db.select({ n: sql<number>`count(*)` }).from(users).get()?.n ?? 0) > 0;

export async function createUser(db: Db, username: string, password: string): Promise<User> {
  const hash = await hashPassword(password);
  return db.transaction((tx) => {
    if ((tx.select({ n: sql<number>`count(*)` }).from(users).get()?.n ?? 0) > 0) throw new Error('Пользователь уже создан');
    const now = Date.now();
    return tx.insert(users).values({ username: username.trim(), passwordHash: hash, createdAt: now, updatedAt: now }).returning().get();
  });
}

export const findUserByName = (db: Db, username: string) => db.select().from(users).where(eq(users.username, username.trim())).get();
export const getUser = (db: Db, id: number) => db.select().from(users).where(eq(users.id, id)).get();

export async function setPassword(db: Db, userId: number, password: string) {
  db.update(users).set({ passwordHash: await hashPassword(password), updatedAt: Date.now() }).where(eq(users.id, userId)).run();
}

export function setTotpSecret(db: Db, userId: number, secretB32: string | null) {
  db.update(users).set({
    totpSecretEnc: secretB32 ? encrypt(secretB32) : null, totpEnabled: false, totpLastStep: null, updatedAt: Date.now(),
  }).where(eq(users.id, userId)).run();
}
export const enableTotp = (db: Db, userId: number) =>
  db.update(users).set({ totpEnabled: true, updatedAt: Date.now() }).where(eq(users.id, userId)).run();
export const getTotpSecret = (u: User) => (u.totpSecretEnc ? decrypt(u.totpSecretEnc) : null);
export const markTotpStep = (db: Db, userId: number, step: number) =>
  db.update(users).set({ totpLastStep: step }).where(eq(users.id, userId)).run();
```

```ts
// src/lib/auth/sessions.ts
import { and, desc, eq, gt, lte, ne } from 'drizzle-orm';
import type { Db } from '../db/client';
import { sessions, pendingLogins, trustedDevices } from '../db/schema';
import { newToken, hashToken } from './tokens';
import { getUser, type User } from './users';

const DAY = 86_400_000;
export const SESSION_TTL_PERSISTENT = 30 * DAY;
export const SESSION_TTL_SHORT = DAY;
export const PENDING_TTL = 5 * 60_000;
export const TRUST_TTL = 30 * DAY;
export type Session = typeof sessions.$inferSelect;

const ttl = (persistent: boolean) => (persistent ? SESSION_TTL_PERSISTENT : SESSION_TTL_SHORT);

export function createSession(db: Db, a: { userId: number; persistent: boolean; userAgent: string | null; ip: string | null }, now = Date.now()) {
  const token = newToken();
  const expiresAt = now + ttl(a.persistent);
  db.insert(sessions).values({ id: hashToken(token), ...a, createdAt: now, lastSeenAt: now, expiresAt }).run();
  return { token, expiresAt };
}

export function validateSession(db: Db, token: string, now = Date.now()): { session: Session; user: User } | null {
  const id = hashToken(token);
  const s = db.select().from(sessions).where(eq(sessions.id, id)).get();
  if (!s) return null;
  if (s.expiresAt <= now) { db.delete(sessions).where(eq(sessions.id, id)).run(); return null; }
  const user = getUser(db, s.userId);
  if (!user) return null;
  const upd = { lastSeenAt: now, expiresAt: now + ttl(s.persistent) };
  db.update(sessions).set(upd).where(eq(sessions.id, id)).run();
  return { session: { ...s, ...upd }, user };
}

export const revokeSession = (db: Db, token: string) => db.delete(sessions).where(eq(sessions.id, hashToken(token))).run();
export const revokeSessionById = (db: Db, id: string) => db.delete(sessions).where(eq(sessions.id, id)).run();
export function revokeAllSessions(db: Db, userId: number, exceptId?: string) {
  db.delete(sessions).where(exceptId ? and(eq(sessions.userId, userId), ne(sessions.id, exceptId)) : eq(sessions.userId, userId)).run();
}
export function listSessions(db: Db, userId: number, now = Date.now()): Session[] {
  db.delete(sessions).where(lte(sessions.expiresAt, now)).run();
  return db.select().from(sessions).where(eq(sessions.userId, userId)).orderBy(desc(sessions.lastSeenAt)).all();
}

export function createPendingLogin(db: Db, userId: number, remember: boolean, now = Date.now()): string {
  const token = newToken();
  db.insert(pendingLogins).values({ id: hashToken(token), userId, remember, expiresAt: now + PENDING_TTL }).run();
  return token;
}
export function getPendingLogin(db: Db, token: string, now = Date.now()) {
  const p = db.select().from(pendingLogins).where(and(eq(pendingLogins.id, hashToken(token)), gt(pendingLogins.expiresAt, now))).get();
  return p ? { userId: p.userId, remember: p.remember } : null;
}
export const deletePendingLogin = (db: Db, token: string) => db.delete(pendingLogins).where(eq(pendingLogins.id, hashToken(token))).run();

export function createTrustedDevice(db: Db, userId: number, userAgent: string | null, now = Date.now()) {
  const token = newToken();
  const expiresAt = now + TRUST_TTL;
  db.insert(trustedDevices).values({ id: hashToken(token), userId, userAgent, createdAt: now, expiresAt }).run();
  return { token, expiresAt };
}
export function isTrustedDevice(db: Db, token: string, userId: number, now = Date.now()) {
  return !!db.select().from(trustedDevices)
    .where(and(eq(trustedDevices.id, hashToken(token)), eq(trustedDevices.userId, userId), gt(trustedDevices.expiresAt, now))).get();
}
export const revokeTrustedDevices = (db: Db, userId: number) => db.delete(trustedDevices).where(eq(trustedDevices.userId, userId)).run();
```

```ts
// src/lib/auth/ratelimit.ts
import { and, gt, inArray, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { authFailures } from '../db/schema';

export const MAX_FAILURES = 10;
export const WINDOW_MS = 15 * 60_000;

export function recordFailure(db: Db, keys: string[], now = Date.now()) {
  db.insert(authFailures).values(keys.map((key) => ({ key, at: now }))).run();
}
export function isBlocked(db: Db, keys: string[], now = Date.now()) {
  const rows = db.select({ key: authFailures.key, n: sql<number>`count(*)` }).from(authFailures)
    .where(and(inArray(authFailures.key, keys), gt(authFailures.at, now - WINDOW_MS))).groupBy(authFailures.key).all();
  return rows.some((r) => r.n >= MAX_FAILURES);
}
export const clearFailures = (db: Db, keys: string[]) => db.delete(authFailures).where(inArray(authFailures.key, keys)).run();
export const prune = (db: Db, now = Date.now()) => db.delete(authFailures).where(lte(authFailures.at, now - WINDOW_MS)).run();
```

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `feat: сеансы, доверенные устройства, ограничение попыток`.

---

### Task 7: Сценарий входа, cookie, защита маршрутов

**Files:**
- Create: `src/lib/auth/login.ts`, `src/lib/auth/cookies.ts`, `src/lib/auth/current.ts`, `src/proxy.ts`
- Test: `tests/unit/login.test.ts`, `tests/unit/cookies.test.ts`

**Interfaces:**
- Consumes: Task 4–6.
- Produces:
  - `login.ts` (чистая логика без Next):
    ```ts
    type Ctx = { ip: string; userAgent: string | null; trustToken: string | null; now?: number };
    type PasswordResult =
      | { kind: 'error'; message: string }                  // 'Неверный логин или пароль' | 'Слишком много попыток. Подождите 15 минут.'
      | { kind: 'session'; token: string; expiresAt: number; persistent: boolean }
      | { kind: 'need-code'; pendingToken: string };
    passwordStep(db, { username, password, remember }, ctx): Promise<PasswordResult>
    type CodeResult =
      | { kind: 'error'; message: string }                  // 'Неверный код' | 'Слишком много попыток…' | 'Вход устарел, начните заново'
      | { kind: 'session'; token: string; expiresAt: number; persistent: boolean; trust?: { token: string; expiresAt: number } };
    codeStep(db, { pendingToken, code, trustDevice }, ctx): CodeResult
    ```
    Ключи ограничения: `ip:<ip>` и `user:<username>` (для кода — `user:<username из pending>`).
    Сообщение при неизвестном логине и неверном пароле — одинаковое. Если пользователь не найден, всё равно выполнить `verifyPassword` против фиктивного хэша (одинаковое время).
    `need-code` — только если `totpEnabled` и доверенное устройство (`ctx.trustToken`) не подтверждено.
  - `cookies.ts`: `COOKIE_SESSION = 'dy_session'`, `COOKIE_PENDING = 'dy_pending'`, `COOKIE_TRUST = 'dy_trust'`;
    `isSecureRequest(h: { get(name: string): string | null }): boolean` (`x-forwarded-proto` = https, иначе `false`);
    `cookieOptions(secure: boolean, expiresAt?: number): { httpOnly: true; sameSite: 'lax'; path: '/'; secure: boolean; expires?: Date }`.
  - `current.ts`: `getCurrentSession(): Promise<{ session; user } | null>`, `requireSession(): Promise<{ session; user }>` (redirect на `/setup`, если пользователей нет; иначе на `/login`), `requestContext(): Promise<{ ip: string; userAgent: string | null; secure: boolean }>` (ip из `x-forwarded-for` первый, `x-real-ip`, иначе `'local'`).
  - `proxy.ts`: без БД; пускает `/login*`, `/setup*`, `/_next/*`, `/favicon*`, `/api/health`; остальное без cookie `dy_session` → redirect `/login?next=<path>`.

- [ ] **Step 1: Failing tests**

```ts
// tests/unit/login.test.ts
import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { createUser, setTotpSecret, enableTotp } from '@/lib/auth/users';
import { passwordStep, codeStep } from '@/lib/auth/login';
import { validateSession, createTrustedDevice } from '@/lib/auth/sessions';
import { totpAt, currentStep } from '@/lib/auth/totp';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const ctx = (over = {}) => ({ ip: '10.0.0.2', userAgent: 'UA', trustToken: null, now: 1_800_000_000_000, ...over });

async function setup(twoFa: boolean) {
  const db = testDb();
  const u = await createUser(db, 'admin', 'пароль-длинный');
  if (twoFa) { setTotpSecret(db, u.id, SECRET); enableTotp(db, u.id); }
  return { db, u };
}

test('без 2FA: сразу сеанс; remember → persistent', async () => {
  const { db } = await setup(false);
  const r = await passwordStep(db, { username: 'admin', password: 'пароль-длинный', remember: true }, ctx());
  expect(r.kind).toBe('session');
  if (r.kind === 'session') { expect(r.persistent).toBe(true); expect(validateSession(db, r.token, ctx().now)).not.toBeNull(); }
});

test('неверный пароль и неизвестный логин — одно сообщение', async () => {
  const { db } = await setup(false);
  const a = await passwordStep(db, { username: 'admin', password: 'нет', remember: false }, ctx());
  const b = await passwordStep(db, { username: 'кто', password: 'нет', remember: false }, ctx());
  expect(a).toEqual({ kind: 'error', message: 'Неверный логин или пароль' });
  expect(b).toEqual(a);
});

test('блокировка после 10 неудач даже при верном пароле', async () => {
  const { db } = await setup(false);
  for (let i = 0; i < 10; i++) await passwordStep(db, { username: 'admin', password: 'нет', remember: false }, ctx());
  const r = await passwordStep(db, { username: 'admin', password: 'пароль-длинный', remember: false }, ctx());
  expect(r).toEqual({ kind: 'error', message: 'Слишком много попыток. Подождите 15 минут.' });
});

test('с 2FA: шаг кода, повтор кода отклоняется, доверенное устройство', async () => {
  const { db, u } = await setup(true);
  const c = ctx();
  const r1 = await passwordStep(db, { username: 'admin', password: 'пароль-длинный', remember: false }, c);
  expect(r1.kind).toBe('need-code');
  if (r1.kind !== 'need-code') return;
  expect(codeStep(db, { pendingToken: r1.pendingToken, code: '000000', trustDevice: false }, c)).toEqual({ kind: 'error', message: 'Неверный код' });
  const code = totpAt(SECRET, currentStep(c.now));
  const ok = codeStep(db, { pendingToken: r1.pendingToken, code, trustDevice: true }, c);
  expect(ok.kind).toBe('session');
  if (ok.kind !== 'session') return;
  expect(ok.trust).toBeDefined();
  // pending использован — повторно нельзя
  expect(codeStep(db, { pendingToken: r1.pendingToken, code, trustDevice: false }, c).kind).toBe('error');
  // тот же код во втором входе отклоняется (replay)
  const r2 = await passwordStep(db, { username: 'admin', password: 'пароль-длинный', remember: false }, c);
  if (r2.kind !== 'need-code') throw new Error('ожидался need-code');
  expect(codeStep(db, { pendingToken: r2.pendingToken, code, trustDevice: false }, c)).toEqual({ kind: 'error', message: 'Неверный код' });
  // доверенное устройство пропускает шаг кода
  const trust = createTrustedDevice(db, u.id, 'UA', c.now);
  const r3 = await passwordStep(db, { username: 'admin', password: 'пароль-длинный', remember: false }, ctx({ trustToken: trust.token }));
  expect(r3.kind).toBe('session');
});
```

```ts
// tests/unit/cookies.test.ts
import { expect, test } from 'vitest';
import { isSecureRequest, cookieOptions } from '@/lib/auth/cookies';

const h = (m: Record<string, string>) => ({ get: (n: string) => m[n.toLowerCase()] ?? null });

test('http в LAN — без Secure, за https-прокси — с Secure', () => {
  expect(isSecureRequest(h({}))).toBe(false);
  expect(isSecureRequest(h({ 'x-forwarded-proto': 'https' }))).toBe(true);
  expect(cookieOptions(false).secure).toBe(false);
  expect(cookieOptions(true, 1000)).toEqual({ httpOnly: true, sameSite: 'lax', path: '/', secure: true, expires: new Date(1000) });
  expect(cookieOptions(false)).not.toHaveProperty('expires');
});
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**

```ts
// src/lib/auth/cookies.ts
export const COOKIE_SESSION = 'dy_session';
export const COOKIE_PENDING = 'dy_pending';
export const COOKIE_TRUST = 'dy_trust';

export function isSecureRequest(h: { get(name: string): string | null }): boolean {
  return (h.get('x-forwarded-proto') ?? '').split(',')[0].trim() === 'https';
}
export function cookieOptions(secure: boolean, expiresAt?: number) {
  return { httpOnly: true as const, sameSite: 'lax' as const, path: '/', secure, ...(expiresAt ? { expires: new Date(expiresAt) } : {}) };
}
```

```ts
// src/lib/auth/login.ts
import type { Db } from '../db/client';
import { findUserByName, getUser, getTotpSecret, markTotpStep } from './users';
import { verifyPassword } from './password';
import { verifyTotp } from './totp';
import { isBlocked, recordFailure, clearFailures } from './ratelimit';
import { createSession, createPendingLogin, getPendingLogin, deletePendingLogin, isTrustedDevice, createTrustedDevice } from './sessions';

type Ctx = { ip: string; userAgent: string | null; trustToken: string | null; now?: number };
const BLOCKED = 'Слишком много попыток. Подождите 15 минут.';
// argon2id-хэш произвольной строки: выравнивает время ответа для несуществующего логина
const DUMMY_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$6Ydq0fCGDDhzDPsH0p1h1Ytn0xPYiHnHi3UGBu6vWjs';

export type PasswordResult =
  | { kind: 'error'; message: string }
  | { kind: 'session'; token: string; expiresAt: number; persistent: boolean }
  | { kind: 'need-code'; pendingToken: string };

export async function passwordStep(db: Db, i: { username: string; password: string; remember: boolean }, ctx: Ctx): Promise<PasswordResult> {
  const now = ctx.now ?? Date.now();
  const username = i.username.trim();
  const keys = [`ip:${ctx.ip}`, `user:${username}`];
  if (isBlocked(db, keys, now)) return { kind: 'error', message: BLOCKED };
  const user = findUserByName(db, username);
  const ok = await verifyPassword(user?.passwordHash ?? DUMMY_HASH, i.password);
  if (!user || !ok) { recordFailure(db, keys, now); return { kind: 'error', message: 'Неверный логин или пароль' }; }
  if (user.totpEnabled && !(ctx.trustToken && isTrustedDevice(db, ctx.trustToken, user.id, now))) {
    return { kind: 'need-code', pendingToken: createPendingLogin(db, user.id, i.remember, now) };
  }
  clearFailures(db, keys);
  const s = createSession(db, { userId: user.id, persistent: i.remember, userAgent: ctx.userAgent, ip: ctx.ip }, now);
  return { kind: 'session', ...s, persistent: i.remember };
}

export type CodeResult =
  | { kind: 'error'; message: string }
  | { kind: 'session'; token: string; expiresAt: number; persistent: boolean; trust?: { token: string; expiresAt: number } };

export function codeStep(db: Db, i: { pendingToken: string; code: string; trustDevice: boolean }, ctx: Ctx): CodeResult {
  const now = ctx.now ?? Date.now();
  const p = getPendingLogin(db, i.pendingToken, now);
  const user = p ? getUser(db, p.userId) : undefined;
  if (!p || !user) return { kind: 'error', message: 'Вход устарел, начните заново' };
  const keys = [`ip:${ctx.ip}`, `user:${user.username}`];
  if (isBlocked(db, keys, now)) return { kind: 'error', message: BLOCKED };
  const secret = getTotpSecret(user);
  const v = secret ? verifyTotp(secret, i.code, now, user.totpLastStep) : { ok: false as const };
  if (!v.ok) { recordFailure(db, keys, now); return { kind: 'error', message: 'Неверный код' }; }
  markTotpStep(db, user.id, v.step);
  deletePendingLogin(db, i.pendingToken);
  clearFailures(db, keys);
  const s = createSession(db, { userId: user.id, persistent: p.remember, userAgent: ctx.userAgent, ip: ctx.ip }, now);
  const trust = i.trustDevice ? createTrustedDevice(db, user.id, ctx.userAgent, now) : undefined;
  return { kind: 'session', ...s, persistent: p.remember, trust };
}
```

Если `DUMMY_HASH` окажется невалидным для `@node-rs/argon2` (verify вернёт false без задержки) — заменить на `await hashPassword('dummy')`, посчитанный один раз лениво и закэшированный в модуле.

```ts
// src/lib/auth/current.ts
import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '../db/client';
import { validateSession } from './sessions';
import { hasAnyUser } from './users';
import { COOKIE_SESSION, isSecureRequest } from './cookies';

export async function requestContext() {
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0].trim() || h.get('x-real-ip') || 'local';
  return { ip, userAgent: h.get('user-agent'), secure: isSecureRequest(h) };
}

export async function getCurrentSession() {
  const token = (await cookies()).get(COOKIE_SESSION)?.value;
  return token ? validateSession(getDb(), token) : null;
}

export async function requireSession() {
  const s = await getCurrentSession();
  if (s) return s;
  redirect(hasAnyUser(getDb()) ? '/login' : '/setup');
}
```

(`pnpm add server-only`.)

```ts
// src/proxy.ts
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC = [/^\/login/, /^\/setup/, /^\/_next\//, /^\/favicon/, /^\/api\/health$/];

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some((r) => r.test(pathname)) || req.cookies.has('dy_session')) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}
export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
```

- [ ] **Step 4: Run** `pnpm test && pnpm typecheck` — PASS.
- [ ] **Step 5: Commit** `feat: сценарий входа, cookie, proxy`.

---

### Task 8: UI-кит и адаптивная оболочка

**Files:**
- Create: `src/components/ui/{Button,Field,Checkbox,Segmented,Card,Table,Badge,CodeInput,Logo,StatusDot}.tsx`,
  `src/components/shell/{nav.ts,Sidebar.tsx,MobileTabs.tsx,AppShell.tsx,Placeholder.tsx,PageTitle.tsx}`,
  `src/app/(app)/layout.tsx`, `src/app/(app)/page.tsx`, `src/app/(app)/{library,calendar,discover,activity,storage,more}/page.tsx`,
  `src/app/(app)/settings/layout.tsx`, `src/app/(app)/settings/page.tsx`, `src/app/(app)/settings/[section]/page.tsx`
- Delete: `src/app/page.tsx` (временная из Task 1)
- Test: `tests/unit/nav.test.ts`

**Interfaces:**
- Consumes: `requireSession()` (Task 7), `getDb` (Task 3), `getHeartbeats` (Task 12 — до него Sidebar получает пустой список `services`).
- Produces:
  - `nav.ts`: `type NavId = 'today'|'library'|'calendar'|'discover'|'activity'|'storage'|'settings'`; `DESKTOP_NAV: {id,label,href,icon}[]` (7 пунктов из `Sidebar.dc.html`, те же SVG-path, `discover` → `/discover`), `MOBILE_TABS` (5: today, library, calendar, activity «Загрузки», more «Ещё»), `SETTINGS_SECTIONS: {id,label,phase}[]` = sources/Источники/1, studios/Подписки и студии/1, download/Загрузка и папки/1, schedule/Расписание/2, files/Обработка файлов/3, movies/Фильмы/3, storage/Хранение/3, notify/Уведомления/2, ai/AI/4, security/Безопасность/0; `activeNavId(pathname: string): NavId`.
  - `Button` props: `variant: 'primary'|'secondary'|'ghost'|'destructive'`, `size: 'md'|'lg'` (md 44 px, lg 52 px), остальное — `ButtonHTMLAttributes`. primary: `bg-accent text-on-accent font-semibold rounded-[11px]`; secondary: `border border-line-strong text-text rounded-[10px]`; destructive: `bg-destructive text-text`.
  - `Field`: `label`, `hint?`, `error?`, input props; поле `h-[50px] px-[14px] bg-surface border border-field-line rounded-xl text-base focus:border-accent`; `mono?: boolean` → `font-mono`. `PasswordField` — с кнопкой «Показать пароль» (иконка-глаз из `Login.dc.html`).
  - `Checkbox`: `label`, `description?` (строка 13 px faint), `accent-accent w-[18px] h-[18px]`.
  - `Segmented<T extends string>`: `options: {value:T;label:string}[]`, `value`, `name` (радио-группа для форм), фон `bg-surface-2 p-1 rounded-[10px]`, активный `bg-text text-bg font-semibold`, неактивный `text-muted`, высота 32 px + обёртка ≥ 44 px.
  - `Card`: `bg-surface border border-line rounded-2xl p-5`; `tone?: 'danger'` → `bg-danger-bg border-danger-line`.
  - `Table`: `columns: {key,label,width?}[]`, `rows`; шапка `11px uppercase tracking-[0.06em] text-faint bg-surface`, строки `border-t border-line-soft`; на `< md` строки превращаются в карточки (label: value).
  - `CodeInput`: 6 ячеек 56×67 px (`font-mono text-[26px]`), `name` скрытого input с полным кодом, автопереход, вставка 6 цифр целиком, `autocomplete="one-time-code"`, `inputMode="numeric"`, активная ячейка `border-2 border-accent`; на мобиле ячейки `flex-1`.
  - `Logo`: огонь-SVG из макета + «Dublyarr» (`font-display font-semibold`), `size: 'sm'|'lg'`.
  - `AppShell`: `≥ lg (1024px)`: слева `Sidebar` 232 px (`bg-sidebar border-r border-[#2A2724]`), main `p-10`; `< lg`: без сайдбара, `MobileTabs` фиксированно снизу (84 px, `pb-[env(safe-area-inset-bottom)]`), main `px-4 pt-6 pb-28`.
  - `Sidebar` props: `active: NavId`, `services: {name:string; state:'ok'|'warn'|'off'; note:string}[]` — блок «Сервисы» как в макете (точка 8 px: ok `#6E6962`/progress, warn accent, off faint). Блок «Хранилище» не выводится до фазы 3. Бейджи не выводятся до фазы 1.
  - `Placeholder` props: `title`, `phase: number` — заголовок страницы + карточка «Раздел появится в фазе N».
  - `PageTitle`: `h1 font-display font-semibold text-[44px] tracking-[-0.02em]`, на мобиле 28 px.

- [ ] **Step 1: Failing test**

```ts
// tests/unit/nav.test.ts
import { expect, test } from 'vitest';
import { activeNavId, DESKTOP_NAV, MOBILE_TABS, SETTINGS_SECTIONS } from '@/components/shell/nav';

test('активный пункт по пути', () => {
  expect(activeNavId('/')).toBe('today');
  expect(activeNavId('/library')).toBe('library');
  expect(activeNavId('/settings/security')).toBe('settings');
  expect(activeNavId('/activity/search')).toBe('activity');
});
test('состав навигации как в макетах', () => {
  expect(DESKTOP_NAV.map((n) => n.label)).toEqual(['Сегодня', 'Библиотека', 'Календарь', 'Поиск и тренды', 'Активность', 'Хранилище', 'Настройки']);
  expect(MOBILE_TABS.map((n) => n.label)).toEqual(['Сегодня', 'Библиотека', 'Календарь', 'Загрузки', 'Ещё']);
  expect(SETTINGS_SECTIONS.at(-1)).toEqual({ id: 'security', label: 'Безопасность', phase: 0 });
});
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** `nav.ts`:

```ts
export type NavId = 'today' | 'library' | 'calendar' | 'discover' | 'activity' | 'storage' | 'settings';
type Item = { id: NavId | 'more'; label: string; href: string; icon: string };

export const DESKTOP_NAV: Item[] = [
  { id: 'today', label: 'Сегодня', href: '/', icon: 'M3 11l9-7 9 7M5 10v10h14V10M10 20v-5h4v5' },
  { id: 'library', label: 'Библиотека', href: '/library', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  { id: 'calendar', label: 'Календарь', href: '/calendar', icon: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4' },
  { id: 'discover', label: 'Поиск и тренды', href: '/discover', icon: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4' },
  { id: 'activity', label: 'Активность', href: '/activity', icon: 'M12 4v11M7 10l5 5 5-5M5 20h14' },
  { id: 'storage', label: 'Хранилище', href: '/storage', icon: 'M4 5h16v6H4zM4 13h16v6H4zM8 8h.01M8 16h.01' },
  { id: 'settings', label: 'Настройки', href: '/settings', icon: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4' },
];

export const MOBILE_TABS: Item[] = [
  { id: 'today', label: 'Сегодня', href: '/', icon: 'M3 11l9-7 9 7M5 10v10h14V10' },
  { id: 'library', label: 'Библиотека', href: '/library', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  { id: 'calendar', label: 'Календарь', href: '/calendar', icon: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4' },
  { id: 'activity', label: 'Загрузки', href: '/activity', icon: 'M12 4v11M7 10l5 5 5-5M5 20h14' },
  { id: 'more', label: 'Ещё', href: '/more', icon: 'M5 12h.01M12 12h.01M19 12h.01' },
];

export const SETTINGS_SECTIONS = [
  { id: 'sources', label: 'Источники', phase: 1 },
  { id: 'studios', label: 'Подписки и студии', phase: 1 },
  { id: 'download', label: 'Загрузка и папки', phase: 1 },
  { id: 'schedule', label: 'Расписание', phase: 2 },
  { id: 'files', label: 'Обработка файлов', phase: 3 },
  { id: 'movies', label: 'Фильмы', phase: 3 },
  { id: 'storage', label: 'Хранение', phase: 3 },
  { id: 'notify', label: 'Уведомления', phase: 2 },
  { id: 'ai', label: 'AI', phase: 4 },
  { id: 'security', label: 'Безопасность', phase: 0 },
] as const;

export function activeNavId(pathname: string): NavId {
  const seg = pathname.split('/')[1] ?? '';
  const hit = DESKTOP_NAV.find((n) => n.href !== '/' && n.href === `/${seg}`);
  if (seg === 'more') return 'settings';
  return (hit?.id as NavId) ?? 'today';
}
```

Далее компоненты по контракту из Interfaces, сверяясь с `design/screens/Sidebar.dc.html`, `MobileTabs.dc.html`, `Settings.dc.html`
(кнопки, сегменты, карточки, таблица). `Sidebar`/`MobileTabs` — клиентские (`'use client'`, `usePathname()` → `activeNavId`),
активный пункт сайдбара `bg-nav-active text-text`, иконка `stroke-accent`; неактивный `text-[#B5AEA4]`, иконка `stroke-faint`; высота пункта 44 px, `rounded-[10px]`.
Активная вкладка мобильной навигации — `text-accent`, остальные `text-faint`, подпись 11 px.

`src/app/(app)/layout.tsx`:
```tsx
import { requireSession } from '@/lib/auth/current';
import { AppShell } from '@/components/shell/AppShell';
import { getDb } from '@/lib/db/client';
import { serviceStatuses } from '@/lib/heartbeat';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  return <AppShell services={serviceStatuses(getDb())}>{children}</AppShell>;
}
```
До Task 12 создать `src/lib/heartbeat.ts` с `export function serviceStatuses(_db: Db) { return []; }` — Task 12 заменит реализацию.

Заглушки: `/` → `<Placeholder title="Сегодня" phase={1} />`, `/library` (1), `/calendar` (1), `/discover` «Поиск и тренды» (1), `/activity` «Активность» (1), `/storage` «Хранилище» (3).
`/more` (только мобильный): список ссылок как в `MobileMore.dc.html` — Хранилище, Поиск и тренды, разделы настроек из `SETTINGS_SECTIONS`, кнопка «Выйти» (form action `logoutAction` из Task 9).
`/settings/layout.tsx`: заголовок «Настройки», слева (≥ lg) вертикальное меню разделов 220 px как в `Settings.dc.html`; на мобиле меню скрыто (переход через `/more`), у страницы раздела кнопка «‹ Ещё».
`/settings` → `redirect('/settings/security')`. `/settings/[section]` — `Placeholder` с `phase` раздела, `notFound()` для неизвестного.

- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint` — PASS.
- [ ] **Step 5: Визуальная проверка** — после Task 9 (без входа оболочка недоступна). Скриншоты 1440×900 и 390×844 сравнить с `Settings.dc.html`/`MobileMore.dc.html`.
- [ ] **Step 6: Commit** `feat: UI-кит и адаптивная оболочка`.

---

### Task 9: Экраны «Вход» и «Код подтверждения», выход

**Files:**
- Create: `src/app/login/page.tsx`, `src/app/login/LoginForm.tsx`, `src/app/login/2fa/page.tsx`, `src/app/login/2fa/CodeForm.tsx`,
  `src/app/login/actions.ts`, `src/app/login/AuthAside.tsx`, `src/app/login/layout.tsx`
- Test: e2e в Task 13 (здесь — ручная проверка)

**Interfaces:**
- Consumes: `passwordStep`, `codeStep` (Task 7), cookie-хелперы (Task 7), `requestContext` (Task 7), `revokeSession` (Task 6).
- Produces (server actions, `'use server'`):
  - `loginAction(prev: FormState, form: FormData): Promise<FormState>` — поля `username`, `password`, `remember` (`'on'`), `next`. `session` → ставит `dy_session` (expires только если persistent) и `redirect(safeNext(next))`; `need-code` → ставит `dy_pending` (5 мин) и `redirect('/login/2fa' + (next ? '?next=…' : ''))`; `error` → `{ error }`.
  - `codeAction(prev, form)` — поля `code`, `trust`, `next`; нет `dy_pending` → `redirect('/login')`; `session` → ставит `dy_session`, при `trust` — `dy_trust` (30 дней), удаляет `dy_pending`, redirect.
  - `logoutAction()` — `revokeSession`, удалить `dy_session`, `redirect('/login')`.
  - `type FormState = { error?: string }`; `safeNext(n: string | null): string` — только относительные пути, начинающиеся с `/` и не с `//`, иначе `/`.

Вёрстка строго по `design/screens/Login.dc.html`, `Login2FA.dc.html`, `MobileLogin.dc.html`, `MobileLogin2FA.dc.html`:
- `layout.tsx`: `≥ lg` — слева `AuthAside` 760 px (`bg-sidebar`, сетка 6 колонок повёрнутых на −6° постеров-заглушек цветами `ghost` из макета, `opacity-55`, затемнение `rgba(18,17,16,0.55)`, внизу `Logo size="lg"` и «Сериалы в нужной озвучке и качестве — сами, по мере выхода серий.»), справа форма по центру шириной 400 px. `< lg` — одна колонка `px-6 pt-12`, `Logo` сверху с `mb-6`.
- Вход: `h1` «Вход» (32 px desktop / 26 px mobile), подпись «Твой Dublyarr на NAS», поля «Логин» (`autocomplete=username`), «Пароль» (`PasswordField`), чекбокс «Запомнить это устройство» (по умолчанию включён), кнопка «Войти» `size=lg`, внизу «Забыл пароль? Сбросить можно из контейнера: `dublyarr reset-password`». Ошибка — строка `text-danger` 14 px над кнопкой. Кнопка во время отправки — `disabled` + «Входим…».
- Код: ссылка «‹ admin» (имя из pending → передать через `searchParams`? **Нет**: страница — серверный компонент, читает `dy_pending` и берёт `username` из БД), `h1` «Код подтверждения», текст «Открой приложение-аутентификатор и введи 6 цифр для Dublyarr.», `CodeInput`, чекбокс «Не спрашивать на этом устройстве 30 дней», кнопка «Подтвердить». Справа снизу счётчик «новый код через N с» (клиентский, `30 - (секунды % 30)`). Ссылки «Использовать резервный код» нет. Ввод 6-й цифры отправляет форму автоматически.

Добавить в `src/lib/auth/sessions.ts` функцию `getPendingUsername(db, token, now): string | null` (join pending → users) с тестом:

```ts
test('имя пользователя по ожидающему входу', async () => {
  const db = testDb();
  const u = await createUser(db, 'admin', 'пароль-длинный');
  const p = createPendingLogin(db, u.id, false, T0);
  expect(getPendingUsername(db, p, T0)).toBe('admin');
  expect(getPendingUsername(db, 'x', T0)).toBeNull();
});
```

- [ ] **Step 1:** тест `getPendingUsername` (в `tests/unit/sessions.test.ts`) → FAIL → реализовать → PASS.
- [ ] **Step 2:** actions + страницы.
- [ ] **Step 3: Ручная проверка:** `DATA_DIR=./.data pnpm dev`; временно создать пользователя через `pnpm tsx -e` (или дождаться Task 10); войти; проверить редирект с `/library` на `/login?next=%2Flibrary` и обратно; выход с `/more`.
- [ ] **Step 4:** скриншоты `/login` 1440×900 и 390×844 рядом с макетами — отступы, размеры шрифтов, цвета совпадают.
- [ ] **Step 5: Commit** `feat: экраны входа и 2FA`.

---

### Task 10: Первый запуск (мастер)

**Files:**
- Create: `src/lib/setup.ts`, `src/lib/fs-check.ts`, `src/lib/integrations/qbittorrent.ts`, `src/lib/integrations/torznab.ts`,
  `src/lib/sources.ts`, `src/app/setup/layout.tsx`, `src/app/setup/page.tsx`, `src/app/setup/actions.ts`,
  `src/app/setup/{qbittorrent,sources,folders}/page.tsx`, `src/app/setup/Steps.tsx`
- Test: `tests/unit/setup.test.ts`, `tests/unit/qbittorrent.test.ts`, `tests/unit/torznab.test.ts`, `tests/unit/fs-check.test.ts`

**Interfaces:**
- Produces:
  - `setup.ts`: `type SetupStep = 'account'|'qbittorrent'|'sources'|'folders'|'done'`; `SETUP_ORDER: SetupStep[]`; `getSetupState(db): { step: SetupStep; completed: SetupStep[] }` (account — если нет пользователя; дальше — по ключам `app_settings`: `setup.qbittorrent`, `setup.sources`, `setup.folders` = `'done'|'skipped'`; `done` — когда `setup.completed` = true); `markStep(db, step, 'done'|'skipped')`; `completeSetup(db)`.
  - `qbittorrent.ts`: `type QbitConfig = { url: string; username: string; password: string }`; `checkQbittorrent(cfg, fetchImpl = fetch): Promise<{ ok: true; version: string } | { ok: false; error: string }>` — `POST {url}/api/v2/auth/login` (form: username, password, заголовок `Referer: url`), ответ `Ok.` + `set-cookie SID` → `GET /api/v2/app/version` с cookie. Ошибки на русском: «Неверный логин или пароль qBittorrent», «qBittorrent не отвечает: <причина>», «IP заблокирован qBittorrent после неудачных входов» (403). Таймаут 10 с (`AbortSignal.timeout`).
  - `torznab.ts`: `checkTorznab({ url, apiKey }, fetchImpl = fetch): Promise<{ ok: true; categories: number } | { ok: false; error: string }>` — `GET {url}?t=caps&apikey=…` (`url` может уже содержать `?`); XML должен содержать `<caps`; `<error code="100"` → «Неверный API-ключ»; иначе «Ответ не похож на Torznab». Таймаут 15 с. В логах URL только через `redactUrl`.
  - `sources.ts`: `addSource(db, { name, url, apiKey })` (шифрует ключ), `listSources(db): { id; name; url; enabled }[]` (без ключа), `removeSource(db, id)`.
  - `fs-check.ts`: `checkWritableDir(p: string): Promise<{ ok: true } | { ok: false; error: string }>` — абсолютный путь, существует, это каталог, запись и удаление временного файла `.dublyarr-write-test-<rand>`. Ошибки: «Нужен абсолютный путь», «Папка не найдена», «Это не папка», «Нет прав на запись».
  - Настройки: `setSecretSetting(db, 'qbittorrent', QbitConfig)`, `setSetting(db, 'paths', { downloads: string; media: string })`.

Поведение (Review Focus №5):
- `/setup` (шаг account): если пользователь уже есть → `redirect(session ? '/setup/<текущий шаг>' : '/login')`. Форма: логин (по умолчанию `admin`), пароль, повтор пароля; `validateNewPassword`; `createUser` → сразу `createSession(persistent: true)` → `/setup/qbittorrent`.
- Шаги qbittorrent/sources/folders требуют `requireSession()`; если `setup.completed` — `redirect('/')`.
- `(app)/layout.tsx`: после `requireSession()` — если `getSetupState(db).step !== 'done'` → `redirect('/setup/<step>')`.
- qBittorrent: поля адрес (`http://192.168.1.10:8080`), логин, пароль; кнопка «Проверить» (показывает «Подключено · qBittorrent v5.0.2» зелёным-progress или ошибку danger) и «Сохранить и дальше» (сохраняет только после успешной проверки; сама выполняет проверку). «Пропустить» → `skipped`.
- Источники: список добавленных (имя, адрес моно-шрифтом, «Удалить»), форма «Название / Адрес Torznab / API-ключ» + «Проверить и добавить». Подсказка: «Для Jackett: адрес вида http://jackett:9117/api/v2.0/indexers/all/results/torznab/». «Дальше» активна при ≥ 1 источнике; «Пропустить».
- Папки: «Загрузки (куда качает qBittorrent)» и «Медиатека (где смотрит VidHub)», оба проверяются `checkWritableDir`; «Готово» → `completeSetup` → `/`.
- Вёрстка: как экран входа (`AuthAside` слева на desktop), справа колонка 480 px: сверху шаги «1 Аккаунт · 2 qBittorrent · 3 Источники · 4 Папки» (текущий — accent, пройденный — text-2 с галочкой, будущий — faint), заголовок шага `font-display 28px`, поясняющий абзац `text-muted`.

- [ ] **Step 1: Failing tests**

```ts
// tests/unit/qbittorrent.test.ts
import { expect, test } from 'vitest';
import { checkQbittorrent } from '@/lib/integrations/qbittorrent';

const cfg = { url: 'http://q:8080', username: 'admin', password: 'pw' };
function fakeFetch(map: Record<string, () => Response>) {
  return (async (input: RequestInfo | URL) => {
    const key = new URL(String(input)).pathname;
    const f = map[key];
    if (!f) throw new Error('unexpected ' + key);
    return f();
  }) as typeof fetch;
}

test('успешное подключение', async () => {
  const f = fakeFetch({
    '/api/v2/auth/login': () => new Response('Ok.', { headers: { 'set-cookie': 'SID=abc; HttpOnly; path=/' } }),
    '/api/v2/app/version': () => new Response('v5.0.2'),
  });
  expect(await checkQbittorrent(cfg, f)).toEqual({ ok: true, version: 'v5.0.2' });
});

test('неверный пароль', async () => {
  const f = fakeFetch({ '/api/v2/auth/login': () => new Response('Fails.') });
  expect(await checkQbittorrent(cfg, f)).toEqual({ ok: false, error: 'Неверный логин или пароль qBittorrent' });
});

test('бан по IP', async () => {
  const f = fakeFetch({ '/api/v2/auth/login': () => new Response('', { status: 403 }) });
  expect(await checkQbittorrent(cfg, f)).toEqual({ ok: false, error: 'IP заблокирован qBittorrent после неудачных входов' });
});

test('недоступен', async () => {
  const f = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
  const r = await checkQbittorrent(cfg, f);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toMatch(/^qBittorrent не отвечает/);
});
```

```ts
// tests/unit/torznab.test.ts
import { expect, test } from 'vitest';
import { checkTorznab } from '@/lib/integrations/torznab';

const caps = `<?xml version="1.0"?><caps><server title="Jackett"/><categories><category id="5000" name="TV"/><category id="2000" name="Movies"/></categories></caps>`;

test('caps → ok, ключ передаётся, существующий query сохраняется', async () => {
  let seen = '';
  const f = (async (u: RequestInfo | URL) => { seen = String(u); return new Response(caps); }) as typeof fetch;
  expect(await checkTorznab({ url: 'http://j:9117/api/v2.0/indexers/all/results/torznab/', apiKey: 'K' }, f)).toEqual({ ok: true, categories: 2 });
  expect(seen).toBe('http://j:9117/api/v2.0/indexers/all/results/torznab/?t=caps&apikey=K');
  await checkTorznab({ url: 'http://p/1/api?x=1', apiKey: 'K' }, f);
  expect(seen).toBe('http://p/1/api?x=1&t=caps&apikey=K');
});

test('неверный ключ и не-Torznab', async () => {
  const bad = (async () => new Response('<error code="100" description="Invalid API Key"/>')) as typeof fetch;
  expect(await checkTorznab({ url: 'http://j/', apiKey: 'x' }, bad)).toEqual({ ok: false, error: 'Неверный API-ключ' });
  const html = (async () => new Response('<html>')) as typeof fetch;
  expect(await checkTorznab({ url: 'http://j/', apiKey: 'x' }, html)).toEqual({ ok: false, error: 'Ответ не похож на Torznab' });
});
```

```ts
// tests/unit/fs-check.test.ts
import { expect, test } from 'vitest';
import { mkdtempSync, writeFileSync, readdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkWritableDir } from '@/lib/fs-check';

test('проверка папки', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dy-'));
  expect(await checkWritableDir(dir)).toEqual({ ok: true });
  expect(readdirSync(dir)).toEqual([]); // тестовый файл удалён
  expect(await checkWritableDir('rel/path')).toEqual({ ok: false, error: 'Нужен абсолютный путь' });
  expect(await checkWritableDir(path.join(dir, 'nope'))).toEqual({ ok: false, error: 'Папка не найдена' });
  const f = path.join(dir, 'file'); writeFileSync(f, '');
  expect(await checkWritableDir(f)).toEqual({ ok: false, error: 'Это не папка' });
  const ro = path.join(dir, 'ro'); mkdtempSync(ro); // создаёт ro + суффикс
});

test.skipIf(process.getuid?.() === 0)('нет прав на запись', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dy-ro-'));
  chmodSync(dir, 0o500);
  expect(await checkWritableDir(dir)).toEqual({ ok: false, error: 'Нет прав на запись' });
  chmodSync(dir, 0o700);
});
```

(Строку `mkdtempSync(ro)` в первом тесте удалить — она лишняя; права проверяются во втором тесте.)

```ts
// tests/unit/setup.test.ts
import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { createUser } from '@/lib/auth/users';
import { getSetupState, markStep, completeSetup } from '@/lib/setup';
import { addSource, listSources } from '@/lib/sources';
import { sources } from '@/lib/db/schema';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');

test('порядок шагов мастера', async () => {
  const db = testDb();
  expect(getSetupState(db).step).toBe('account');
  await createUser(db, 'admin', 'пароль-длинный');
  expect(getSetupState(db).step).toBe('qbittorrent');
  markStep(db, 'qbittorrent', 'skipped');
  expect(getSetupState(db).step).toBe('sources');
  markStep(db, 'sources', 'done');
  markStep(db, 'folders', 'done');
  expect(getSetupState(db).step).toBe('folders'); // пока не завершён явно
  completeSetup(db);
  expect(getSetupState(db)).toEqual({ step: 'done', completed: ['account', 'qbittorrent', 'sources', 'folders'] });
});

test('ключ источника хранится зашифрованным и не отдаётся в списке', () => {
  const db = testDb();
  addSource(db, { name: 'Jackett', url: 'http://j/', apiKey: 'SECRETKEY' });
  expect(db.select().from(sources).get()!.apiKeyEnc).not.toContain('SECRETKEY');
  expect(listSources(db)).toEqual([{ id: 1, name: 'Jackett', url: 'http://j/', enabled: true }]);
});
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** модули:

```ts
// src/lib/integrations/qbittorrent.ts
export type QbitConfig = { url: string; username: string; password: string };
type Result = { ok: true; version: string } | { ok: false; error: string };

export async function checkQbittorrent(cfg: QbitConfig, fetchImpl: typeof fetch = fetch): Promise<Result> {
  const base = cfg.url.replace(/\/+$/, '');
  try {
    const login = await fetchImpl(`${base}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: base },
      body: new URLSearchParams({ username: cfg.username, password: cfg.password }),
      signal: AbortSignal.timeout(10_000),
    });
    if (login.status === 403) return { ok: false, error: 'IP заблокирован qBittorrent после неудачных входов' };
    const text = (await login.text()).trim();
    const sid = /SID=([^;]+)/.exec(login.headers.get('set-cookie') ?? '')?.[1];
    if (text !== 'Ok.' || !sid) return { ok: false, error: 'Неверный логин или пароль qBittorrent' };
    const v = await fetchImpl(`${base}/api/v2/app/version`, { headers: { Cookie: `SID=${sid}` }, signal: AbortSignal.timeout(10_000) });
    if (!v.ok) return { ok: false, error: `qBittorrent не отвечает: HTTP ${v.status}` };
    return { ok: true, version: (await v.text()).trim() };
  } catch (e) {
    return { ok: false, error: `qBittorrent не отвечает: ${e instanceof Error ? e.message : String(e)}` };
  }
}
```

```ts
// src/lib/integrations/torznab.ts
import { log, redactUrl } from '../log';
type Result = { ok: true; categories: number } | { ok: false; error: string };

export async function checkTorznab(s: { url: string; apiKey: string }, fetchImpl: typeof fetch = fetch): Promise<Result> {
  const url = `${s.url}${s.url.includes('?') ? '&' : '?'}t=caps&apikey=${encodeURIComponent(s.apiKey)}`;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    const xml = await res.text();
    if (/<error[^>]*code="100"/.test(xml)) return { ok: false, error: 'Неверный API-ключ' };
    if (!/<caps[\s>]/.test(xml)) return { ok: false, error: 'Ответ не похож на Torznab' };
    return { ok: true, categories: (xml.match(/<category\s/g) ?? []).length };
  } catch (e) {
    log.warn({ url: redactUrl(url), err: e instanceof Error ? e.message : String(e) }, 'torznab caps failed');
    return { ok: false, error: `Источник не отвечает: ${e instanceof Error ? e.message : String(e)}` };
  }
}
```

```ts
// src/lib/fs-check.ts
import { stat, writeFile, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

export async function checkWritableDir(p: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!path.isAbsolute(p)) return { ok: false, error: 'Нужен абсолютный путь' };
  try { if (!(await stat(p)).isDirectory()) return { ok: false, error: 'Это не папка' }; }
  catch { return { ok: false, error: 'Папка не найдена' }; }
  const probe = path.join(p, `.dublyarr-write-test-${randomBytes(4).toString('hex')}`);
  try { await writeFile(probe, ''); await unlink(probe); return { ok: true }; }
  catch { return { ok: false, error: 'Нет прав на запись' }; }
}
```

```ts
// src/lib/setup.ts
import type { Db } from './db/client';
import { getSetting, setSetting } from './settings';
import { hasAnyUser } from './auth/users';

export type SetupStep = 'account' | 'qbittorrent' | 'sources' | 'folders' | 'done';
export const SETUP_ORDER = ['account', 'qbittorrent', 'sources', 'folders'] as const;

export function getSetupState(db: Db): { step: SetupStep; completed: SetupStep[] } {
  const completed: SetupStep[] = [];
  if (!hasAnyUser(db)) return { step: 'account', completed };
  completed.push('account');
  for (const s of ['qbittorrent', 'sources', 'folders'] as const) {
    if (!getSetting<string>(db, `setup.${s}`)) return { step: s, completed };
    completed.push(s);
  }
  return { step: getSetting<boolean>(db, 'setup.completed') ? 'done' : 'folders', completed };
}
export const markStep = (db: Db, step: 'qbittorrent' | 'sources' | 'folders', how: 'done' | 'skipped') => setSetting(db, `setup.${step}`, how);
export const completeSetup = (db: Db) => setSetting(db, 'setup.completed', true);
```

```ts
// src/lib/sources.ts
import { eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { sources } from './db/schema';
import { encrypt } from './crypto/secretbox';

export function addSource(db: Db, s: { name: string; url: string; apiKey: string }) {
  return db.insert(sources).values({ name: s.name.trim(), url: s.url.trim(), apiKeyEnc: s.apiKey ? encrypt(s.apiKey) : null, createdAt: Date.now() }).returning({ id: sources.id }).get();
}
export const listSources = (db: Db) =>
  db.select({ id: sources.id, name: sources.name, url: sources.url, enabled: sources.enabled }).from(sources).all();
export const removeSource = (db: Db, id: number) => db.delete(sources).where(eq(sources.id, id)).run();
```

- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Страницы и actions** по описанию выше; `(app)/layout.tsx` — добавить редирект на незавершённый шаг.
- [ ] **Step 6: Ручная проверка** с чистым `DATA_DIR`: `/` → `/setup` → аккаунт → пропуск qBittorrent → источник (если под рукой Jackett — реальный, иначе пропуск) → папки `/tmp` → `/`. Повторный `/setup` в приватном окне → `/login`.
- [ ] **Step 7: Commit** `feat: мастер первого запуска`.

---

### Task 11: «Настройки → Безопасность»

**Files:**
- Create: `src/app/(app)/settings/security/page.tsx`, `src/app/(app)/settings/security/actions.ts`,
  `src/app/(app)/settings/security/{TwoFactorCard,SessionsCard,PasswordCard}.tsx`, `src/lib/auth/describe-ua.ts`
- Test: `tests/unit/describe-ua.test.ts`, `tests/unit/twofa-flow.test.ts`

**Interfaces:**
- Consumes: users/sessions/totp (Tasks 5–6), `requireSession`, `requestContext`.
- Produces:
  - `describeUserAgent(ua: string | null): string` — «Safari · iPhone», «Chrome · macOS», «Firefox · Windows», «VidHub/неизвестно» → «Неизвестное устройство».
  - `src/lib/auth/twofa.ts`: `startTotpSetup(db, userId): { secret: string; uri: string }` (генерирует и сохраняет **неактивный** секрет); `confirmTotpSetup(db, userId, code, now): boolean` (верный код → `enableTotp` + `markTotpStep`); `disableTotp(db, userId)` (= `setTotpSecret(null)` + `revokeTrustedDevices`).
  - Actions: `startTotpAction()`, `confirmTotpAction(prev, form)`, `disableTotpAction(prev, form)` (требует текущий пароль), `changePasswordAction(prev, form)` (текущий, новый, повтор; после смены — `revokeAllSessions(except current)` + `revokeTrustedDevices`), `revokeSessionAction(form)` (id), `logoutEverywhereAction()` (все, кроме текущего, + доверенные устройства).

Экран (сетка карточек как в `Settings.dc.html`, заголовок раздела 24 px + абзац muted):
1. **Двухфакторная защита.** Выключена: текст «Код из приложения-аутентификатора при входе с нового устройства» + кнопка «Включить». После «Включить»: QR (`qrcode.toDataURL(uri, { margin: 1, width: 200, color: { dark: '#121110', light: '#F3EFE8' } })`), под ним секрет моно-шрифтом группами по 4 («Или введи ключ вручную»), `CodeInput` + «Подтвердить». Включена: статус «Включена» (accent), кнопка «Выключить» (secondary) → подтверждение паролем.
2. **Пароль.** Три поля + «Сменить пароль». Подпись: «Все остальные сеансы завершатся».
3. **Активные сеансы.** Таблица: устройство (`describeUserAgent`), IP (mono), последний вход (`Intl.RelativeTimeFormat('ru')`), «Это устройство» для текущего, у остальных кнопка «Завершить». Внизу кнопка destructive «Выйти везде, кроме этого устройства». Подпись: «Доверенные устройства тоже будут спрашивать код».

- [ ] **Step 1: Failing tests**

```ts
// tests/unit/describe-ua.test.ts
import { expect, test } from 'vitest';
import { describeUserAgent } from '@/lib/auth/describe-ua';
test.each([
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 'Safari · iPhone'],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36', 'Chrome · macOS'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0', 'Firefox · Windows'],
  ['Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36', 'Chrome · Android'],
  [null, 'Неизвестное устройство'],
  ['curl/8.0', 'Неизвестное устройство'],
])('%s', (ua, expected) => expect(describeUserAgent(ua)).toBe(expected));
```

```ts
// tests/unit/twofa-flow.test.ts
import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { createUser, getUser } from '@/lib/auth/users';
import { startTotpSetup, confirmTotpSetup, disableTotp } from '@/lib/auth/twofa';
import { createTrustedDevice, isTrustedDevice } from '@/lib/auth/sessions';
import { totpAt, currentStep } from '@/lib/auth/totp';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const now = 1_800_000_000_000;

test('включение 2FA только после верного кода; выключение отзывает доверенные устройства', async () => {
  const db = testDb();
  const u = await createUser(db, 'admin', 'пароль-длинный');
  const { secret, uri } = startTotpSetup(db, u.id);
  expect(uri).toContain(secret);
  expect(getUser(db, u.id)!.totpEnabled).toBe(false);
  expect(confirmTotpSetup(db, u.id, '000000', now)).toBe(false);
  expect(confirmTotpSetup(db, u.id, totpAt(secret, currentStep(now)), now)).toBe(true);
  expect(getUser(db, u.id)!.totpEnabled).toBe(true);
  const d = createTrustedDevice(db, u.id, null, now);
  disableTotp(db, u.id);
  expect(getUser(db, u.id)!.totpEnabled).toBe(false);
  expect(isTrustedDevice(db, d.token, u.id, now)).toBe(false);
});
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**

```ts
// src/lib/auth/twofa.ts
import type { Db } from '../db/client';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp';
import { setTotpSecret, enableTotp, getUser, getTotpSecret, markTotpStep } from './users';
import { revokeTrustedDevices } from './sessions';

export function startTotpSetup(db: Db, userId: number) {
  const secret = generateTotpSecret();
  setTotpSecret(db, userId, secret);
  return { secret, uri: otpauthUri(secret, getUser(db, userId)!.username) };
}
export function confirmTotpSetup(db: Db, userId: number, code: string, now = Date.now()): boolean {
  const u = getUser(db, userId);
  const secret = u && getTotpSecret(u);
  if (!secret) return false;
  const v = verifyTotp(secret, code, now, null);
  if (!v.ok) return false;
  enableTotp(db, userId);
  markTotpStep(db, userId, v.step);
  return true;
}
export function disableTotp(db: Db, userId: number) { setTotpSecret(db, userId, null); revokeTrustedDevices(db, userId); }
```

```ts
// src/lib/auth/describe-ua.ts
export function describeUserAgent(ua: string | null): string {
  if (!ua) return 'Неизвестное устройство';
  const browser = /Firefox\//.test(ua) ? 'Firefox' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : null;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : null;
  return browser && os ? `${browser} · ${os}` : 'Неизвестное устройство';
}
```

- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Страница и actions**, добавить `/settings/security` в меню настроек и в `/more`.
- [ ] **Step 6: Ручная проверка:** включить 2FA, отсканировать QR в приложении, выйти, войти с кодом; «не спрашивать 30 дней» → повторный вход без кода; «Выйти везде».
- [ ] **Step 7: Commit** `feat: настройки безопасности (2FA, пароль, сеансы)`.

---

### Task 12: Воркер, заглушка laya-serve, супервизор, CLI

**Files:**
- Create: `src/lib/heartbeat.ts` (заменить заглушку), `src/worker/main.ts`, `src/worker/jobs.ts`, `src/entry/backoff.ts`, `src/entry/supervisor.ts`,
  `src/cli/main.ts`, `src/cli/reset-password.ts`, `laya/serve.py`, `bin/dublyarr`, `esbuild.mjs`, `src/app/api/health/route.ts`
- Test: `tests/unit/heartbeat.test.ts`, `tests/unit/jobs.test.ts`, `tests/unit/backoff.test.ts`, `tests/unit/reset-password.test.ts`, `tests/unit/supervisor.test.ts`

**Interfaces:**
- Produces:
  - `heartbeat.ts`: `beat(db, name: 'worker'|'laya', ok: boolean, info?: string, now?)`; `serviceStatuses(db, now = Date.now()): { name: string; state: 'ok'|'warn'|'off'; note: string }[]` → `[{ name: 'Воркер', … }, { name: 'Laya', … }]`: воркер — `ok`/«работает», если beat < 30 с, иначе `off`/«не отвечает»; Laya — `ok`/«работает», если последний beat ok и < 3 мин; `warn`/«недоступна», если ok=false; `off`/«нет данных», если записи нет.
  - `jobs.ts`: `enqueue(db, type, payload = {}, runAt = Date.now())`; `claimNext(db, now): Job | undefined` (атомарно `UPDATE jobs SET status='running' WHERE id = (SELECT id … status='queued' AND run_at <= now ORDER BY run_at LIMIT 1) RETURNING *`); `finish(db, id, error?: string)` (ошибка → `failed` при `attempts >= 3`, иначе `queued` с `run_at = now + 60 000 * 2^attempts`); `type Handler = (payload: unknown) => Promise<void>`; `runOnce(db, handlers: Record<string, Handler>, now): Promise<boolean>`; при старте воркера `requeueStale(db)` — `running` → `queued`.
  - `worker/main.ts`: `DUBLYARR_PROCESS=worker`, цикл каждые 5 с: `beat(worker)`, `runOnce`; каждые 60 с — `GET http://127.0.0.1:${layaPort}/health` (таймаут 3 с) → `beat(laya, ok, info)`. SIGTERM → закончить текущую задачу и выйти.
  - `backoff.ts`: `restartDelay(failuresInRow: number): number` = `min(1000 * 2^n, 30 000)`; `shouldResetFailures(uptimeMs: number): boolean` = `uptimeMs >= 60 000`.
  - `supervisor.ts`: `startSupervisor({ children: ChildSpec[], spawnImpl?, log? }): { stop(): Promise<void> }`, `type ChildSpec = { name: string; command: string; args: string[]; env?: Record<string,string> }`. Main-блок (при запуске файла): `loadMasterKey` (если ключ сгенерирован в файл — `log.warn('DUBLYARR_SECRET_KEY не задан — ключ сохранён в /data/secret.key; держите его в бэкапе вместе с базой')`), `migrateDb(openDb(dbPath))`, запуск детей: `web` = `node node_modules/next/dist/bin/next start -p $PORT -H 0.0.0.0`, `worker` = `node dist/worker.cjs`, `laya` = `python3 laya/serve.py --port $LAYA_PORT`. SIGTERM/SIGINT → SIGTERM детям, ждать до 10 с, затем SIGKILL, выход 0.
  - `cli/reset-password.ts`: `resetPassword(db, { password: string; disable2fa: boolean }): Promise<{ username: string }>` — валидирует `validateNewPassword` (бросает Error с текстом), `setPassword`, `revokeAllSessions`, `revokeTrustedDevices`, при `disable2fa` — `setTotpSecret(null)`. Ошибка «Пользователь ещё не создан — откройте Dublyarr в браузере».
  - `cli/main.ts`: `dublyarr reset-password [--disable-2fa]` — пароль читается дважды со скрытым вводом (`readline` + muted output) или из stdin, если не TTY (`--password-stdin` не нужен). `dublyarr help`.
  - `laya/serve.py`: `http.server` на `127.0.0.1:<port>`, `GET /health` → `{"status":"stub","model":null}` 200; остальное 404.
  - `/api/health` → `{ ok: true }` (для Docker HEALTHCHECK, без БД).
  - `esbuild.mjs`: бандлы `src/worker/main.ts → dist/worker.cjs`, `src/entry/supervisor.ts → dist/supervisor.cjs`, `src/cli/main.ts → dist/cli.cjs`; `platform: 'node'`, `target: 'node24'`, `format: 'cjs'`, `external: ['better-sqlite3', '@node-rs/argon2', 'pino']`, alias `@` → `src`.

- [ ] **Step 1: Failing tests**

```ts
// tests/unit/backoff.test.ts
import { expect, test } from 'vitest';
import { restartDelay, shouldResetFailures } from '@/entry/backoff';
test('экспоненциальная задержка с потолком', () => {
  expect([0, 1, 2, 3, 4, 5, 10].map(restartDelay)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  expect(shouldResetFailures(59_999)).toBe(false);
  expect(shouldResetFailures(60_000)).toBe(true);
});
```

```ts
// tests/unit/jobs.test.ts
import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { enqueue, runOnce, requeueStale } from '@/worker/jobs';
import { jobs } from '@/lib/db/schema';

test('задача выполняется один раз, ошибка → повтор с задержкой, после 3 попыток failed', async () => {
  const db = testDb();
  const t = 1_800_000_000_000;
  enqueue(db, 'ok', {}, t);
  enqueue(db, 'boom', {}, t);
  const seen: string[] = [];
  const handlers = { ok: async () => { seen.push('ok'); }, boom: async () => { throw new Error('упало'); } };
  expect(await runOnce(db, handlers, t)).toBe(true);
  expect(await runOnce(db, handlers, t)).toBe(true);
  expect(await runOnce(db, handlers, t)).toBe(false);
  expect(seen).toEqual(['ok']);
  let boom = db.select().from(jobs).all().find((j) => j.type === 'boom')!;
  expect(boom).toMatchObject({ status: 'queued', attempts: 1, lastError: 'упало' });
  expect(boom.runAt).toBe(t + 120_000);
  await runOnce(db, handlers, t + 10 ** 7);
  await runOnce(db, handlers, t + 10 ** 8);
  boom = db.select().from(jobs).all().find((j) => j.type === 'boom')!;
  expect(boom.status).toBe('failed');
});

test('неизвестный тип — failed сразу; зависшие running возвращаются в очередь', async () => {
  const db = testDb();
  enqueue(db, 'nope', {}, 0);
  await runOnce(db, {}, 1);
  expect(db.select().from(jobs).get()!.status).toBe('failed');
  enqueue(db, 'x', {}, 0);
  db.update(jobs).set({ status: 'running' }).run();
  requeueStale(db);
  expect(db.select().from(jobs).all().every((j) => j.status === 'queued')).toBe(true);
});
```

```ts
// tests/unit/heartbeat.test.ts
import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { beat, serviceStatuses } from '@/lib/heartbeat';

test('статусы сервисов', () => {
  const db = testDb();
  const t = 1_800_000_000_000;
  expect(serviceStatuses(db, t)).toEqual([
    { name: 'Воркер', state: 'off', note: 'не отвечает' },
    { name: 'Laya', state: 'off', note: 'нет данных' },
  ]);
  beat(db, 'worker', true, undefined, t);
  beat(db, 'laya', false, 'ECONNREFUSED', t);
  expect(serviceStatuses(db, t + 1000)).toEqual([
    { name: 'Воркер', state: 'ok', note: 'работает' },
    { name: 'Laya', state: 'warn', note: 'недоступна' },
  ]);
  expect(serviceStatuses(db, t + 31_000)[0].state).toBe('off');
});
```

```ts
// tests/unit/reset-password.test.ts
import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { createUser, setTotpSecret, enableTotp, getUser, findUserByName } from '@/lib/auth/users';
import { createSession, validateSession } from '@/lib/auth/sessions';
import { verifyPassword } from '@/lib/auth/password';
import { resetPassword } from '@/cli/reset-password';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');

test('сброс пароля завершает сеансы; --disable-2fa выключает 2FA', async () => {
  const db = testDb();
  await expect(resetPassword(db, { password: 'новый-пароль-1', disable2fa: false })).rejects.toThrow('Пользователь ещё не создан');
  const u = await createUser(db, 'admin', 'старый-пароль-1');
  setTotpSecret(db, u.id, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'); enableTotp(db, u.id);
  const s = createSession(db, { userId: u.id, persistent: true, userAgent: null, ip: null });
  await expect(resetPassword(db, { password: 'короткий', disable2fa: false })).rejects.toThrow('не короче 10');
  expect(await resetPassword(db, { password: 'новый-пароль-1', disable2fa: false })).toEqual({ username: 'admin' });
  expect(await verifyPassword(findUserByName(db, 'admin')!.passwordHash, 'новый-пароль-1')).toBe(true);
  expect(validateSession(db, s.token)).toBeNull();
  expect(getUser(db, u.id)!.totpEnabled).toBe(true);
  await resetPassword(db, { password: 'новый-пароль-2', disable2fa: true });
  expect(getUser(db, u.id)!.totpEnabled).toBe(false);
});
```

```ts
// tests/unit/supervisor.test.ts
import { expect, test } from 'vitest';
import { startSupervisor } from '@/entry/supervisor';

test('упавший процесс перезапускается, stop гасит всех', async () => {
  const starts: string[] = [];
  const sup = startSupervisor({
    children: [
      { name: 'crashy', command: process.execPath, args: ['-e', 'process.exit(1)'] },
      { name: 'steady', command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'] },
    ],
    onStart: (name) => starts.push(name),
    delayFor: () => 50, // ускоряем backoff в тесте
  });
  await new Promise((r) => setTimeout(r, 600));
  expect(starts.filter((n) => n === 'crashy').length).toBeGreaterThanOrEqual(3);
  expect(starts.filter((n) => n === 'steady')).toHaveLength(1);
  await sup.stop();
}, 10_000);
```

(Сигнатура `startSupervisor` расширяется необязательными `onStart?: (name: string) => void` и `delayFor?: (failures: number) => number` — по умолчанию `restartDelay`.)

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**

```ts
// src/entry/backoff.ts
export const restartDelay = (n: number) => Math.min(1000 * 2 ** n, 30_000);
export const shouldResetFailures = (uptimeMs: number) => uptimeMs >= 60_000;
```

```ts
// src/entry/supervisor.ts
import { spawn, type ChildProcess } from 'node:child_process';
import { restartDelay, shouldResetFailures } from './backoff';

export type ChildSpec = { name: string; command: string; args: string[]; env?: Record<string, string> };
type Opts = { children: ChildSpec[]; onStart?: (name: string) => void; delayFor?: (failures: number) => number; logger?: Pick<Console, 'info' | 'error'> };

export function startSupervisor(o: Opts) {
  const procs = new Map<string, ChildProcess>();
  let stopping = false;
  const delayFor = o.delayFor ?? restartDelay;
  const logger = o.logger ?? console;

  function run(spec: ChildSpec, failures: number) {
    if (stopping) return;
    const startedAt = Date.now();
    const p = spawn(spec.command, spec.args, { stdio: 'inherit', env: { ...process.env, ...spec.env, DUBLYARR_PROCESS: spec.name } });
    procs.set(spec.name, p);
    o.onStart?.(spec.name);
    p.on('exit', (code, signal) => {
      procs.delete(spec.name);
      if (stopping) return;
      const f = shouldResetFailures(Date.now() - startedAt) ? 0 : failures;
      const delay = delayFor(f);
      logger.error(`[supervisor] ${spec.name} завершился (code=${code}, signal=${signal}), перезапуск через ${delay} мс`);
      setTimeout(() => run(spec, f + 1), delay);
    });
  }
  for (const c of o.children) run(c, 0);

  return {
    async stop() {
      stopping = true;
      const alive = [...procs.values()];
      await Promise.all(alive.map((p) => new Promise<void>((resolve) => {
        const kill = setTimeout(() => p.kill('SIGKILL'), 10_000);
        p.once('exit', () => { clearTimeout(kill); resolve(); });
        p.kill('SIGTERM');
      })));
    },
  };
}

// Точка входа контейнера
if (require.main === module) {
  // импорты рантайма — внутри, чтобы тесты не тянули БД
  const { loadConfig } = require('../lib/config') as typeof import('../lib/config');
  const { openDb, migrateDb } = require('../lib/db/client') as typeof import('../lib/db/client');
  const { loadMasterKey } = require('../lib/crypto/key') as typeof import('../lib/crypto/key');
  const { existsSync } = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const cfg = loadConfig();
  const keyFile = path.join(cfg.dataDir, 'secret.key');
  const hadKeyFile = existsSync(keyFile);
  loadMasterKey(cfg);
  if (!cfg.secretKeyEnv && !hadKeyFile) console.warn(`[supervisor] DUBLYARR_SECRET_KEY не задан — ключ сохранён в ${keyFile}; держите его в бэкапе вместе с базой`);
  const db = openDb(cfg.dbPath); migrateDb(db); db.$client.close();
  const sup = startSupervisor({ children: [
    { name: 'web', command: process.execPath, args: ['node_modules/next/dist/bin/next', 'start', '-p', String(cfg.port), '-H', '0.0.0.0'] },
    { name: 'worker', command: process.execPath, args: ['dist/worker.cjs'] },
    { name: 'laya', command: 'python3', args: ['laya/serve.py', '--port', String(cfg.layaPort)] },
  ] });
  const shutdown = () => { sup.stop().then(() => process.exit(0)); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
```

(В vitest `require.main !== module`, так что блок не выполняется. Если ESLint ругается на `require` — `// eslint-disable-next-line @typescript-eslint/no-require-imports` у блока.)

```ts
// src/worker/jobs.ts
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../lib/db/client';
import { jobs } from '../lib/db/schema';
import { log } from '../lib/log';

export type Job = typeof jobs.$inferSelect;
export type Handler = (payload: unknown) => Promise<void>;
const MAX_ATTEMPTS = 3;

export function enqueue(db: Db, type: string, payload: unknown = {}, runAt = Date.now()) {
  const now = Date.now();
  db.insert(jobs).values({ type, payload: JSON.stringify(payload), runAt, createdAt: now, updatedAt: now }).run();
}

export function claimNext(db: Db, now = Date.now()): Job | undefined {
  return db.$client.prepare(`UPDATE jobs SET status='running', attempts=attempts+1, updated_at=@now
    WHERE id = (SELECT id FROM jobs WHERE status='queued' AND run_at <= @now ORDER BY run_at, id LIMIT 1)
    RETURNING id, type, payload, status, run_at AS runAt, attempts, last_error AS lastError, created_at AS createdAt, updated_at AS updatedAt`)
    .get({ now }) as Job | undefined;
}

export function finish(db: Db, job: Job, error: string | undefined, now = Date.now()) {
  if (!error) { db.update(jobs).set({ status: 'done', lastError: null, updatedAt: now }).where(eq(jobs.id, job.id)).run(); return; }
  const failed = job.attempts >= MAX_ATTEMPTS;
  db.update(jobs).set({
    status: failed ? 'failed' : 'queued', lastError: error, updatedAt: now,
    runAt: failed ? job.runAt : now + 60_000 * 2 ** job.attempts,
  }).where(eq(jobs.id, job.id)).run();
}

export async function runOnce(db: Db, handlers: Record<string, Handler>, now = Date.now()): Promise<boolean> {
  const job = claimNext(db, now);
  if (!job) return false;
  const h = handlers[job.type];
  if (!h) { db.update(jobs).set({ status: 'failed', lastError: `Неизвестный тип задачи: ${job.type}`, updatedAt: now }).where(eq(jobs.id, job.id)).run(); return true; }
  try { await h(JSON.parse(job.payload)); finish(db, job, undefined, now); }
  catch (e) { const msg = e instanceof Error ? e.message : String(e); log.error({ job: job.id, type: job.type, err: msg }, 'job failed'); finish(db, job, msg, now); }
  return true;
}

export const requeueStale = (db: Db) => db.update(jobs).set({ status: 'queued' }).where(eq(jobs.status, 'running')).run();
void sql;
```

(Тест ожидает `runAt = t + 120 000` после первой неудачи: attempts станет 1 при claim → `60 000 * 2^1`. Строку `void sql` и импорт `sql` убрать, если не нужен.)

```ts
// src/lib/heartbeat.ts
import { eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { heartbeats } from './db/schema';

export function beat(db: Db, name: 'worker' | 'laya', ok: boolean, info?: string, now = Date.now()) {
  const row = { name, ok, info: info ?? null, at: now };
  db.insert(heartbeats).values(row).onConflictDoUpdate({ target: heartbeats.name, set: row }).run();
}

type Status = { name: string; state: 'ok' | 'warn' | 'off'; note: string };
export function serviceStatuses(db: Db, now = Date.now()): Status[] {
  const get = (n: string) => db.select().from(heartbeats).where(eq(heartbeats.name, n)).get();
  const w = get('worker'), l = get('laya');
  const worker: Status = w && now - w.at < 30_000 ? { name: 'Воркер', state: 'ok', note: 'работает' } : { name: 'Воркер', state: 'off', note: 'не отвечает' };
  const laya: Status = !l ? { name: 'Laya', state: 'off', note: 'нет данных' }
    : l.ok && now - l.at < 180_000 ? { name: 'Laya', state: 'ok', note: 'работает' }
    : { name: 'Laya', state: 'warn', note: 'недоступна' };
  return [worker, laya];
}
```

```ts
// src/worker/main.ts
import { getDb } from '../lib/db/client';
import { getConfig } from '../lib/config';
import { log } from '../lib/log';
import { beat } from '../lib/heartbeat';
import { runOnce, requeueStale, type Handler } from './jobs';

const handlers: Record<string, Handler> = {};
const db = getDb();
let stopping = false;
let lastLaya = 0;

async function checkLaya() {
  try {
    const r = await fetch(`http://127.0.0.1:${getConfig().layaPort}/health`, { signal: AbortSignal.timeout(3000) });
    beat(db, 'laya', r.ok, await r.text());
  } catch (e) { beat(db, 'laya', false, e instanceof Error ? e.message : String(e)); }
}

async function loop() {
  requeueStale(db);
  log.info('worker started');
  while (!stopping) {
    beat(db, 'worker', true);
    if (Date.now() - lastLaya > 60_000) { lastLaya = Date.now(); await checkLaya(); }
    while (!stopping && (await runOnce(db, handlers))) { /* выбираем очередь */ }
    await new Promise((r) => setTimeout(r, 5000));
  }
  process.exit(0);
}
process.on('SIGTERM', () => { stopping = true; });
void loop();
```

```ts
// src/cli/reset-password.ts
import type { Db } from '../lib/db/client';
import { users } from '../lib/db/schema';
import { validateNewPassword } from '../lib/auth/password';
import { setPassword, setTotpSecret } from '../lib/auth/users';
import { revokeAllSessions, revokeTrustedDevices } from '../lib/auth/sessions';

export async function resetPassword(db: Db, o: { password: string; disable2fa: boolean }) {
  const u = db.select().from(users).get();
  if (!u) throw new Error('Пользователь ещё не создан — откройте Dublyarr в браузере');
  const err = validateNewPassword(o.password);
  if (err) throw new Error(err);
  await setPassword(db, u.id, o.password);
  revokeAllSessions(db, u.id);
  revokeTrustedDevices(db, u.id);
  if (o.disable2fa) setTotpSecret(db, u.id, null);
  return { username: u.username };
}
```

`src/cli/main.ts`: разбор `process.argv.slice(2)`; `reset-password` → `askHidden('Новый пароль: ')` дважды (при расхождении — «Пароли не совпадают», код 1), `resetPassword(getDb(), …)`, вывод «Пароль для admin изменён. Все сеансы завершены.» (+ «Двухфакторная защита выключена.»). Иначе — справка. Скрытый ввод: `readline.createInterface({ input, output, terminal: true })` с переопределённым `_writeToOutput`, если `stdin.isTTY`; иначе читать строки из stdin.

`laya/serve.py`:
```python
import argparse, json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            body = json.dumps({"status": "stub", "model": None}).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
        else:
            self.send_response(404); self.end_headers()
    def log_message(self, *a): pass

if __name__ == "__main__":
    p = argparse.ArgumentParser(); p.add_argument("--port", type=int, default=8765)
    ThreadingHTTPServer(("127.0.0.1", p.parse_args().port), H).serve_forever()
```

`bin/dublyarr`:
```sh
#!/bin/sh
cd /app && exec node dist/cli.cjs "$@"
```

`esbuild.mjs`:
```js
import { build } from 'esbuild';
import path from 'node:path';
const common = { bundle: true, platform: 'node', target: 'node24', format: 'cjs', external: ['better-sqlite3', '@node-rs/argon2', 'pino'],
  alias: { '@': path.resolve('src') }, logLevel: 'info' };
await Promise.all([
  build({ ...common, entryPoints: ['src/worker/main.ts'], outfile: 'dist/worker.cjs' }),
  build({ ...common, entryPoints: ['src/entry/supervisor.ts'], outfile: 'dist/supervisor.cjs' }),
  build({ ...common, entryPoints: ['src/cli/main.ts'], outfile: 'dist/cli.cjs' }),
]);
```

(`server-only` не импортируется из модулей, которые попадают в бандлы воркера/CLI — только `current.ts`.)

- [ ] **Step 4: Run** `pnpm test` — PASS; `pnpm build` — собирает `.next` и `dist/*.cjs`.
- [ ] **Step 5: Локальный прогон:** `DATA_DIR=./.data PORT=3000 pnpm start` → в логах старт трёх процессов; в сайдбаре «Воркер · работает», «Laya · работает» (через ≤ 60 с); `kill` воркера → перезапуск; Ctrl-C → все процессы гаснут. `DATA_DIR=./.data node dist/cli.cjs reset-password` работает.
- [ ] **Step 6: Commit** `feat: воркер, laya-заглушка, супервизор, CLI`.

---

### Task 13: Docker-образ, e2e входа, документация

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.example.yml`, `playwright.config.ts`, `tests/e2e/auth.spec.ts`, `README.md`
- Modify: `CLAUDE.md` (итоговые решения: без `output: 'standalone'` — образ запускает `next start` из `node_modules`; порты; env)

**Interfaces:**
- Consumes: всё выше.
- Produces: образ `dublyarr:dev` (`linux/amd64`), порт 3000, том `/data`, `HEALTHCHECK` на `/api/health`.

- [ ] **Step 1: e2e-тест (падает, пока нет конфига)**

```ts
// tests/e2e/auth.spec.ts
import { test, expect } from '@playwright/test';
import { totpAt, currentStep } from '../../src/lib/auth/totp';

test('первый запуск → 2FA → выход → вход с кодом → доверенное устройство', async ({ page, context }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);
  await page.getByLabel('Логин').fill('admin');
  await page.getByLabel('Пароль', { exact: true }).fill('очень-длинный-пароль');
  await page.getByLabel('Повторите пароль').fill('очень-длинный-пароль');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await page.getByRole('button', { name: 'Пропустить' }).click(); // qBittorrent
  await page.getByRole('button', { name: 'Пропустить' }).click(); // источники
  await page.getByLabel('Загрузки (куда качает qBittorrent)').fill(process.env.E2E_DIR!);
  await page.getByLabel('Медиатека (где смотрит VidHub)').fill(process.env.E2E_DIR!);
  await page.getByRole('button', { name: 'Готово' }).click();
  await expect(page.getByRole('heading', { name: 'Сегодня' })).toBeVisible();

  await page.goto('/settings/security');
  await page.getByRole('button', { name: 'Включить' }).click();
  const secret = (await page.getByTestId('totp-secret').innerText()).replace(/\s/g, '');
  await page.getByLabel('Код из приложения').fill(totpAt(secret, currentStep(Date.now())));
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByText('Включена')).toBeVisible();

  await page.goto('/more');
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel('Логин').fill('admin');
  await page.getByLabel('Пароль', { exact: true }).fill('очень-длинный-пароль');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { name: 'Код подтверждения' })).toBeVisible();
  // следующий шаг, чтобы не упереться в защиту от повтора кода из шага включения
  await page.getByLabel('Код из приложения').fill(totpAt(secret, currentStep(Date.now()) + 1));
  await page.getByLabel('Не спрашивать на этом устройстве 30 дней').check();
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByRole('heading', { name: 'Сегодня' })).toBeVisible();

  await context.clearCookies({ name: 'dy_session' });
  await page.goto('/login');
  await page.getByLabel('Логин').fill('admin');
  await page.getByLabel('Пароль', { exact: true }).fill('очень-длинный-пароль');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { name: 'Сегодня' })).toBeVisible(); // без кода
});
```

`CodeInput` должен иметь `aria-label="Код из приложения"` на группе и принимать `fill()` 6 цифр в первую ячейку (вставка распределяет по ячейкам). Секрет в «Безопасности» выводится с `data-testid="totp-secret"`.

`playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const dir = mkdtempSync(path.join(tmpdir(), 'dy-e2e-'));
process.env.E2E_DIR = dir;
export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: 'http://127.0.0.1:3100' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  workers: 1,
  webServer: {
    command: 'pnpm build && node dist/supervisor.cjs',
    url: 'http://127.0.0.1:3100/api/health',
    timeout: 240_000,
    env: { DATA_DIR: path.join(dir, 'data'), PORT: '3100', LAYA_PORT: '18765', DUBLYARR_SECRET_KEY: randomBytes(32).toString('base64') },
  },
});
```

(Проекты desktop и mobile делят один сервер и одну БД — второй прогон упадёт на «аккаунт уже создан». Поэтому `workers: 1` и в тесте в начале: если `/` ведёт на `/login`, проект пропускается через `test.skip(...)` — **вместо этого** запускать по одному проекту: скрипт `"e2e": "playwright test --project=desktop && E2E_FRESH=1 playwright test --project=mobile"` не решает общий сервер. Решение: для mobile — отдельный `webServer`-инстанс нельзя по проектам, значит mobile-проект запускает свой сценарий `tests/e2e/mobile-login.spec.ts` (вход уже созданным пользователем через `/login` с кодом из `E2E_SECRET` не получить). **Итог: один проект `desktop` для полного сценария; мобильная вёрстка проверяется скриншотами вручную.** Удалить проект `mobile` из конфига.)

- [ ] **Step 2: Run** `pnpm exec playwright install chromium && pnpm e2e` — после доводки селекторов PASS.

- [ ] **Step 3: Dockerfile**

```dockerfile
# syntax=docker/dockerfile:1.7
FROM --platform=linux/amd64 node:24-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build && pnpm prune --prod

FROM --platform=linux/amd64 node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends python3 mkvtoolnix ffmpeg tini ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000 LAYA_PORT=8765 NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/laya ./laya
COPY --from=build /app/public ./public
COPY bin/dublyarr /usr/local/bin/dublyarr
RUN chmod +x /usr/local/bin/dublyarr && mkdir -p /data
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/supervisor.cjs"]
```

(Если в проекте нет `public/` — создать пустой `public/.gitkeep`.) `.dockerignore`: `node_modules .next dist .data .git tests design docs playwright-report test-results`.

`docker-compose.example.yml`:
```yaml
services:
  dublyarr:
    image: dublyarr:dev
    platform: linux/amd64
    ports: ["3000:3000"]
    environment:
      DUBLYARR_SECRET_KEY: "<openssl rand -base64 32>"
      TZ: Europe/Moscow
    volumes:
      - /volume1/docker/dublyarr:/data
      - /volume1/downloads:/downloads
      - /volume1/media:/media
    restart: unless-stopped
```

- [ ] **Step 4: Сборка и проверка образа**

```bash
docker build --platform linux/amd64 -t dublyarr:dev .
docker run --rm -d --name dy -p 3000:3000 -v "$PWD/.data-docker:/data" -e DUBLYARR_SECRET_KEY="$(openssl rand -base64 32)" dublyarr:dev
sleep 20 && curl -fsS localhost:3000/api/health && docker exec dy mkvmerge --version && docker exec dy ffprobe -version | head -1 && docker exec dy dublyarr help
docker inspect --format '{{.State.Health.Status}}' dy
docker stop dy
```
Expected: `{"ok":true}`, версии mkvmerge/ffprobe, справка CLI, `healthy`, остановка < 10 с.

- [ ] **Step 5: README.md** — запуск на Synology (compose выше, генерация ключа, первый запуск, сброс пароля `docker exec -it dublyarr dublyarr reset-password [--disable-2fa]`). CLAUDE.md — обновить раздел «Решения (фаза 0)»: убрать `output: 'standalone'`, дописать env-переменные `DATA_DIR, PORT, LAYA_PORT, DUBLYARR_SECRET_KEY, LOG_LEVEL`.

- [ ] **Step 6: Финальная проверка** `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`.
- [ ] **Step 7: Commit** `feat: Docker-образ, e2e входа, документация`.
