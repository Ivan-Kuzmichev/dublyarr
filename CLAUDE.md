# Dublyarr

Self-hosted сервис для дома (администратор + пользователи с правами, общая библиотека): подписка на сериалы (и фильмы) в нужной
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
/data/laya/heads/        свои дообученные головы (важнее, чем в образе); heads.disabled — базовая модель
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
  на экраны — через `src/lib/dashboard.ts` (`speedBlock` в боковой колонке сериала, прогноз в «Ждём озвучку» и календаре).
  2.4.6 (решение владельца): серии, увиденные позже 90 дней после эфира (старый каталог), в задержку не входят; колонок студий в таблице серий нет;
  в окне подписки — средняя задержка студии по всем сериалам коротко («≈+3 д», `globalStudioDelays` + `approxDelay` → `subscribeDelays`), кнопка «Сбросить выбранное».
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
- Входящие — `src/lib/telegram-updates.ts` (`telegramLoop` — свой цикл в воркере вне очереди задач, long polling 25 с: кнопки — сразу; с 2.5 задачи `telegram.poll` нет, `dropRetiredJobs` убирает её из очереди): на любое сообщение бот отвечает Telegram ID чата (с 2.4.6 вместо привязки кодом — её путали) или к какой учётке он привязан, кнопки `m:/r:<releaseId>` → `answerMatch`.
  Вопрос «тот ли сериал» (`askText` в `notify-events.ts`) — всё для решения в самом сообщении: оригинал и годы, «Почему» (причины правил и Laya), трекер · размер · сиды · качество, разбор, озвучка.
  Только привязанный чат; удаление из Telegram не выполняется (только ссылки на страницы подтверждения).
- e2e: заглушка Telegram `tests/e2e/telegram-stub.mjs` (порт 3196; `POST /__push`, `GET /__sent`).

## Решения (фаза 3a — пересборка файлов)

- `src/lib/media/*`: разбор ffprobe (`probe.ts`), выбор дорожек (`tracks.ts`: `classifyAudio` по словарю студий целыми словами, `planTracks`, `findExternal`),
  аргументы mkvmerge (`mkvmerge.ts`), «та ли серия» по длительности (`checks.ts`), запуск программ (`runner.ts`, подменяется в тестах), обработка (`process.ts`).
- Пересборка — внутри импорта (`importEpisode`): только если есть что менять, иначе жёсткая ссылка; нужная озвучка не опознана — звук не трогается;
  любой контейнер, который читает mkvmerge (mp4, avi, ts, m2ts, webm, mov, flv), пересобирается в `.mkv`: номера дорожек — по `mkvmerge -J` по порядку внутри типа (`src/lib/media/track-ids.ts`),
  имя и язык дорожки передаются явно (из mp4/avi mkvmerge их не берёт), флаг «по умолчанию» неопознанного звука — как в источнике; не сопоставилось или не читается (wmv) — как есть;
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
- Опустевшие папки (2.6.2) — `src/lib/empty-dirs.ts` (`pruneUp`, `removeIfEmpty`): папка, где осталось только служебное Synology/macOS/Windows (`@eaDir`, `.DS_Store`, `._*`, `Thumbs.db`), убирается вместе с ним;
  так же — в папке загрузок (`cleanup.ts`, служебное — не «брошенные файлы») и в `.dublyarr-old` (сама скрытая папка остаётся).
- Удаление сериала — `src/lib/delete-series.ts` (решение владельца: и торренты с файлами в папке загрузок; общие с другими торрентами файлы остаются — `cleanup.dropTorrents`).
  Сезоны и серии (2.4.6) — тот же диалог, режим «Сезоны или серии» (`deleteEpisodes`, `parsePicks`, данные `StorageShow.parts`): только файлы медиатеки и старые копии, серии в `retired_episodes` (заново не качаются), подписка и торренты остаются; файл, который ещё раздаётся (жёсткая ссылка), — «освободится после окончания раздачи».

<!-- BEGIN:nextjs-agent-rules -->

## Решения (фаза 4 — Laya)

- laya-serve — `laya/serve.py` (venv `/opt/laya` в образе: `laya==0.3.22`, `torch==2.14.1+cpu`), модель `convaiinnovations/laya-multilingual` с закреплённой ревизией,
  скачивается при первом запуске в `/data/laya/base`; PyTorch CPU fp32 (ONNX INT8 нет в пакете, `quantize_dynamic` портит ответы) — ~1,9 ГБ памяти.
  `GET /health`, `POST /ask`; `LAYA_STUB=1` — без модели (e2e: финальная проверка «да», «тот ли сериал» — не уверена, студия — «новая»). Запуск — `src/entry/laya-child.ts`, замер — `dublyarr laya-bench`.
- Node: клиент `src/lib/laya/client.ts` (таймаут 10 с, три подряд — пауза 10 мин), решения `decide.ts`: ответ пользователя (пример) окончателен → ответ модели (кэш `laya_answers` по имени модели, с головами — `+heads-<дата>`) → порог;
  бюджеты 10 вопросов на поиск + 10 на финальную проверку, ручной поиск — 3; кончился бюджет — `budget` (финальная проверка ждёт следующего поиска),
  задачи `review.ts` (тот ли сериал, какая студия, нумерация аниме — внутри `searchTitle`), `final.ts` (до 3 лучших перед загрузкой), настройки `app_settings['laya']`.
- Laya недоступна / задача выключена — поведение как без Laya (решают правила). Её решения применяются при переразборе раздач из кэша.
- Примеры — `laya_examples` (`examples.ts`: «Это он»/«Не тот сериал», Telegram, «Назначить студию», «Верно/Нет» по вариантам от Laya, ручная загрузка отклонённой раздачи).
- Дообучения на NAS нет (2.5, решение владельца; адаптер и версии 2.0 убраны, таблица `laya_versions` не используется) — головы учатся на Mac, см. «Решения (2.5)».
- Экраны: «Настройки → AI» `/settings/ai`, «Примеры» `/settings/ai/examples` (`examples-view.ts`: по задачам, где Laya ошиблась, убрать пример), варианты от Laya — карточка в словаре студий.

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
- 2.1.1: уверенное «нет» Laya по сомнительной раздаче — не отказ, а вопрос пользователю («Laya думает, что не тот · N %»); «да» применяется как раньше.
  Названия: английское из TMDB `translations` и латиница стран происхождения — в `altNames`; «A (B, C)» в заголовке — три варианта.
  `RUS(int)` — «Русская озвучка» без студии; «свой трекер» не перекрывает студию, явно названную в заголовке.
- Ручной поиск `/search/[tmdbId]` открывается из кэша (`runManualSearch(..., { cached: true })` — раздачи и статусы источников последнего поиска, `titles.last_sources`);
  старше 15 мин — `title.search` фоном, `SearchRefresh` опрашивает и обновляет страницу; «Обновить» — поиск сейчас. Сохранение источника сбрасывает кэш у всех тайтлов.
- Laya — одна очередь: спрашивает только воркер (`decideMany`, в вебе — кэш и ответы пользователя, новый вопрос — `budget`); вопросы с одинаковым состоянием — одним запросом.
  Клиент ждёт до 30 с и передаёт `maxWaitMs` (20 с): laya-serve отвечает 503 «busy», если вопрос простоял в очереди дольше, — не зависание; ответ в закрытое соединение — одна строка в журнале.
- Смена версии раздачи (`switchTorrent`) — только если у нового торрента не меньше половины файлов старого (`sameRelease`): у AniLibria все паки тайтла на одной странице.
- Проверка паков: `.torrent` не скачался — этот пак не раньше чем через 6 ч (`app_settings['packs.retryAt']`). JacRed `aniliberty` = Jackett `anilibria` (`SAME_AS_JACKETT`).
- Окно подписки: раздачи ищутся фоном при открытии страницы сериала/фильма (`requestTitleSearch`, задача `title.search`, кэш 6 ч по `titles.releases_searched_at`, его ставит `searchTitle`);
  `foundAction` + `useFound` (опрос раз в 3 с, пока идёт поиск) → найденные студии (`foundStudios`) первыми в жёлтой рамке с числом раздач, у фильма — «нашлось раздач: N» по типу перевода.

## Решения (2.3 — пользователи)

- `users.role` (`admin`|`user`), `permissions` (JSON: `subscribe`, `search`, `answer`, `downloads`, `storage`), `disabled`, `telegram_chat_id`, `notify_events`, `last_login_at`;
  `subscriptions.added_by`. Права — чистый `src/lib/auth/permissions.ts` (`can`, `isAdmin`, годится для клиента).
- Проверка на сервере: actions — `guard(perm | 'admin')` → сеанс или null (ответ «Недостаточно прав»); страницы — `requireAdmin()` / `requirePage(...)` → 404.
  Тест `tests/unit/guards.test.ts` — каждое защищённое действие без права. Разделы настроек — `settingsSectionsFor(admin)`; «Требует внимания» — `attentionFor`.
- «Настройки → Пользователи» — `src/lib/users-admin.ts` (последний админ, себя — нельзя; выключение/сброс пароля завершают сеансы).
- Уведомления: бот (токен) — у админа; у каждой учётки свой чат (Telegram ID в «Моём чате», бот присылает его на /start; один чат — одна учётка) и события; доставка — `notification_deliveries`
  по получателям (`recipients`: чат, включена, событие; `ask` — с правом `answer`); кнопки Telegram — по праву `answer`. Перенос общего чата первому админу — `migrateTelegramChat`.
- API (`/api/v1`) и токены — только админ.
- Диагностика уведомлений — `GET /api/v1/notifications?limit=` (`notificationsDebug`: получатели с чатом и событиями, последние события с доставками и ошибками).

## Решения (2.4 — заставки и титры)

- Разметка — `src/lib/intros/*`: отпечатки Chromaprint (ffmpeg `-f chromaprint`, окна 10 мин начала / 4 мин конца, кэш `${DATA_DIR}/cache/fp/<id>-<importedAt>-<head|tail>.bin`),
  общий кусок 15–120 с (`commonSegment`: кандидаты сдвига — перебор по каждому 4-му кадру с допуском ≤ 8 бит; к границам +`LAG` 1 с — замер в образе), согласие ≥ 2 соседей (`agree`), главы `Начало · Intro · Серия · Credits · После титров` через `mkvpropedit` (`IntroTools`, подменяется в тестах).
- Задача `intros.tick` раз в 10 мин — один сезон (`nextSeason`: не проверенные, `waiting` — раз в час); фильмы, не-mkv и файлы со своими главами не трогаются.
  Жёсткая ссылка на раздачу — копия в медиатеке (диск < `overflow.warn`), иначе `waiting`. Импорт обнуляет разметку файла и сбрасывает `none` в сезоне.
- `episode_files.intro_*`; настройки — `app_settings['intros']` («Настройки → Файлы»); в интерфейсе — только «размечено».
- Настоящая разметка проверяется в образе: `docker run --rm --entrypoint sh dublyarr:dev scripts/intro-smoke.sh` → «intro smoke: OK».
- В образе `LANG/LC_ALL=C.UTF-8`: в локали POSIX MKVToolNix обрезает пути на кириллице (2.4.0 — «файл '/downloads/media/' не найден»); проверка в образе идёт по русскому пути.
- 2.4.3: опенинг склеивается через голос поверх музыки (куски ≥ 3 с при том же сдвиге, разрыв ≤ 12 с), к началу `LAG_START` 0,5 с, к концу `LAG` 1 с (главы AniDUB, проверка владельца на «Клевере», синтетика — все в ±1,5 с).
  Вступление с первой секунды (`preludeRun`: куски общей музыки ≥ 1 с через голос ≤ 6 с, первый — в первые 3 с, сдвиг ±1 с; только > 5 с — решение владельца) —
  вторая глава Intro (`episode_files.prelude_*`); вплотную к опенингу (разрыв ≤ 12 с) — одна глава (`combineIntros`). Свои главы узнаются по главе «Серия» (`BODY_CHAPTER`).
- Перерасчёт по запросу: `POST /api/v1/titles/:kind/:tmdbId/intros` `{ season? }` (`requeueIntros`: всё, кроме глав релиза, — снова в очередь; задача `intros.tick` с `{ titleId, season }`).


## Решения (2.5 — Laya: контекст вопросов, обучение на Mac)

- Вопросы Laya с контекстом (`src/lib/laya/context.ts`, `richState`/`titleContext` в `review.ts`): сериал с типом и годами, сезоны по TMDB (серий в каждом), раздача, что разобрал парсер, размер, трекер.
  Замер на ручной разметке (3 разбиения по сериалам): неверные уверенные «да» в «тот ли сериал» 10 % → 4 %, log-loss 1,33 → 0,86. Формат вопроса — `QUESTION_VERSION` (`laya_answers.version`): ответы на прежний формат не годятся, спрашиваем заново.
- Обучения на NAS нет (решение владельца): ответы копятся в `laya_examples` (экран «Примеры»), набор — `GET /api/v1/laya/dataset` (`dataset.ts`; старые ответы «тот ли сериал» — в нынешнем виде вопроса по ключу раздачи).
- Головы учатся на Mac (MPS), `laya-train/` (venv `.venv`, не в образе): `encode.py` — кодирование как в бою, `train.py` — только `scorer`/`type_emb`, разбиение по сериалам 70/10/20, `--balance`, `--distill` (держать ответы базовой модели на выборе), `--eval-only`.
  Приёмка — по рабочей метрике: «решает сама» у «да/нет» — только уверенное «да» (уверенное «нет» и так уходит вопросом или к следующей раздаче); log-loss и «цена» (вопросы + 6,7 × уверенные ошибки) не хуже базовой, цена < 0,95.
  Ручная разметка — `laya-train/labels/g*.json` (+ `tmdb.json` — сезоны и годы), `pnpm laya:labels` (`scripts/laya-labels.ts`). На ней (1488 строк) головы не прошли: учатся не говорить «да» уверенно — в 2.5 голов нет, нужны ответы с NAS.
- Головы — `laya/heads/` (`heads.safetensors` fp16, `meta.json`, `calibration.json`, `report.md`); `laya/heads_util.py`: свои `${DATA_DIR}/laya/heads` важнее образа, другая модель/версия — не грузятся.
  laya-serve: `model` с суффиксом `+heads-<дата>` (кэш ответов по имени модели), `POST /reload` — без перезагрузки энкодера. «Дообученная Laya» в «Настройки → AI» — `src/lib/laya/heads.ts` (`heads.disabled`, `headsAvailable`), `setHeadsAction`.
- Jackett RuTracker с «Strip Russian letters» срезает русские названия — сериалы только с русским названием в заголовке не находятся.

## Решения (2.6 — надстройка над Laya)

- Дообучение — не головы (на наших объёмах «схлопываются», issue #963 у авторов Laya), а надстройка: логистическая регрессия поверх logit(p «да») базовой Laya и эмбеддинга вопроса тем же энкодером
  (`laya.shortlist.embed_fn_from_agent`, 768). Общий код — `laya/probe_util.py` (`text_of`, `features`, `apply`, `load_probes`: модель/ревизия/версия laya/формат/размер), веса — `laya/probe/<задача>.json` (свои — `${DATA_DIR}/laya/probe`).
- Обучение на Mac: `laya-train/probe.py --data … [--save ../laya/probe/match.json]` (веса классов поровну, L2 по калибровочной части; группы — по названию сериала, иначе ручная разметка и выгрузка с NAS пересекаются).
  Данные — ручная разметка + `GET /api/v1/laya/dataset`. Замер на непросмотренных сериалах, ваши ответы «тот ли сериал»: точность 76 → 88 %, уверенное «да» верно 7 → 20 %, ошибок 1 → 0 %.
- laya-serve: `POST /ask` с `probe: {id: "match"}` — к ответу «да/нет» применяется надстройка (`noul` — пересчитанная, `base` — Laya); `model` — с суффиксом `+probe-<дата>` (кэш ответов сбрасывается при смене весов);
  `heads.disabled` выключает и её. Node: `decideMany` ставит пометку задачам из `PROBE_TASKS` (пока `match`).
- 2.6.1: на DS920+ (Celeron J4125, без AVX) laya-serve падал с SIGILL на части вопросов (с 2.5 — чаще: длиннее вопрос, в 2.6 — ещё проход энкодера).
  Без AVX в `/proc/cpuinfo` — `MKL_ENABLE_INSTRUCTIONS=SSE4_2`, `DNNL_MAX_CPU_ISA=SSE41`, `ATEN_CPU_CAPABILITY=default` (`laya-child.ts`); `faulthandler` в laya-serve — стек падения в журнал;
  отказ laya-serve (не 503) — `laya ask rejected` в журнале; сбой надстройки — ответ Laya без неё. Rosetta в Docker на Mac выполняет AVX, не объявляя его: воспроизвести там нельзя. Вопрос с надстройкой — примерно вдвое дольше (ещё один проход энкодера).

## Решения (2.7 — сканирование медиатеки)

- «Хранилище» → блок «Медиатека» (`MediaScanCard`, окно `MediaScanDialog`): по кнопке найти видео, которых нет в `episode_files`, и взять их в Dublyarr. Только по кнопке (решение владельца).
- `src/lib/media-scan/*`:
  - `group.ts` — позиции (папка верхнего уровня или файл в корне), сезон и серия по имени или `Season NN`, сопутствующие `.srt/.ass/.mka`; имена в стиле сцены режутся с первого технического слова;
  - `recognize.ts` — TMDB (0,75 название + 0,25 год, уверенно от 0,8);
  - `scan.ts` — `runMediaScan`, `runAdopt`; `adopt.ts` — `adoptItem`;
  - `state.ts` — `app_settings['mediaScan']`, `buildChoices`: пути — только из сохранённого сканирования. Задачи воркера — `media.scan`, `media.adopt`.
- Перенос (решения владельца):
  - раздаётся в qBittorrent (или клиент недоступен) — жёсткая ссылка, иначе — перемещение;
  - «Пересобрать как при импорте» — галочка, по умолчанию выключена; после проверенной (ffprobe, ±2 %) пересборки оригинал удаляется, если не раздаётся;
  - по целевому пути что-то лежит — «Уже есть», без перезаписи; `episode_files.method` += `move`.
- «Только файлы» — `subscriptions.files_only` (`wantedEpisodes` пуст, `extendSeasons` не трогает), в «Библиотеке» — пометка, на странице сериала — «Включить подписку». По умолчанию в окне — «Только файлы».
- По ревью:
  - назначение — корень по типу (`mediaRoot`: фильмы — `paths.movies`, иначе отказ «Не задана папка фильмов»);
  - вложенные корни фильмов и загрузок не сканируются, известные файлы — по своему корню;
  - `episode_files.adopted` — взятый файл не «улучшается» и не заменяется; у «только файлов» по умолчанию `keepAll`;
  - серия уже есть в Dublyarr — пропуск; файл уже по шаблону — только запись; без пересборки — ffprobe и проверка «та ли серия»;
  - папка с несколькими сериалами — позиция на подпапку; сквозные номера — сезон 1, при добавлении — `absoluteToSeason` по TMDB.
- API: `GET/POST media/scan`, `POST media/adopt { picks }`. e2e — `15-media-scan`.

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
