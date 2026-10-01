# Фаза 3c «Фильмы»: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** подписка на фильмы в нужном переводе и качестве: цифровой релиз, перевод по приоритету с ожиданием дубляжа, замена на дубляж и BDRemux, карточка фильма, вкладка «Фильмы».

**Architecture:** фильм — `titles.kind = 'movie'` (+ `tmdb_type = 'movie'`), подписка — `subscriptions` с `MovieProfile`, файл — `episode_files` с `MOVIE_EP = { season: 0, number: 0 }`.
Новые чистые модули: `src/lib/movie-profile.ts` (профиль), `src/lib/movie-evaluate.ts` (совпадение, вердикты, цифровой релиз, ожидание), `src/lib/movie-files.ts` (выбор файла);
ввод-вывод: `src/lib/movies.ts` (каталог фильма), `src/lib/movie-search.ts` (автопоиск и замена). Остальное — встраивание в существующие загрузки, импорт, хранение и экраны.

**Tech Stack:** как раньше.

**Spec:** `docs/superpowers/specs/2026-10-01-phase-3c-movies-design.md`; `docs/spec.md` §10; макет `Settings.dc.html` («Фильмы»).

## Global Constraints

- Сериальное поведение не меняется: все существующие тесты проходят без правок ожиданий (кроме сигнатур `getTitleByTmdbId`).
- Одноголосые и авторские переводы не берутся; экранки — только если `noCam` выключен.
- Удаление — только по правилам 3b (старая копия после замены — правило 2b/3b с подтверждением).
- Все тексты интерфейса — на русском; карточка фильма адаптивна (desktop + 390 px).
- Каждая задача — тест сначала, затем код, затем `pnpm test && pnpm typecheck && pnpm lint`.

## Review Focus

1. **Одинаковый tmdb id у сериала и фильма** — открытие `/series/550` и `/movie/550` даёт разные записи, подписки не путаются. Тест в Task 1.
2. **Многоголосый появился раньше дубляжа** — до `waitDubDays` от цифрового релиза не качается, статус «Ждём дубляж до …»; без цифрового релиза (`digitalOnly`) — «Ждём цифровой релиз». Тест в Task 3.
3. **Раздача фильма с сэмплом, трейлером и двумя версиями** — включается один основной файл; `BDMV`/`VIDEO_TS` — отказ. Тест в Task 5.
4. **Папка фильмов не задана** — загрузка не стартует, сериалы работают, «Требует внимания». Тест в Task 4.
5. **Файл фильма в правилах хранения** — путь берётся относительно папки фильмов; правило сезонов фильм не трогает; удаление вне папки фильмов отказывается. Тест в Task 6.

---

### Task 1: Каталог фильмов

**Files:** Modify `src/lib/db/schema.ts` (+ `drizzle/0013_*.sql`), `src/lib/tmdb/client.ts`, `src/lib/tmdb/map.ts`, `src/lib/catalog.ts` (`getTitleByTmdbId(db, id, type = 'tv')`, все вызовы);
Create `src/lib/movies.ts`, `tests/fixtures/tmdb/movie-*.json`; Modify `tests/e2e/tmdb-stub.mjs`; Test `tests/unit/movies.test.ts`, `tests/unit/tmdb.test.ts`

**Interfaces — Produces:**
`titles` += `tmdbType: 'tv' | 'movie'` (default 'tv'), `runtime: number | null`, `releaseDates: { theatrical: string | null; digital: string | null; physical: string | null } | null`, `digitalSeenAt: string | null`;
`kind` += `'movie'`; `status` += `'released'`; уникальность `(tmdb_type, tmdb_id)` вместо `tmdb_id` (миграция пересоздаёт индекс).
```ts
// tmdb
movie(id: number): Promise<TmdbMovieDetails>; searchMulti(q: string): Promise<TmdbListItem[]>; trendingAll(): Promise<TmdbListItem[]>; // TmdbListItem — с media_type
export function mapMovie(d: TmdbMovieDetails): TitleFields; export function pickReleaseDates(r: TmdbMovieDetails['release_dates']): ReleaseDates;
// movies.ts
export const MOVIE_EP = { season: 0, number: 0 } as const;
export async function syncMovie(db, tmdb, tmdbId, now?): Promise<Title>;
export async function openMovie(db, tmdb | null, tmdbId, now?): Promise<OpenResult>;
export function digitalReleased(t: Title, today: string): string | null; // дата цифрового релиза (TMDB 4/5 ≤ сегодня или digitalSeenAt), иначе null
```
- [ ] **Step 1: Failing tests:** `pickReleaseDates` (RU в приоритете, US, любая; самые ранние типы 3/4/5); `mapMovie` (год, runtime, `planned`/`released`, пустое описание → en);
  `syncMovie` создаёт `kind = 'movie'`, `tmdbType = 'movie'`; сериал и фильм с одинаковым id — две записи, `getTitleByTmdbId(db, 550)` — сериал, `(db, 550, 'movie')` — фильм (Review Focus №1);
  `digitalReleased` по датам TMDB и по `digitalSeenAt`; `titlesDueForRefresh` — фильм без цифрового релиза ежедневно.
- [ ] **Step 2–4:** RED → GREEN. `tmdb.refresh-all` освежает фильмы через `syncMovie`. **Step 5: Commit** `feat(movies): каталог фильмов`.

---

### Task 2: Профиль фильма и подписка

**Files:** Create `src/lib/movie-profile.ts`; Modify `src/lib/profile.ts` (`profile.movie`), `src/lib/subscriptions.ts`, `src/lib/db/schema.ts` (тип `profile`); Test `tests/unit/movie-profile.test.ts`

**Interfaces — Produces:**
```ts
export type MovieDubKind = 'dub' | 'mvo' | 'original';
export type MovieProfile = { type: 'movie'; dubs: { kind: MovieDubKind; on: boolean }[]; waitDubDays: number; quality: Quality; noCam: boolean; digitalOnly: boolean; remux: boolean; replaceWithDub: boolean };
export const DEFAULT_MOVIE_PROFILE: MovieProfile; // dub, mvo, original вкл.; 14 дн; 1080p, ниже — да, HDR — нет, 30 ГБ; noCam, digitalOnly, replaceWithDub — да; remux — нет
export const isMovieProfile: (p: Profile | MovieProfile) => p is MovieProfile;
export function validateMovieProfile(raw: unknown): { ok: true; profile: MovieProfile } | { ok: false; error: string };
export function describeMovieProfile(p: MovieProfile): string[]; // строки для панели подписки
export const MOVIE_DUB_LABEL: Record<MovieDubKind, string>; // Дубляж / Многоголосый / Оригинал + субтитры
export function getMovieDefault(db): MovieProfile;
```
`subscriptions.profile` — `Profile | MovieProfile`; сериальные места берут `seriesProfile(sub)` (бросает для фильма) — найти все обращения к `sub.profile` (`grep -rn "\.profile" src/lib`) и сузить.
`subscribe(db, titleId, profile)` для фильма принимает только `MovieProfile` (и наоборот) — иначе `SubscriptionError`.
- [ ] **Step 1: Failing tests:** проверка (нет ни одной включённой позиции — ошибка; дни 0–90; лимит 1–200 ГБ; лишние/повторные позиции), описание, по умолчанию из настроек, подписка фильма сериальным профилем — ошибка;
  автопоиск сериалов не трогает подписку фильма.
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(movies): профиль фильма`.

---

### Task 3: Совпадение, вердикты и ожидание

**Files:** Create `src/lib/movie-evaluate.ts`; Test `tests/unit/movie-evaluate.test.ts`

**Interfaces — Produces:**
```ts
export function matchMovie(p: ParsedRelease, size: number, t: Pick<Title, 'nameRu' | 'nameOriginal' | 'altNames' | 'year'>, rule?: 'match' | 'reject'): MatchResult;
export function movieDubPos(p: ParsedRelease, profile: MovieProfile): number | null; // индекс позиции профиля
export type MovieVerdict = { releaseId: number; ok: boolean; reason?: string; dubPos: number | null; resolution: number | null; remux: boolean; score: number; doubt?: boolean };
export function evaluateMovie(releases: Release[], ctx: { profile: MovieProfile; title: Title; rules: Map<string, 'match' | 'reject'> }): MovieVerdict[];
export type MovieDecision = { action: 'start'; releaseId: number } | { action: 'wait'; state: 'digital' | 'dub'; until?: string } | { action: 'none' } | { action: 'ask'; releaseId: number; reason: string };
export function decideMovie(verdicts: MovieVerdict[], profile: MovieProfile, digital: string | null, today: string): MovieDecision;
```
- [ ] **Step 1: Failing tests** (заголовки — реальные, `tests/fixtures/releases/movies.tsv`, 20+ строк с ожидаемыми переводом/источником/качеством):
  совпадение (название + год ±1; сериал «S01E01» — не фильм; размер 300 МБ — сомнительно); отказы «Экранка», «Не цифровой релиз», «Больше 30 ГБ», «Выше 1080p», «Нет нужного перевода»;
  позиция: «Дубляж» > «MVO» > «Original + Sub», выключенная позиция пропускается, DVO = многоголосый, VO/AVO — нет;
  `decideMovie`: только MVO, цифровой 5 дней назад, ждём 14 → `wait dub until` (дата +14); 15 дней → `start` MVO; дубляж есть — `start` сразу; без цифрового релиза и `digitalOnly` — `wait digital` (Review Focus №2); сомнительная лучшая — `ask`.
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(movies): выбор раздачи фильма`.

---

### Task 4: Автопоиск фильмов и замена

**Files:** Modify `src/lib/search.ts` (`queriesFor` с годом для фильма, категории 2000/2040/2045/2050/2060 для фильма, `digitalSeenAt`), `src/lib/manual-search.ts`, `src/lib/autosearch.ts` (фильмы → `searchMovie`), `src/lib/dashboard.ts` («Требует внимания»: «Не задана папка фильмов»);
Create `src/lib/movie-search.ts`; Test `tests/unit/movie-search.test.ts`

**Interfaces — Produces:**
```ts
export async function searchMovie(db, titleId, deps: AutoDeps): Promise<{ started: number; waiting: number; missing: number }>;
export function movieUpgrade(file: EpisodeFile, verdicts: MovieVerdict[], profile: MovieProfile, today: string): MovieVerdict | null; // дубляж ≤ 180 дн от импорта; Remux при profile.remux
```
Статусы — `setWanted/clearWanted` для `MOVIE_EP` (`digital` → «Ждём цифровой релиз», `waiting` с датой, `missing`, `ask`); подпись улучшения — `downloads.note` («Улучшение: многоголосый → дубляж» / «WEB-DL → BDRemux»).
- [ ] **Step 1: Failing tests** (заглушки источников и fake qBittorrent как в `autosearch.test.ts`): первая цифровая раздача пишет `digitalSeenAt`; MVO до окна — не качается, статус с датой; дубляж — загрузка;
  скачан MVO + вышел дубляж — загрузка-улучшение; Remux при `remux` — улучшение, без — нет; 181 день после импорта — дубляж больше не ищется; папки фильмов нет — загрузки нет, пункт внимания (Review Focus №4); `subscriptions.tick` берёт фильмы.
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(movies): автопоиск и замена`.

---

### Task 5: Загрузка и импорт фильма

**Files:** Create `src/lib/movie-files.ts`; Modify `src/lib/downloads.ts` (`startRelease` для фильма, `importEpisode` — корень и шаблон фильма), `src/lib/library-path.ts` (`DEFAULT_MOVIE_TEMPLATE`, `{Перевод}`), `src/lib/media/process.ts` (нужная озвучка по типу перевода), `src/lib/downloads.ts` (`Paths` += `movies?`, `movieTemplate?`);
Test `tests/unit/movie-files.test.ts`, `tests/unit/sync.test.ts`, `tests/unit/process.test.ts`

**Interfaces — Produces:**
```ts
export function pickMovieFile(files: { name: string; size: number }[]): { main: number; external: number[] } | { error: string }; // индексы в списке qBittorrent
export const DEFAULT_MOVIE_TEMPLATE = '{Название} ({Год})/{Название} ({Год}) [{Перевод} {Качество}]';
export function mediaRoot(paths: Paths, kind: Title['kind']): string | null; // фильм — paths.movies
```
- [ ] **Step 1: Failing tests:** выбор файла — сэмпл, трейлер, `Extras/`, две версии → самый большой; `BDMV`/`VIDEO_TS` → «Диск, а не файл» (Review Focus №3); внешние `.mka/.srt` включены;
  синхронизация: торрент фильма → файл `Матрица (1999)/Матрица (1999) [Дубляж 1080p].mkv` в папке фильмов, `episode_files` с `MOVIE_EP`, путь относительно папки фильмов; замена — старая копия по правилу 2b;
  пересборка: дорожка «Дубляж» выбирается для позиции `dub`, длительность сверяется с `runtime` фильма (сериал 45 мин вместо фильма 136 — «Не тот фильм»).
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(movies): загрузка и импорт фильма`.

---

### Task 6: Хранение, диск и удаление

**Files:** Modify `src/lib/retention.ts`, `src/lib/delete-series.ts`, `src/lib/storage.ts` (сегмент «Фильмы», строки фильмов, диск — оба тома), `src/lib/old-copies.ts` (корень фильма), `src/worker/handlers.ts`; Test `tests/unit/retention.test.ts`, `tests/unit/storage.test.ts`, `tests/unit/delete-series.test.ts`

**Interfaces — Produces:** `runRetention(db, roots: { media: string; movies?: string }, …)`; `deleteSeries(db, deps, titleId, mode)` — корень по виду; `storageData` — сегмент «Фильмы», строка фильма `{ seasons: '', quality, rule, … }`; `checkDisk` — самый заполненный из томов.
- [ ] **Step 1: Failing tests:** «через N дней» удаляет файл фильма в папке фильмов; правило сезонов фильм не трогает; путь `../x` в папке фильмов — отказ (Review Focus №5); удаление фильма «только файлы»;
  сегмент «Фильмы» и строка фильма; диск: медиатека 50 %, фильмы 98 % → пауза.
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(movies): хранение фильмов`.

---

### Task 7: Карточка фильма, окно подписки, ручной поиск

**Files:** Create `src/app/(app)/movie/[tmdbId]/page.tsx`, `MovieTimeline.tsx`, `actions.ts`, `src/components/subscribe/MovieProfileEditor.tsx`, `MovieSubscribeDialog.tsx`; Create `src/lib/movie-card.ts`;
Modify `src/app/(app)/search/[tmdbId]/page.tsx` (`?type=movie`); Test `tests/unit/movie-card.test.ts`

**Interfaces — Produces:**
```ts
export function movieCard(db, titleId, today): { steps: { key: 'theatrical' | 'digital' | 'dub' | 'file'; title: string; date: string | null; state: 'done' | 'forecast' | 'wait' | 'none'; sub: string }[];
  file: { dub: string; quality: string; hdr: boolean; size: number; processed: boolean } | null; status: string };
```
- [ ] **Step 1: Failing tests:** шаги ленты (кинотеатры прошли; цифровой — дата или «ещё нет»; дубляж — «ждём до 12 окт» как прогноз / «нашёлся» / «есть» ; файл — «Дубляж · 2160p · 24 ГБ»); статус для библиотеки.
- [ ] **Step 2–4:** RED → GREEN → страница (шапка как у сериала, лента, файл, подписка, «Хранение», «Удалить…»), окно подписки фильма, ручной поиск фильма (без сезона/серии, причины отказа).
- [ ] **Step 5:** скриншоты desktop + 390 px (карточка без подписки, с ожиданием дубляжа, со скачанным файлом; окно подписки). **Step 6: Commit** `feat(movies): карточка фильма`.

---

### Task 8: Библиотека, поиск, «Сегодня», календарь, настройки

**Files:** Modify `src/app/(app)/library/*` (вкладка «Фильмы»), `src/app/(app)/discover/*` (`searchMulti`, `trendingAll`, метка «Фильм», ссылки на `/movie/…`), `src/lib/dashboard.ts` («Ждём озвучку» и календарь — фильмы),
`src/components/shell/nav.ts` (раздел «Фильмы» без «phase»), Create `src/app/(app)/settings/movies/*`, Modify `src/app/(app)/settings/download/*` (папка фильмов и шаблон); Test `tests/unit/dashboard.test.ts`, `tests/unit/library.test.ts`

- [ ] **Step 1: Failing tests:** библиотека с фильтром `movie`; «Ждём озвучку» — фильм «Дубляж ≈ 12 окт»; календарь — цифровой релиз фильма; разбор формы «Фильмы» (`validateMovieProfile`) и папок (папка фильмов — абсолютный путь).
- [ ] **Step 2–4:** RED → GREEN → экраны по макету (`Settings.dc.html` «Фильмы» с «Как это выглядит» по последнему фильму в подписках). **Step 5:** скриншоты desktop + 390 px. **Step 6: Commit** `feat(movies): фильмы в библиотеке, поиске и настройках`.

---

### Task 9: E2E и документация

**Files:** Create `tests/e2e/11-movies.spec.ts`; Modify `tests/e2e/tmdb-stub.mjs` (фильм, `search/multi`, `trending/all`), `tests/e2e/jackett-stub.mjs` (`POST /__movie?stage=mvo|dub`), `playwright.config.ts` (`movies` в `E2E_DIR`), `CLAUDE.md` («Решения (фаза 3c)»).

- [ ] **Step 1:** сценарий: настройка папки фильмов → «Поиск» «Матрица» → карточка фильма → «Подписка» (по умолчанию) → на трекере MVO WEB-DL → «Ждём дубляж до …» → `/__movie?stage=dub` → загрузка → файл `Матрица (1999)/Матрица (1999) [Дубляж 1080p].mkv` в папке фильмов, на карточке «В медиатеке».
- [ ] **Step 2:** `pnpm e2e` — 11 сценариев PASS. **Step 3:** `CLAUDE.md`. **Step 4: Commit** `test(e2e): фильмы; документация`.
