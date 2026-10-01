# Фаза 2a «Надёжность загрузок»: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** докачивать новые серии из обновлённого топика в ту же раздачу, менять застрявшие раздачи, закрыть недочёты ревью 1d.

**Architecture:** смена версии топика — `switchTorrent` в `src/lib/downloads.ts` (её же вызывает `startRelease` для того же топика); отбор и проверка паков —
новый модуль `src/lib/pack-watch.ts` + задача воркера `packs.check` (30 мин); замена застрявших — в `src/lib/autosearch.ts`; правки 1d — точечно в своих модулях.

**Tech Stack:** как в 1d; новых зависимостей нет.

**Spec:** `docs/superpowers/specs/2026-10-01-phase-2a-reliability-design.md`; `docs/spec.md` §4, §5, §7; макет `Activity.dc.html`.

## Global Constraints

- Русский интерфейс; `requireSession()` и проверка id в actions; секреты — только зашифрованными, ссылки в логи — через `redactUrl`.
- Файлы не удаляются: из клиента убирается только торрент (`qbit.remove` — всегда `deleteFiles=false`); в медиатеке — только свой файл.
- Чужие торренты (не категории `dublyarr`) не трогаются.
- Каждая задача — тест сначала (RED), затем код (GREEN), затем `pnpm test && pnpm typecheck && pnpm lint`.

## Review Focus

1. **Топик обновился, а нужных серий в новой версии нет** (переделан под другой сезон) — старая загрузка не тронута, новый торрент не добавлен. Тест в Task 3.
2. **Старый торрент уже убран из клиента руками** — `switchTorrent` всё равно запускает новый, ошибка удаления старого не валит процесс. Тест в Task 3.
3. **Две проверки одного топика подряд** (поиск и `packs.check` в одну минуту) — второй вызов видит, что живая загрузка уже с новым хэшем, и ничего не делает. Тест в Task 4.
4. **Застрявшая раздача без замены** — остаётся как есть, серия не теряет статус «качается», торрент не убран. Тест в Task 5.
5. **Чужой файл по пути в медиатеке** — импорт не затирает, загрузка получает понятную ошибку, повтор не копирует заново. Тест в Task 7.

---

### Task 1: Данные: состояние `replaced`, `replaced_by_id`, `note`

**Files:** Modify `src/lib/db/schema.ts`; Create `drizzle/0006_*.sql` (`pnpm drizzle-kit generate`); Test `tests/unit/downloads-schema.test.ts`

**Interfaces — Produces:** `downloads.state` += `'replaced'`; `downloads.replacedById: number | null` (FK `downloads.id`, set null); `downloads.note: string | null`.

- [ ] **Step 1: Failing test:** вставка загрузки `state: 'replaced'` с `replacedById` и `note` читается обратно; удаление новой загрузки обнуляет `replacedById`.
- [ ] **Step 2–4:** RED → схема + миграция → GREEN. **Step 5: Commit** `feat(db): заменённые загрузки`.

---

### Task 2: Мелкие правки 1d: имя файла, сессия qBittorrent, гонка добавления

**Files:** Modify `src/lib/episode-file.ts`, `src/lib/qbit.ts`, `src/lib/downloads.ts`; Test `tests/unit/episode-file.test.ts`, `tests/unit/qbit.test.ts`, `tests/unit/downloads.test.ts`

**Interfaces — Produces:** `getQbit(db)` возвращает один и тот же клиент, пока настройки не изменились (кэш по `url+username+password`).

- [ ] **Step 1: Failing tests:**
  - `episodeFromFilename('Show - 2023 - 03 [1080p].mkv', 1) === 3`, `('Show - 2023.mkv', 1) === null`;
  - `getQbit(db) === getQbit(db)`; после смены настройки — другой объект;
  - `startRelease`: `qbit.add` бросает `QbitError`, но торрент с этим хэшем уже в `qbit.list` (его добавил другой вызов, записи ещё нет) → запись создаётся, загрузка запускается; вставка с уже существующим хэшем (гонка) → `enableFiles` существующей, одна запись.
- [ ] **Step 2–4:** RED → GREEN. Правило « - N»: `/ - (?!(?:19|20)\d\d(?!\d))(\d{1,4})${END}/`. **Step 5: Commit** `fix(downloads): год в имени файла, одна сессия qBittorrent, гонка добавления`.

---

### Task 3: Смена версии топика (`switchTorrent`)

**Files:** Modify `src/lib/downloads.ts`; Test `tests/unit/switch-torrent.test.ts`

**Interfaces — Produces:**
```ts
export type SwitchResult = { switched: true; download: Download; added: EpisodeRef[] } | { switched: false; reason: 'same-hash' | 'no-new-episodes' };
export async function switchTorrent(db, deps: DownloadDeps, old: Download, torrent: Buffer, want: EpisodeRef[]): Promise<SwitchResult>;
export function topicDownload(db, release: Release): Download | undefined; // живая (не replaced/removed/error) загрузка сериала с раздачей того же details_url
```
`switchTorrent`: хэш тот же → `same-hash`; иначе нужные = `want` ∪ (неимпортированные серии `old`, если `old` активна); найденные файлы (`filesForEpisodes`) пусто → `no-new-episodes`;
иначе `ensureCategory` → `add(paused, та же папка)` → приоритеты (1 — найденным, 0 — остальным) → вставка новой записи (`kind: 'pack'`, `releaseId: old.releaseId`, `studioLabel`, `resolution` от `old`)
→ `remove([old.hash])` (ошибку игнорировать, лог) → `old`: `replaced`, `replacedById`, `note` («Обновлена: +серия 6» / «Обновлена: +серии 6–7») → `start` → `downloading`.
`startRelease`: после получения торрента, если записи с этим хэшем нет, а `topicDownload(release)` есть и торрент — `Buffer` → `switchTorrent(old, torrent, want)`; `no-new-episodes` → `DownloadError('В раздаче нет файла S01E05')`.

- [ ] **Step 1: Failing tests:** обновление пака с E1–E2 до E1–E3, нужна E3 — новый торрент в `/downloads/dublyarr`, приоритеты `[0,0,1]`, старый убран из клиента, старая запись `replaced` + `note` «Обновлена: +серия 3»;
  старая ещё качала E2 → новая `episodes` [E2, E3]; тот же хэш → `same-hash`; в новой версии нет нужных файлов → `no-new-episodes`, клиент не тронут (Review Focus №1);
  старого торрента уже нет в клиенте → всё равно `switched` (№2); `startRelease` с другой раздачей того же топика → вызывает смену, а не второй торрент.
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(downloads): докачка из обновлённого топика`.

---

### Task 4: Проверка паков раз в 30 минут

**Files:** Create `src/lib/pack-watch.ts`; Modify `src/worker/handlers.ts`, `src/worker/main.ts`; Test `tests/unit/pack-watch.test.ts`

**Interfaces — Produces:**
```ts
export const PACK_CHECK_EVERY = 30 * 60_000;
export function watchedPacks(db, today: string): Download[];
export async function checkPacks(db, deps: DownloadDeps & { today?: string }): Promise<{ checked: number; switched: number; errors: number }>;
```
`watchedPacks` — по спецификации («Проверка паков»). `checkPacks`: для каждой — `deps.fetchTorrent(release)`; не `Buffer` → пропуск; нужные серии сезона = `wantedEpisodes` сезона без `episode_files` и без другой живой загрузки;
нет нужных → пропуск; иначе `switchTorrent`. Ошибка одной — `errors++`, лог, дальше. Воркер: `'packs.check'` (`getQbit`, `getSetting<Paths>('paths')`, `fetchTorrentFile`), `scheduleEvery(…, PACK_CHECK_EVERY)`.

- [ ] **Step 1: Failing tests:** отбор: пак подписки с невышедшей серией сезона — да; сезон весь скачан и вышел — нет; `kind: episode` — нет; без `details_url` — нет; без подписки — нет; `replaced` — нет.
  `checkPacks`: хэш сменился, вышла E3 → `switched: 1`; не сменился → `switched: 0`; `fetchTorrent` бросает у одной из двух → `errors: 1`, вторая проверена;
  два вызова подряд после смены → второй `switched: 0` (Review Focus №3).
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(worker): проверка обновлений паков`.

---

### Task 5: Замена застрявшей раздачи

**Files:** Modify `src/lib/autosearch.ts`, `src/lib/downloads.ts`; Test `tests/unit/autosearch.test.ts`

**Interfaces — Produces:** `export function releaseStalled(db, stalledId: number, movedEpisodes: EpisodeRef[], replacedById: number, qbit): Promise<void>` в `downloads.ts`
(убрать серии из застрявшей; пусто → `remove`, `replaced`, `note` «Заменена: нет сидов»).

В `searchSubscription`: загрузки `stalled` не входят в `busy`/`active`; их раздачи — отвергнуты для их серий (как `error`); после успешного `startRelease` для серий застрявшей — `releaseStalled`.

- [ ] **Step 1: Failing tests:** застрявшая пак-загрузка E1–E2 + есть другая подходящая раздача → новая загрузка E1–E2, застрявшая `replaced`, `note` «Заменена: нет сидов», торрент убран;
  другой раздачи нет → застрявшая не тронута, торрент в клиенте, `wanted_state` для E1–E2 не появился (Review Focus №4).
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(downloads): замена застрявших раздач`.

---

### Task 6: Поиск по подписке: «сезон целиком», финал без дат, устаревшие статусы, сбои

**Files:** Modify `src/lib/autosearch.ts`, `src/lib/plan.ts`, `src/app/(app)/search/[tmdbId]/actions.ts`; Test `tests/unit/autosearch.test.ts`, `tests/unit/plan.test.ts`

**Interfaces — Produces:** `seasonFinished(season, episodes, today, claimedTotal?: number)` — `true`, если все серии сезона с датой уже вышли и при этом
либо серий без даты нет, либо `claimedTotal` (из пака «Серии: 1–N из N», `parsed.totalInSeason` при `episodes.from ≤ 1` и `episodes.to = totalInSeason`) ≥ числа серий сезона в TMDB.

- [ ] **Step 1: Failing tests:**
  - «сезон целиком» + «начиная с серии 2» → загрузка `season` с `episodes` [E2, E3], без E1; уже есть файл E2 → [E3];
  - E3 без даты, раздача «S1E1-10 of 10» → сезон считается законченным, загрузка `season` (а не «Ждём финал сезона»);
  - `wanted_state` для серии, которая стала не нужна (подписка «начиная с серии 3»), удаляется при поиске;
  - `enableFiles` бросает у одной серии → остальные серии подписки всё равно запущены, у сбойной — `missing` с текстом ошибки.
- [ ] **Step 2–4:** RED → GREEN; ручное «Скачать» снимает `wanted_state` с запущенных серий. **Step 5: Commit** `fix(autosearch): сезон целиком по подписке, финал по паку, статусы, сбои`.

---

### Task 7: Синхронизация: сбой одной загрузки, чужой файл в медиатеке

**Files:** Modify `src/lib/downloads.ts`, `src/lib/importer.ts`; Test `tests/unit/sync.test.ts`, `tests/unit/importer.test.ts`

**Interfaces — Produces:** `importFile(src, mediaRoot, rel, fsx, opts?: { replace: boolean })` — по умолчанию цель существует → `ImportError('Файл уже есть в медиатеке: <rel>')`; `replace: true` — замена (как сейчас).
`importDownload` передаёт `replace: true`, только если `episode_files` этой серии уже указывает на этот `rel`.

- [ ] **Step 1: Failing tests:** `qbit.files` бросает у одной из двух загрузок → вторая обновлена и импортирована; в медиатеке по пути уже лежит чужой файл → `lastError` «Файл уже есть в медиатеке: …», файл не тронут,
  повторная синхронизация не копирует (Review Focus №5); повторный импорт своей же серии по тому же пути — заменяет.
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** `fix(sync): сбой одной загрузки, чужой файл в медиатеке`.

---

### Task 8: «Активность»: заменённые загрузки, проверки кнопок

**Files:** Modify `src/lib/activity.ts`, `src/app/(app)/activity/actions.ts`, `src/app/(app)/activity/page.tsx`; Test `tests/unit/activity.test.ts`

**Interfaces — Produces:** `activityQueue` показывает `replaced` сутки (группа как у `imported`), `state` = `note`, `tone: 'muted'`; качающийся пак с `details_url` — `state` с префиксом «Пак · следим за обновлениями · …».
```ts
export async function controlDownload(db, qbit: Qbit | null, id: number, action: 'pause' | 'resume' | 'remove'): Promise<{ ok: true } | { error: string }>;
```
`pause` — только `downloading/stalled`; `resume` — только `paused`; `remove` — не `imported/replaced/removed`; без qBittorrent → `{ error: 'qBittorrent не подключён' }`; ошибка клиента → `{ error }`, состояние не меняется
(кроме `remove`: торрента уже нет в клиенте → `removed`). Actions вызывают её.

- [ ] **Step 1: Failing tests:** очередь с `replaced` и пак с топиком — тексты; `controlDownload`: `resume` у `imported` → ошибка, состояние то же; без qBittorrent → ошибка; `pause` у `downloading` → `paused`.
- [ ] **Step 2–4:** RED → GREEN, actions на `controlDownload`. **Step 5: Commit** `feat(activity): заменённые загрузки, проверки кнопок`.

---

### Task 9: E2E и документация

**Files:** Modify `tests/e2e/tmdb-stub.mjs` (`POST /__air?ep=3&date=2011-05-01` — у серии 3 сезона 1 появляется дата), `tests/e2e/jackett-stub.mjs` (`POST /__update` — пак получает новую версию: другой хэш, те же файлы);
Create `tests/e2e/06-pack-update.spec.ts`; Modify `CLAUDE.md` («Решения (фаза 2a)»).

- [ ] **Step 1: Сценарий** (после 05: E1–E2 в медиатеке из пака LostFilm): `/__air` → карточка «Обновить из TMDB» → `/__update` → «Активность» → «Искать сейчас» →
  в очереди «Обновлена: +серия 3» → через синхронизацию «В медиатеке» → `E2E_DIR/media/Игра престолов (2011)/Season 01/` содержит S01E03.
- [ ] **Step 2:** `pnpm e2e` — 6 сценариев PASS. **Step 3:** `CLAUDE.md`. **Step 4:** всё зелёное. **Step 5: Commit** `test(e2e): обновление пака; документация`.
