# Dublyarr

Self-hosted сервис для одного пользователя: подписка на сериалы (и фильмы) в нужной
озвучке и качестве, автоматический поиск и докачка серий с русских трекеров.
Работает в Docker на домашнем Synology NAS. Смотрят файлы в VidHub по SMB —
медиасервера (Jellyfin/Plex) и TorrServe в системе НЕТ.

Это переписывание существующего Dublyarr с нуля на Next.js с большим редизайном.

## Где что лежит

- @docs/spec.md — продуктовая спецификация: что и как должно работать. Источник правды по поведению.
- @docs/plan.md — фазы разработки и порядок работ.
- @design/README.md — как читать макеты, дизайн-токены, соответствие экранов и файлов.
- `design/screens/*.dc.html` — макеты всех экранов (desktop + mobile).

## Стек (решено)

- Next.js (App Router) + TypeScript, строгий режим.
- SQLite (файл на томе `/data`, WAL) через `better-sqlite3` + **Drizzle** (SQL-миграции `drizzle-kit` в `drizzle/`, применяются при старте).
- Один Docker-образ: Node + Python (Laya) + MKVToolNix + ffprobe.
  Точка входа на Node запускает: веб-сервер Next.js, фоновый воркер задач, laya-serve дочерним процессом на 127.0.0.1.
- Интеграции: TMDB API, несколько Torznab-источников (Jackett, при желании Prowlarr), qBittorrent WebAPI v2,
  Telegram Bot API, Laya (локальная модель решений, Python).
- Адаптивный интерфейс с первого дня: одна кодовая база для desktop и телефона.

## Жёсткие правила

- Никакого учёта просмотров: сервис не знает, что смотрел пользователь. Никаких «непросмотренных», «продолжить просмотр».
- Laya НЕ генерирует текст — только выбор из вариантов / да-нет / оценка с уверенностью.
  Всё, где решает Laya, должно работать и без неё (словарь + правила), просто с бо́льшим числом вопросов пользователю.
- Удаление файлов — только по явным правилам хранения. Первое срабатывание нового правила — через экран подтверждения.
- Секреты (токены qBittorrent, Jackett, Telegram, TMDB) — только в зашифрованном виде в БД или в env, никогда в логах.
- Все тексты интерфейса на русском.

## Том `/data`

```
/data/db.sqlite          база
/data/laya/base/         базовая модель laya-multilingual
/data/laya/versions/     дообученные версии (с отметкой версии библиотеки и базовой модели)
/data/backups/
```

Папки медиа и загрузок — отдельные тома, пути задаются в настройках.

## Решения (фаза 0)

- pnpm, Next.js 16 (App Router; в образе `next start` из prod-`node_modules`, без standalone), Tailwind v4 (токены в `@theme`), шрифты из пакетов `@fontsource` (без Google Fonts при сборке).
- Точка входа `src/entry/supervisor.ts`: миграции → дочерние процессы Next, воркер, laya-serve; перезапуск упавших, проброс SIGTERM.
- Секреты: AES-256-GCM, ключ из `DUBLYARR_SECRET_KEY` или сгенерированный `/data/secret.key` (0600). Логгер pino с redact.
- Вход: argon2 (`@node-rs/argon2`), TOTP — своя реализация на `node:crypto` (RFC 6238), сеансы — хэш токена в БД.
  Резервных кодов нет. Восстановление — CLI `dublyarr reset-password [--disable-2fa]`.
- Тесты: Vitest (unit), Playwright (e2e входа). Образ Docker только `linux/amd64`.
- TypeScript 6.0 (не 7: typescript-eslint пока не поддерживает TS 7), ESLint 9 (плагины eslint-config-next не поддерживают 10).
- Миграции данных из старого Dublyarr не будет — начинаем с нуля.
- Env: `DATA_DIR` (/data), `PORT` (3000), `LAYA_PORT` (8765), `DUBLYARR_SECRET_KEY`, `LOG_LEVEL`.
- Точка входа контейнера — `src/entry/main.ts` → `dist/supervisor.cjs`; воркер `src/worker/main.ts`, CLI `src/cli/main.ts` (esbuild, `esbuild.mjs`).
- Доменная логика — в `src/lib/*`, функции принимают `db` параметром (тесты на `:memory:` через `tests/unit/helpers.ts`).
- Server actions возвращают введённые значения (`src/lib/form-values.ts`): React 19 сбрасывает форму после action.

## Решения (фаза 1a — каталог)

- TMDB: `src/lib/tmdb/*` — клиент (`client.ts`, ключ v3 или токен v4, `ru-RU` + `en-US` для пустого описания, 429 → одна пауза ≤ 5 с),
  маппинг (`map.ts`), настройки и прокси (`index.ts`, `undici.ProxyAgent`). Ключ — `app_settings['tmdb']`, зашифрован.
- Каталог: `titles/seasons/episodes`, синхронизация — `src/lib/catalog.ts`. Аниме = жанр 16 + страна JP; ручной тип (`kind_manual`) обновление не трогает.
- Воркер: `scheduleDaily` + задача `tmdb.refresh-all` (выходящие — ежедневно, завершённые — раз в 30 дней). Карточка освежается при открытии, если старше 12 ч.
- Картинки только через `/api/image/{size}/{file}` с кэшем в `${DATA_DIR}/cache/images`; хелперы для клиента — `src/lib/image-url.ts` (без node-модулей).
- Фильмов в интерфейсе нет до фазы 3. Библиотека — в 1b.
- Тесты: фикстуры TMDB в `tests/fixtures/tmdb/`, заглушка `tests/e2e/tmdb-stub.mjs` (порт 3199); env `TMDB_BASE_URL`, `TMDB_IMAGE_BASE_URL`.
  e2e идут по порядку имён файлов (`01-…`, `02-…`) на одной базе; секрет TOTP 01 пишет в `$E2E_DIR/totp-secret`.

## Решения (фаза 1b — подписки и студии)

- Словарь студий: `src/lib/studios.ts` (нормализация написаний `normalizeStudio`, засев `STUDIO_SEED` один раз за жизнь базы в `getDb`,
  запрет удаления используемой студии). Имена и варианты уникальны во всём словаре.
- Профиль: чистая часть (типы, `validateProfile`, `describeProfile`) — `src/lib/profile-core.ts` (годится для клиента);
  профили по умолчанию — `src/lib/profile.ts`, `app_settings['profile.series' | 'profile.anime']`, иначе встроенные.
  Подписка хранит свою копию профиля (JSON). Всё, что приходит из формы, проверяется на сервере.
- `wantedEpisodes(subscription, episodes, today)` в `src/lib/subscriptions.ts` — точка входа для поиска (1c).
- Окно подписки = `ProfileEditor` + `SubscribeDialog` (то же для профилей по умолчанию); модалка/шторка — `ui/Modal`.
- e2e: вход с кодом — `tests/e2e/helpers.ts` (`loginWithCode`); сценарии идут на одной базе и учитывают изменения предыдущих.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
