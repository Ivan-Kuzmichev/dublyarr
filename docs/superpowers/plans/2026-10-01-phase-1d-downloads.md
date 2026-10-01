# Фаза 1d «Загрузки»: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** сам находить и качать нужные серии подписок через qBittorrent, импортировать их в медиатеку по шаблону имени; экраны «Сегодня», «Календарь», «Активность», статусы серий.

**Architecture:** чистые модули — `src/lib/torrent-file.ts` (bencode), `src/lib/library-path.ts` (пути и шаблон), `src/lib/episode-file.ts` (номер серии из имени файла),
`src/lib/plan.ts` (что качать); ввод-вывод — `src/lib/qbit.ts` (клиент WebAPI), `src/lib/importer.ts` (ссылка/копия), `src/lib/downloads.ts` (выполнение плана, синхронизация);
воркер — задачи `subscriptions.search` и `downloads.sync`; данные экранов — `src/lib/dashboard.ts`.

**Tech Stack:** как раньше; без новых зависимостей (multipart — `FormData` + `Blob` из Node 24).

**Spec:** `docs/superpowers/specs/2026-10-01-phase-1d-downloads-design.md`; `docs/spec.md` §4–6; макеты `Main.dc.html`, `Mobile.dc.html`, `Calendar.dc.html`, `MobileCalendar.dc.html`,
`Activity.dc.html`, `MobileActivity.dc.html`, `Series.dc.html`, `Settings.dc.html` (раздел «Загрузка»).

## Global Constraints

- Как в 1a–1c: русский интерфейс, токены, ≥ 44 px, `requireSession()` и проверка id в actions, секреты (пароль qBittorrent, ссылки .torrent) — только зашифрованными, в логи — `redactUrl`.
- Удаление файлов — **никогда** в 1d: из клиента убираем только торрент (`deleteFiles=false`), в медиатеке только создаём/заменяем свой файл.
- Чужие торренты (не категории `dublyarr`) не трогаются.
- Laya нет — `finalCheck` из 1c.

## Review Focus

1. **Путь от qBittorrent вне папки загрузок или с другим префиксом** (`/downloads2/...`, Windows-путь, путь с `..`) — понятная ошибка загрузки, никакой записи вне медиатеки. Тест в Task 3.
2. **Имя сериала с запрещёнными символами** («Что/Где/Когда: 2024?») — корректный путь в медиатеке без лишних каталогов. Тест в Task 3.
3. **Пак, где номера серий только в виде «03.mkv» / «[AniLibria] Frieren - 03 [1080p].mkv» рядом с «1080p» и годом** — номер находится, разрешение и год не путаются с номером. Тест в Task 5.
4. **qBittorrent перезапустился (сессия протухла, 403)** — один повторный вход, запрос проходит. Тест в Task 2.
5. **Одна серия — две загрузки** (поиск по подписке сразу после ручного «Скачать») — вторая не создаётся. Тест в Task 7.

---

### Task 1: Разбор .torrent

**Files:** Create `src/lib/torrent-file.ts`, `tests/fixtures/torrents/{single.torrent,multi.torrent}` (генерируются в тесте `bencode`-кодером);
Test `tests/unit/torrent-file.test.ts`

**Interfaces — Produces:**
```ts
export function bdecode(buf: Buffer): unknown;                        // строки — Buffer, числа — number, списки, словари (Map порядок ключей)
export function bencode(v: unknown): Buffer;                          // для тестов и пересборки
export type TorrentMeta = { infohash: string; name: string; files: { index: number; path: string; size: number }[] };
export function parseTorrent(buf: Buffer): TorrentMeta;               // infohash = sha1 «сырых» байт словаря info (без перекодирования), hex lower
export function magnetHash(magnet: string): string | null;            // btih hex (40) или base32 (32) → hex lower
export class TorrentFileError extends Error {}
```
- [ ] **Step 1: Failing tests:** однофайловый (`info.length`) и многофайловый (`info.files[].path[]`) торрент, собранные `bencode` в тесте; `infohash` сверяется с `sha1(bencode(info))`;
  infohash реального торрента не зависит от порядка ключей вне `info`; мусор → `TorrentFileError('Это не торрент-файл')`; magnet hex и base32 (`magnet:?xt=urn:btih:MFRGG…` → hex).
- [ ] **Step 2–4:** RED → реализация (рекурсивный разбор с позицией; для `info` запоминается диапазон байт) → GREEN. **Step 5: Commit** `feat(downloads): разбор торрент-файлов`.

---

### Task 2: Клиент qBittorrent

**Files:** Create `src/lib/qbit.ts`; Modify `src/lib/integrations/qbittorrent.ts` (`checkQbittorrent` → поверх клиента); Test `tests/unit/qbit.test.ts`

**Interfaces — Produces:**
```ts
export type QbitTorrent = { hash: string; name: string; state: string; progress: number; dlspeed: number; eta: number; size: number; num_seeds: number; save_path: string; content_path: string; category: string };
export type QbitFile = { index: number; name: string; size: number; progress: number; priority: number };
export class QbitError extends Error { constructor(message: string, readonly code: 'auth' | 'network' | 'http' | 'banned') }
export type Qbit = {
  version(): Promise<string>;
  add(torrent: Buffer | { magnet: string }, opts: { savePath: string; category: string; paused: boolean }): Promise<void>;
  list(category: string): Promise<QbitTorrent[]>;
  files(hash: string): Promise<QbitFile[]>;
  setFilePriority(hash: string, indexes: number[], priority: 0 | 1 | 6 | 7): Promise<void>;
  start(hashes: string[]): Promise<void>;
  stop(hashes: string[]): Promise<void>;
  remove(hashes: string[]): Promise<void>;          // deleteFiles=false — всегда
  ensureCategory(name: string, savePath: string): Promise<void>;
};
export function createQbit(cfg: QbitConfig, opts?: { fetchImpl?: typeof fetch }): Qbit;
export function getQbit(db: Db): Qbit | null;      // из tryGetSecretSetting('qbittorrent')
```
Поведение: ленивый вход; `SID` в памяти клиента; ответ 403 на любом запросе → вход заново и **один** повтор; `webapiVersion` ≥ 2.11 → `start/stop`, иначе `resume/pause`
(версия запрашивается один раз). `add` — multipart `FormData` с `Blob` торрента (`torrents`, имя `x.torrent`) или `urls` для magnet; `paused` и `stopped` — одинаково.
`ensureCategory` — `createCategory`, 409 («уже есть») — не ошибка.

- [ ] **Step 1: Failing tests** (фиктивный `fetch` с журналом запросов): вход и cookie; 403 → повторный вход → успех; второй 403 подряд → `QbitError('auth')`;
  v5 (`2.11.4`) → `/torrents/start`, v4 (`2.8.3`) → `/torrents/resume`; `add` — multipart с полями `category`, `savepath`, `paused=true`, `stopped=true` и файлом;
  `setFilePriority('h', [0,2], 0)` → тело `hash=h&id=0%7C2&priority=0`; `remove` всегда `deleteFiles=false`; `files` маппит `index`; сеть → `network`.
- [ ] **Step 2–4:** RED → реализация → GREEN; `checkQbittorrent` и его тесты остаются зелёными.
- [ ] **Step 5: Commit** `feat(downloads): клиент qBittorrent`.

---

### Task 3: Пути, шаблон имени, импорт

**Files:** Create `src/lib/library-path.ts`, `src/lib/importer.ts`; Modify `src/lib/settings.ts`-типы путей (`Paths = { downloads, media, qbitDownloads?, template? }`); Test `tests/unit/library-path.test.ts`, `tests/unit/importer.test.ts`

**Interfaces — Produces:**
```ts
export const DEFAULT_TEMPLATE = '{Название} ({Год})/Season {С}/{Название} S{С}E{Е} [{Студия} {Качество}]';
export type TemplateVars = { name: string; original: string; year: number | null; season: number; episode: number; studio: string; quality: string };
export function renderTemplate(template: string, v: TemplateVars, ext: string): string;    // относительный путь с расширением; части ≤ 120 символов
export function toLocalPath(qbitPath: string, qbitRoot: string, localRoot: string): string; // бросает PathError
export class PathError extends Error {}
export async function importFile(src: string, mediaRoot: string, relPath: string): Promise<{ path: string; method: 'hardlink' | 'copy' }>;
export async function checkHardlink(downloads: string, media: string): Promise<{ ok: boolean; message: string }>;
```
Правила: `toLocalPath` — нормализация `/` (бэкслеши → `/`), префикс по границе каталога (`/downloads` ≠ `/downloads2`), без `..` после нормализации → иначе `PathError('Путь qBittorrent вне папки загрузок: …')`.
`renderTemplate`: недопустимые `/\:*?"<>|` в значениях → `-` (в шаблоне `/` — разделитель каталогов), пустые `[]`/`()` и двойные пробелы убираются, точки/пробелы на концах частей обрезаются;
итоговый путь не может начинаться с `/` и содержать `..`. `importFile`: каталоги создаются; ссылка во временное имя → `rename` поверх; `EXDEV/EPERM/ENOTSUP/EMLINK` → копия во временное имя → `rename`.

- [ ] **Step 1: Failing tests:** шаблон по умолчанию → `Игра престолов (2011)/Season 01/Игра престолов S01E03 [LostFilm 1080p].mkv`; без качества → `[LostFilm]`; без студии и качества — без скобок;
  «Что/Где/Когда: 2024?» → `Что-Где-Когда- 2024-` части без `/`; год `null` → без «()»; `toLocalPath('/downloads/dublyarr/x.mkv','/downloads','/storage/downloads')` → `/storage/downloads/dublyarr/x.mkv`;
  `/downloads2/x`, `/downloads/../etc/passwd`, `C:\\x` → `PathError`; `importFile` в tmp — ссылка (inode совпадает), повторный импорт заменяет; при подменённом `link`, бросающем `EXDEV` (вынести `fs` в параметр по умолчанию), — копия; `checkHardlink` на одном tmp — ok.
- [ ] **Step 2–4:** RED → реализация → GREEN. **Step 5: Commit** `feat(downloads): пути, шаблон имени, импорт`.

---

### Task 4: Таблицы загрузок

**Files:** Modify `src/lib/db/schema.ts`; Create `drizzle/0004_*.sql`; Test `tests/unit/downloads-schema.test.ts`
- `downloads`, `episode_files`, `wanted_state` — по спецификации (§ «Данные»). Индексы: `downloads(hash)` unique, `downloads(title_id, state)`, `episode_files(title_id, season, number)` unique, `wanted_state(title_id, season, number)` unique.
- [ ] **Step 1:** тест — вставки, уникальность, каскад от сериала, `set null` от раздачи. **Step 2–4:** RED → таблицы + миграция → GREEN. **Step 5: Commit** `feat(downloads): таблицы загрузок, файлов и состояния серий`.

---

### Task 5: Номер серии из имени файла

**Files:** Create `src/lib/episode-file.ts`; Test `tests/unit/episode-file.test.ts`

**Interfaces — Produces:**
```ts
export const VIDEO_EXT: Set<string>;   // .mkv .mp4 .avi .m4v .ts .webm
export const isVideo = (name: string) => boolean;
export function episodeFromFilename(path: string, season: number): number | null;   // берётся имя файла (последняя часть пути)
export function filesForEpisodes(files: { index: number; name: string; size: number }[], season: number, episodes: number[]): Map<number, number[]>; // серия → индексы файлов
```
`filesForEpisodes`: только видео; если в торренте один видеофайл и нужна одна серия — он; иначе по `episodeFromFilename` (сезон из имени, если указан, должен совпасть).

- [ ] **Step 1: Failing tests:**
```ts
test.each([
  ['Game.of.Thrones.S01E03.1080p.WEB-DL.LostFilm.mkv', 1, 3],
  ['The.Bear.S05E08.1080p.rus.LostFilm.TV.mkv', 5, 8],
  ['Severance/Severance.S02E07.2160p.ATVP.WEB-DL.mkv', 2, 7],
  ['Severance.S02E07.mkv', 1, null],                       // другой сезон
  ['1x03 - Lord Snow.avi', 1, 3],
  ['03. Лорд Сноу.mkv', 1, 3],
  ['Серия 03.mkv', 1, 3],
  ['03 серия.mp4', 1, 3],
  ['[AniLibria] Sousou no Frieren - 03 [1080p].mkv', 1, 3],
  ['Frieren 2nd Season - 07 (1080p HEVC).mkv', 2, 7],
  ['Show.2024.E05.1080p.x265.mkv', 1, 5],
  ['Show 2024 1080p.mkv', 1, null],                         // год и разрешение — не номер
  ['sample.mkv', 1, null],
])('%s', (name, season, n) => expect(episodeFromFilename(name, season)).toBe(n));
```
и `filesForEpisodes` для пака из 10 файлов + `.srt` + `sample`, однофайлового торрента, отсутствующей серии.
- [ ] **Step 2–4:** RED → реализация → GREEN. **Step 5: Commit** `feat(downloads): номер серии по имени файла`.

---

### Task 6: Что качать

**Files:** Create `src/lib/plan.ts`; Test `tests/unit/plan.test.ts`

**Interfaces — Produces:**
```ts
export type ActiveDownload = { id: number; kind: 'episode' | 'pack' | 'season'; season: number; episodes: { season: number; number: number }[]; files: { index: number; name: string; size: number; priority: number }[] | null; state: string };
export type EpisodePlan =
  | { action: 'have' }                                            // уже качается/скачана
  | { action: 'enable-file'; downloadId: number; fileIndexes: number[] }
  | { action: 'add'; releaseId: number }
  | { action: 'add-pack'; releaseId: number }
  | { action: 'wait'; until: string; reason: string }
  | { action: 'ask'; reason: string }
  | { action: 'none'; reason: string };
export function planEpisode(ep: { season: number; number: number }, verdicts: Verdict[], releasesById: Map<number, Release>, active: ActiveDownload[]): EpisodePlan;
export function seasonFinished(season: number, episodes: { season: number; number: number; airDate: string | null }[], today: string): boolean;
export function coversWholeSeason(p: ParsedRelease, season: number, episodeCount: number): boolean;
```
Порядок — по спецификации. `wait.until` — дата из причины `Рано: … до …` (вердикт хранит дату: добавить в `Verdict` поле `until?: string` в 1c-модуле `evaluate.ts`, тест 1c дополнить).
`none.reason`: «Подходящих раздач нет», если раздач нет; иначе причина у лучшей по рангу отклонённой.

- [ ] **Step 1: Failing tests:** серия уже в активной загрузке → `have`; пак сезона уже качается и в его файлах есть серия с приоритетом 0 → `enable-file`; лучшая — серия → `add`; лучшая — пак → `add-pack`;
  только `wait` → `wait` с ближайшей датой; `ask` → `ask`; пусто → `none`; `seasonFinished` (последняя серия вышла / есть серия без даты / нет серий); `coversWholeSeason` (пак без диапазона, `1…N`, `1…N-1`).
- [ ] **Step 2–4:** RED → реализация (+ `Verdict.until` в `evaluate.ts`) → GREEN. **Step 5: Commit** `feat(downloads): решение «что качать»`.

---

### Task 7: Выполнение плана

**Files:** Create `src/lib/downloads.ts`; Test `tests/unit/downloads.test.ts` (фиктивный `Qbit` в памяти — `tests/unit/fake-qbit.ts`)

**Interfaces — Produces:**
```ts
export type DownloadDeps = { qbit: Qbit; fetchTorrent: (r: Release) => Promise<Buffer | { magnet: string }>; paths: { qbitDownloads: string }; now?: number };
export async function startRelease(db, deps, release: Release, want: { season: number; number: number }[], kind: 'episode' | 'pack' | 'season'): Promise<Download>;
export async function enableFiles(db, deps, downloadId: number, want: { season: number; number: number }[]): Promise<void>;
export function activeDownloads(db, titleId: number): ActiveDownload[];   // state не imported/removed/error
export async function fetchTorrentFile(r: Release, fetchImpl?: typeof fetch): Promise<Buffer | { magnet: string }>; // расшифровка download_enc, иначе magnet; ошибка → DownloadError
```
`startRelease`: торрент → хэш (`parseTorrent`/`magnetHash`); если загрузка с таким хэшем уже есть — дополняет `episodes` и вызывает `enableFiles` (не создаёт вторую);
иначе `ensureCategory('dublyarr', {qbitDownloads}/dublyarr)` → `add(paused)` → запись `downloads` (`adding`) → для `pack`: `files` → приоритет 0 всем, 1 — файлам нужных серий (`filesForEpisodes`), нет файла серии → `error` «В раздаче нет файла S01E05», `remove`;
→ `start` → `downloading`. Для `episode`/`season` — сразу `start`.

- [ ] **Step 1: Failing tests:** серия из одиночной раздачи; пак — приоритеты 0/1 и запуск; повтор `startRelease` с тем же хэшем — одна запись, файлы добавлены (Review Focus №5); нет файла серии — `error` и торрент убран;
  `fetchTorrentFile`: расшифровка ссылки, magnet при отсутствии ссылки, ошибка сети → `DownloadError('Не удалось получить торрент')`.
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(downloads): добавление раздач в qBittorrent`.

---

### Task 8: Синхронизация и импорт

**Files:** Modify `src/lib/downloads.ts` (+`syncDownloads`), `src/worker/handlers.ts` (+`downloads.sync`), `src/worker/schedule.ts` (+`scheduleEvery(db, type, intervalMs, now)`), `src/worker/main.ts`, `src/lib/heartbeat.ts` (статус qBittorrent);
Test `tests/unit/sync.test.ts`, `tests/unit/schedule.test.ts`

**Interfaces — Produces:**
```ts
export async function syncDownloads(db, deps: { qbit: Qbit; paths: Paths; now?: number }): Promise<{ updated: number; imported: number; errors: number }>;
export function scheduleEvery(db, type: string, intervalMs: number, now?: number): boolean;  // scheduleDaily = scheduleEvery(…, DAY)
// heartbeat: beat(db, 'qbit', ok, info) ; serviceStatuses → «qBittorrent · 2 ↓ / не отвечает / не настроен»
```
`syncDownloads`: `list('dublyarr')` → по хэшу: прогресс, скорость, eta, `last_seeded_at` (если `num_seeds > 0`), состояние (`stopped*`/`paused*` → `paused`; нет сидов > 24 ч и не завершён → `stalled`);
нет в клиенте → `removed`; нужные файлы на 100 % (для `pack` — по `files`, для остальных — `progress = 1`) → импорт каждого нужного файла:
путь = `toLocalPath(save_path + '/' + file.name)` → `renderTemplate(paths.template ?? DEFAULT, vars)` → `importFile` → `episode_files` (upsert), `wanted_state` для серии удаляется → `imported`.
Ошибка импорта → `last_error`, состояние остаётся `completed` (повтор при следующем проходе).

- [ ] **Step 1: Failing tests:** прогресс обновляется; завершённая серия импортируется (файл в tmp-медиатеке, `episode_files`, состояние); пак — импортируются только нужные файлы; `stalled` через 24 ч без сидов;
  `removed`; ошибка импорта не теряет загрузку; `scheduleEvery` раз в час без дублей.
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(downloads): синхронизация с qBittorrent и импорт`.

---

### Task 9: Поиск по подпискам

**Files:** Create `src/lib/autosearch.ts`; Modify `src/worker/handlers.ts` (+`subscriptions.search`), `src/worker/main.ts` (раз в час), `src/lib/evaluate.ts` (если нужно);
Test `tests/unit/autosearch.test.ts`

**Interfaces — Produces:**
```ts
export type AutoDeps = { qbit: Qbit | null; fetchTorrent: DownloadDeps['fetchTorrent']; paths: Paths; searchOpts?: SearchOptions; today?: string; now?: number };
export async function searchSubscription(db, titleId: number, deps: AutoDeps): Promise<{ started: number; waiting: number; missing: number }>;
export async function searchAll(db, deps: AutoDeps): Promise<{ titles: number; started: number; errors: number }>;
export const SEARCH_EVERY = 3_600_000;
```
`searchSubscription`: нужные серии = `wantedEpisodes` − `episode_files` − активные загрузки; нет — выход без поиска; `wholeSeasonAfterFinale` — серии незаконченного сезона → `wanted_state: waiting «Ждём финал сезона»`, законченного → цель-сезон;
`searchTitle` один раз → по каждой серии `evaluateReleases` + `planEpisode` → выполнение (`startRelease`/`enableFiles`), серии одного пака — одним `startRelease`; `wait/ask/none` → `wanted_state`.
Без qBittorrent — только `wanted_state` (и `missing` с причиной «qBittorrent не подключён» для тех, что могли бы качаться).
Раздача, на которой загрузка ушла в `error`, исключается из выбора для этой серии (по `downloads.release_id` + `state = error`).

- [ ] **Step 1: Failing tests** (фиктивные qbit и fetch источников): подписка «все сезоны» на 1399 → стартует лучшая для каждой нужной серии; повторный вызов ничего не добавляет;
  ожидание → `wanted_state` с датой; «сезон целиком после финала» до финала → `waiting`, после → одна загрузка-сезон; без qbit — без загрузок; ошибка поиска одной подписки не мешает `searchAll`.
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(downloads): поиск и загрузка по подпискам`.

---

### Task 10: Настройки «Загрузка и папки»

**Files:** Create `src/app/(app)/settings/download/{page.tsx,actions.ts,QbitCard.tsx,PathsCard.tsx,TemplateCard.tsx}`; Test `tests/unit/paths-form.test.ts` (`src/lib/paths-form.ts`)
- Карточки по `Settings.dc.html` (раздел «Загрузка»): qBittorrent (адрес, логин, пароль — пустой не затирает, «Проверить» — версия), пути (три поля, «Проверить»: запись в `downloads` и `media`, `checkHardlink`, подсказка про сопоставление путей),
  шаблон (поле моно, пример имени для «Игра престолов S01E03 LostFilm 1080p», «Сбросить по умолчанию»).
- `parsePathsForm` — абсолютные пути, шаблон содержит `{С}` и `{Е}` (иначе «В шаблоне нужны {С} и {Е}»).
- [ ] **Step 1:** тест формы. **Step 2–4:** RED → GREEN → UI. **Step 5:** скриншоты. **Step 6: Commit** `feat(settings): загрузка и папки`.

---

### Task 11: «Активность» и «Скачать» в ручном поиске

**Files:** Modify `src/app/(app)/activity/page.tsx` (вместо заглушки), Create `src/app/(app)/activity/{actions.ts,QueueRow.tsx}`, `src/lib/activity.ts`; Modify `src/app/(app)/search/[tmdbId]/{page.tsx,actions.ts}`;
Test `tests/unit/activity.test.ts`
- `activityQueue(db)` → строки: сериал, «S01E03» или «S01 · 3 серии», исходное имя, прогресс, состояние-текст («Качается · 64 % · 4 мин», «Из пака: 1 файл из 10», «Нет сидов 6 ч», «На паузе», «Ошибка: …»), скорость. Сортировка: активные, затем ошибки, затем недавно завершённые (24 ч).
- Actions: пауза/продолжить/убрать из клиента (`remove`, запись → `removed`), «Искать сейчас» (ставит `subscriptions.search` в очередь), «Скачать» в ручном поиске (`startRelease` по раздаче и цели; ошибки — в строке).
- Телефон — `MobileActivity.dc.html`.
- [ ] **Step 1:** тест `activityQueue` (тексты состояний, сортировка). **Step 2–4:** RED → GREEN → UI. **Step 5:** скриншоты. **Step 6: Commit** `feat(activity): очередь загрузок и скачивание из ручного поиска`.

---

### Task 12: «Сегодня», «Календарь», статусы серий

**Files:** Create `src/lib/dashboard.ts`; Modify `src/app/(app)/page.tsx`, `src/app/(app)/calendar/page.tsx`, `src/app/(app)/series/[tmdbId]/page.tsx`; Test `tests/unit/dashboard.test.ts`

**Interfaces — Produces:**
```ts
export type EpisodeStatus = { state: 'downloaded' | 'downloading' | 'waiting' | 'missing' | 'ask' | 'upcoming' | 'skipped'; text: string; detail?: string };
export function episodeStatuses(db, titleId: number, today: string): Map<string, EpisodeStatus>;   // ключ `${season}:${number}`
export function todayData(db, today: string): { fresh: …[]; waiting: …[]; downloads: …[]; week: …[]; qbitConfigured: boolean };
export function calendarWeek(db, monday: string, today: string): { days: { date: string; weekday: string; today: boolean; events: { tmdbId; title; code; kind: 'downloaded' | 'aired' | 'upcoming'; sub: string }[] }[] };
export function mondayOf(date: string): string;
```
- «Сегодня» и «Календарь» — по макетам (без полос прогноза, без блоков фазы 2/3); карточка сериала — колонка «Статус» и подстрока файла.
- [ ] **Step 1: Failing tests:** статусы всех видов; «Новые серии» за 3 дня; «Ждём озвучку» из `wanted_state`; неделя календаря (понедельник, сегодня, виды событий). **Step 2–4:** RED → GREEN → UI.
- [ ] **Step 5:** скриншоты против `Main.dc.html`, `Mobile.dc.html`, `Calendar.dc.html`, `MobileCalendar.dc.html`, `Series.dc.html`. **Step 6: Commit** `feat(today): сегодня, календарь и статусы серий`.

---

### Task 13: E2E с заглушкой qBittorrent, документация

**Files:** Create `tests/e2e/qbit-stub.mjs` (порт 3197: вход, версия 2.11.4, add/info/files/filePrio/start/stop/delete/createCategory, «докачка» — при каждом `info` прогресс +0,5;
по завершении создаёт файлы в `E2E_DIR/qbit/…`, путь в ответе — `/downloads/...`), `tests/e2e/05-downloads.spec.ts`; Modify `playwright.config.ts`, `CLAUDE.md`, `README.md`.
- [ ] **Step 1: Сценарий:** вход → «Загрузка и папки»: qBittorrent (заглушка), пути (`/downloads` ↔ `E2E_DIR/qbit`, медиатека `E2E_DIR/media`), «Проверить» → «Жёсткие ссылки работают» →
  подписка на 1399 «все сезоны» → «Активность» → «Искать сейчас» → загрузка «Игра престолов · S01E…» появляется → через синхронизацию «Скачана» в карточке → файл есть в `E2E_DIR/media/Игра престолов (2011)/Season 01/` → «Новые серии» на «Сегодня».
- [ ] **Step 2:** `pnpm e2e` — 5 сценариев PASS. **Step 3:** `CLAUDE.md` — «Решения (фаза 1d)»; `README.md` — пути и сопоставление для Synology. **Step 4:** всё зелёное. **Step 5: Commit** `test(e2e): загрузки; документация`.
