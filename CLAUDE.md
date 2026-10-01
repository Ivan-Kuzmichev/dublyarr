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

## Решения (фаза 1c — поиск и разбор)

- Ожидание позиции профиля — «через N дней после эфира», ожидания не убывают сверху вниз (решение владельца).
- Torznab: `src/lib/torznab.ts` (`fast-xml-parser`), поиск по сериалу — `src/lib/search.ts` (`searchTitle`: все источники параллельно,
  склейка по infohash или трекер+заголовок+размер, результаты запасного источника трекера отбрасываются, если основной ответил).
  Трекеры и роли — `src/lib/trackers.ts`. Ссылка на .torrent хранится зашифрованной (`releases.download_enc`).
- Разбор заголовка — чистые модули `src/lib/parse/*` (`parseRelease`); в раздаче — **список** озвучек; студии ищутся только целыми токенами.
  Корпус реальных заголовков — `tests/fixtures/releases/hub-corpus.tsv` (тесты `parse-corpus`).
- «Тот ли сериал» — `src/lib/match.ts` (0,6 название · 0,15 год · 0,15 сезоны · 0,1 размер; ≥ 0,8 — подходит, 0,5–0,8 — сомнительно), правила пользователя — `release-rules.ts`.
- Вердикты и лучшая раздача — `src/lib/evaluate.ts` (`evaluateReleases`), место под Laya — `finalCheck`. 1d берёт их же.
- Ручной поиск — `/search/[tmdbId]?s=&e=` (`src/lib/manual-search.ts`); каждое открытие опрашивает источники.
- e2e: заглушка Jackett `tests/e2e/jackett-stub.mjs` (порт 3198).

## Решения (фаза 1d — загрузки)

- qBittorrent WebAPI v2: `src/lib/qbit.ts` (`createQbit`/`getQbit`; v4 и v5 — `start/stop` с webapi 2.11, иначе `resume/pause`; при 403 — один повторный вход).
  Раздачи — категория `dublyarr`, папка `{qbitDownloads}/dublyarr`; удаление из клиента — всегда `deleteFiles=false`.
  `.torrent` качает Dublyarr (`fetchTorrentFile`), хэш считает сам (`src/lib/torrent-file.ts`).
- Пути — настройка `paths` `{ qbitDownloads, downloads, media, template }`: путь qBittorrent переводится заменой префикса (`toLocalPath`).
  Импорт — жёсткая ссылка, при `EXDEV/EPERM/ENOTSUP/EMLINK` — копия (`src/lib/importer.ts`); шаблон имени — `src/lib/library-path.ts`.
- Таблицы: `downloads` (одна строка — один торрент; `episodes` — какие серии из него нужны, `files` — снимок списка файлов),
  `episode_files` (что лежит в медиатеке), `wanted_state` (почему нужная серия ещё не качается — ждём до даты / нет раздач / нужен ответ).
- Что качать — `planEpisode` (`src/lib/plan.ts`): файл в уже качающемся паке → отдельная серия → пак с выбором файлов; серии одного пака — одна загрузка.
  «Сезон целиком после финала» — пак, покрывающий весь сезон, когда вышла последняя серия.
- Воркер: `subscriptions.search` раз в час (`src/lib/autosearch.ts`), `downloads.sync` раз в минуту (`syncDownloads`: состояния, stalled > суток без сидов, импорт).
  Раздача с ошибкой загрузки при следующем поиске не берётся.
- Экраны: «Сегодня», «Календарь», статусы серий — `src/lib/dashboard.ts`; очередь «Активности» — `src/lib/activity.ts`.
- e2e: заглушка qBittorrent `tests/e2e/qbit-stub.mjs` (порт 3197; `QBIT_DIR`, `QBIT_STEP`); общий bencode заглушек — `tests/e2e/bencode.mjs`.

## Решения (фаза 2a — надёжность загрузок)

- Топик раздачи — `releases.details_url`. Новая версия топика (другой хэш) — `switchTorrent` в `src/lib/downloads.ts`: новый торрент в ту же папку,
  включены только нужные серии, старый убран из клиента без файлов, старая запись `replaced` + `note` («Обновлена: +серия 6»). `startRelease` сам выбирает этот путь для того же топика.
- Проверка паков — `src/lib/pack-watch.ts`, задача `packs.check` раз в 30 мин: .torrent по сохранённой ссылке, только когда в сезоне есть нужные и нигде не качающиеся серии.
- Застрявшая (`stalled`) не считается «качается»: поиск ищет замену, после старта замены — `releaseStalled` («Заменена: нет сидов»); замены нет — остаётся.
- `getQbit` кэширует клиент (одна сессия на настройки). Импорт не затирает чужой файл в медиатеке (`importFile` с `replace` — только свой прошлый импорт серии).
- Кнопки «Активности» — `controlDownload` (`src/lib/activity.ts`): только из подходящих состояний, ошибка — `/activity?error=…`.
- e2e: заглушки получили переключатели `POST /__air?ep=&date=` (TMDB) и `POST /__update` (Jackett — новая версия топика).

## Решения (фаза 2b — озвучки и прогноз)

- Наблюдения «студия выпустила серию» — `studio_sightings` (`src/lib/sightings.ts`, пишутся после каждого `searchTitle`, старые раздачи — один раз при старте воркера).
- Задержка студии — медиана по лучшему классу (отдельные «видели сами» → «по датам раздач» → паки), прогноз и строка запасного варианта — чистый `src/lib/forecast.ts`;
  на экраны — через `src/lib/dashboard.ts` (`seriesDubColumns`, `speedBlock`, `delayBasis`, прогноз в «Ждём озвучку» и календаре).
- Замена на лучшую версию — `src/lib/upgrade.ts` + `autosearch.ts`: 30 дней после эфира, позиция профиля выше или та же позиция и качество до целевого.
  Позиция профиля хранится в `downloads.dub_position` → `episode_files.dub_position` (null — не улучшаем). Подпись «Улучшение: …» — `downloads.note`.
- Старая копия (spec §8, решение владельца: удалять сразу, первый раз — с подтверждением) — `src/lib/old-copies.ts`: до подтверждения — в `{media}/.dublyarr-old`
  и в `old_copies`, страница `/old-copies`; флаг правила `app_settings['retention.oldCopy.confirmed']`. Удаляются только файлы внутри скрытой папки.
- Новые сезоны — `subscriptions.max_season` (граница подписки), `extendSeasons` в конце `syncTitle`; заметки — таблица `notices`, «Новости» на «Сегодня» (3 дня).
- e2e: `POST /__add2160` в заглушке Jackett — пак LostFilm 2160p.

## Решения (фаза 2c — расписание и уборка)

- Расписание — `src/lib/schedule.ts` (чистые `searchDue`, `speedAt`, `speedSummary`, разбор форм); настройки `app_settings['schedule' | 'speed' | 'cleanup']`.
  Воркер: `subscriptions.tick` раз в 5 мин ищет только подписки, которым пора (`subscriptions.last_searched_at`); «чаще в день прогноза» — `eagerTitles` (forecast.ts).
- Скорость — только торренты Dublyarr (решение владельца), `src/lib/speed.ts` в `downloads.sync`: лимит делится поровну между качающимися (у qBittorrent нет лимита на категорию),
  пауза отмечает свои загрузки (`downloads.paused_by_schedule`) и будит только их.
- Уборка — `src/lib/cleanup.ts`, задача `cleanup.run` раз в час: файлы удаляет Dublyarr (торрент из клиента — без файлов), только внутри `{downloads}/dublyarr`,
  кроме файлов живых торрентов. Первое срабатывание — страница `/cleanup` (флаги `cleanup.files.confirmed`, `cleanup.orphans.confirmed`), сводка для «Требует внимания» — `app_settings['cleanup.pending']`.
- `downloads.files` хранит имена файлов как qBittorrent (с корневой папкой многофайловой раздачи).

## Решения (фаза 2d — Telegram)

- Клиент Bot API — `src/lib/telegram.ts` (токен в адресе — маскируется `maskToken`; прокси — свой или прокси TMDB; env `TELEGRAM_API_BASE` для заглушки).
- Очередь `notifications` (`src/lib/notify.ts`): событие пишется сразу (ключ от повторов), воркер `telegram.send` раз в 15 с; повторы 2, 4, 8… мин, сутки — «не доставлено».
- События и тексты — `src/lib/notify-events.ts`, вызовы — в местах событий (импорт, застряла/пропала, `setWanted`, источники, заметки, сводки подтверждений).
- Входящие — `src/lib/telegram-updates.ts` (`telegram.poll` раз в 15 с, long polling без вебхука): привязка чата одноразовым кодом, кнопки `m:/r:<releaseId>` → `answerMatch`.
  Только привязанный чат; удаление из Telegram не выполняется (только ссылки на страницы подтверждения).
- e2e: заглушка Telegram `tests/e2e/telegram-stub.mjs` (порт 3196; `POST /__push`, `GET /__sent`).

## Решения (фаза 3a — пересборка файлов)

- `src/lib/media/*`: разбор ffprobe (`probe.ts`), выбор дорожек (`tracks.ts`: `classifyAudio` по словарю студий целыми словами, `planTracks`, `findExternal`),
  аргументы mkvmerge (`mkvmerge.ts`), «та ли серия» по длительности (`checks.ts`), запуск программ (`runner.ts`, подменяется в тестах), обработка (`process.ts`).
- Пересборка — внутри импорта (`importEpisode`): только если есть что менять, иначе жёсткая ссылка; нужная озвучка не опознана — звук не трогается;
  результат — полная копия `.mkv` в медиатеке, источник в загрузках не меняется. Нет ffprobe/mkvmerge — импорт как раньше.
- Не та серия (длительность вне 0,5–2× от runtime TMDB) — не импортируется, загрузка `error` для этих серий, торрент убран из клиента, поиск заново.
- В имени файла и `episode_files.resolution` — реальное разрешение по ffprobe; `episode_files.processed/hdr/duration/tracks`.
- Настоящая пересборка проверяется в образе: `docker run --rm --entrypoint sh dublyarr:dev scripts/remux-smoke.sh` → «remux smoke: OK».

## Решения (фаза 3b — хранение)

- Правила — `src/lib/retention.ts` (`seasonRule`, `retentionPlan`, `runRetention`, `deleteMediaFile`), настройки и расписание — `src/lib/retention-settings.ts`
  (`app_settings['retention']`; сезоны по умолчанию выключены — решение владельца; уборка в 04:00 каждый день / по воскресеньям / вручную, задача `retention.tick`).
- Первое срабатывание каждого правила — список с галочками на «Хранилище» (флаги `retention.<правило>.confirmed`, «не удалять» — `retention.declined`); удаляются только файлы из `episode_files`/`old_copies` внутри медиатеки; история — таблица `deletions`.
- Исключения сериала — `subscriptions.keep_all`, `subscriptions.auto_delete` (`setSeriesExceptions`); правила сохраняются через `saveRetentionSettings`: стали жёстче — подтверждение правила сбрасывается.
- Удалённые серии — `retired_episodes`: автопоиск их не качает до новой подписки. Старые копии: `old_copies.due` — отложены подтверждённым правилом до уборки; без него уборка копию не трогает.
- Диск и переполнение — `src/lib/storage.ts` (`diskUsage` через `fs.statfs`, `checkDisk` в синхронизации, пауза через `applySpeed`); данные экрана — `storageData`.
- Удаление сериала — `src/lib/delete-series.ts` (решение владельца: и торренты с файлами в папке загрузок; общие с другими торрентами файлы остаются — `cleanup.dropTorrents`).

<!-- BEGIN:nextjs-agent-rules -->

## Решения (фаза 4 — Laya)

- laya-serve — `laya/serve.py` (venv `/opt/laya` в образе: `laya==0.3.22`, `torch==2.14.1+cpu`), модель `convaiinnovations/laya-multilingual` с закреплённой ревизией,
  скачивается при первом запуске в `/data/laya/base`; PyTorch CPU fp32 (ONNX INT8 нет в пакете, `quantize_dynamic` портит ответы) — ~1,9 ГБ памяти.
  `GET /health`, `POST /ask`; `LAYA_STUB=1` — без модели (e2e: финальная проверка «да», «тот ли сериал» — не уверена, студия — «новая»). Запуск — `src/entry/laya-child.ts`, замер — `dublyarr laya-bench`.
- Node: клиент `src/lib/laya/client.ts` (таймаут 10 с, три подряд — пауза 10 мин), решения `decide.ts`: ответ пользователя (пример) окончателен → ответ модели (кэш `laya_answers` по ревизии модели, адаптер — при чтении) → порог;
  бюджеты 10 вопросов на поиск + 10 на финальную проверку, ручной поиск — 3; кончился бюджет — `budget` (финальная проверка ждёт следующего поиска),
  задачи `review.ts` (тот ли сериал, какая студия, нумерация аниме — внутри `searchTitle`), `final.ts` (до 3 лучших перед загрузкой), настройки `app_settings['laya']`.
- Laya недоступна / задача выключена — поведение как без Laya (решают правила). Её решения применяются при переразборе раздач из кэша.
- Примеры — `laya_examples` (`examples.ts`: «Это он»/«Не тот сериал», Telegram, «Назначить студию», «Верно/Нет» по вариантам от Laya, ручная загрузка отклонённой раздачи).
- Дообучение — адаптер (логистическая регрессия поверх logit(p Laya) и признаков правил), `adapter.ts` + `versions.ts`: ночью при 30+ новых примерах (`laya.train`),
  «Обучить сейчас» (`laya.train-now`), «не хуже» по log-loss на отложенных 20 % (id % 5), 3 версии + базовая, откат; несовместимая версия `laya`/модели — базовая и переобучение.
- Экраны: «Настройки → AI» `/settings/ai`, «Дообучение» `/settings/ai/training`, варианты от Laya — карточка в словаре студий.

## Решения (2.1 — API, диагностика, источники)

- Логи: `logger(area)` (`src/lib/log.ts`, постоянная ручка — можно держать в константе модуля), области `LOG_AREAS`, уровни — `app_settings['logging']`
  (`src/lib/log-settings.ts`, процессы перечитывают раз в 10 с через `getDb`); `LOG_LEVEL` — только начальное значение.
  Дети пишут JSON в stdout, супервизор — в `/data/logs/dublyarr.log` (10 МБ × 5, `src/entry/log-sink.ts`); чтение — `src/lib/log-read.ts`.
  Экран — «Настройки → Диагностика» (`/settings/diagnostics`: уровни, журнал, сверка с qBittorrent `src/lib/reconcile.ts`, задачи `src/lib/diagnostics.ts`).
- API: `/api/v1/*` (`src/app/api/v1/[...path]/route.ts` → `src/lib/api/router.ts`, `read.ts`, `write.ts`, `settings-sections.ts`), токены `api_tokens` (только хэш), выключен по умолчанию.
  Только локальная сеть: все адреса `X-Forwarded-For`/`X-Real-IP`/`Forwarded` частные (`src/lib/api/lan.ts`; Next ставит XFF = сокет, Pangolin — внешний адрес → 403).
  Проверка доверяет заголовкам прокси (адрес сокета Next не отдаёт): Dublyarr открывать наружу только через прокси, который ставит `X-Forwarded-For` (Pangolin/Traefik), без проброса порта напрямую.
  «Безопасность», ключ TMDB и бот Telegram через API не меняются. Обработчики зовут те же функции, что actions (`downloadRelease` — `src/lib/manual-download.ts`; JSON → `toFormData` → парсеры форм).
- Источники: `sources.kind` = `jackett` (адрес без пути, `endpointFor`; адрес одного трекера сохраняется) | `jacred` (JSON `/api/v1.0/torrents`, `src/lib/jacred.ts`,
  по одному запросу с паузой 1 с, 429 → пауза по Retry-After ≤ 10 с) | `torznab` (полный адрес). Сохранение и проверка — `saveSource` (`src/lib/source-save.ts`).
- Загрузки: после `add` — ждать появления торрента (`waitForTorrent`, до 15 с), после старта — перепроверка файлов и запуска; синхронизация перезапускает остановленные
  не пользователем (`downloads.paused_by_user`) и не расписанием, больше 3 раз за час — ошибка; пак с выключенными файлами — перевыбор. Пауза прямо в qBittorrent будет снята.
- «Сегодня → Новые серии»: кадр серии (`episodes.still_path`) → фон → постер.
- e2e: `13-api-diagnostics` (API, токен, журнал, «Диагностика»).

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
