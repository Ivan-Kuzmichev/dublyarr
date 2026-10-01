# Фаза 2b «Озвучки и прогноз»: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** прогноз озвучки по истории студий, замена на лучшую озвучку и качество с правилом старой копии, автоподписка на новые сезоны.

**Architecture:** наблюдения — `src/lib/sightings.ts` (вызывается из `searchTitle`); задержки и прогноз — чистый модуль `src/lib/forecast.ts`;
замена — `src/lib/upgrade.ts` (кандидаты и «что лучше») + `autosearch.ts`; старые копии — `src/lib/old-copies.ts` + страница `/old-copies`;
новые сезоны и заметки — `src/lib/seasons-watch.ts`, `src/lib/notices.ts`; экраны — через `src/lib/dashboard.ts` и страницы.

**Tech Stack:** как раньше, без новых зависимостей.

**Spec:** `docs/superpowers/specs/2026-10-01-phase-2b-dubs-forecast-design.md`; `docs/spec.md` §1, §8, §9, §11; макеты `Main.dc.html`, `Mobile.dc.html`, `Calendar.dc.html`,
`MobileCalendar.dc.html`, `Series.dc.html`, `MobileSeries.dc.html`, `Subscribe.dc.html`.

## Global Constraints

- Русский интерфейс; токены дизайна; цели нажатия ≥ 44 px; `requireSession()` и проверка id во всех actions.
- Удаление файлов — только по правилу «Старая копия после улучшения»: до подтверждения — перенос в `{media}/.dublyarr-old`, удалять — только файлы внутри медиатеки, записанные как старая копия.
- Прогноз — всегда пунктирная янтарная рамка; «скачано» — светлая заливка; «оригинал» — серая рамка (design/README).
- Каждая задача — тест сначала, затем код, затем `pnpm test && pnpm typecheck && pnpm lint`.

## Review Focus

1. **Путь старой копии с `..` или вне медиатеки** (испорченная запись в БД) — удаление отказывает, ничего вне `{media}/.dublyarr-old` не удаляется. Тест в Task 6.
2. **Новая копия по тому же пути, что старая** (студия и качество не меняют имя по шаблону пользователя) — старая сначала уходит в скрытую папку, новая ложится, ничего не теряется. Тест в Task 6.
3. **Замена не докачалась / импорт упал** — старая копия на месте, `episode_files` указывает на неё. Тест в Task 6.
4. **Серия без даты эфира или раздача раньше эфира** — не ломает медиану, прогноз «нет данных». Тест в Task 3.
5. **Сериал без подписки или подписка «до конца сезона»** при новом сезоне — заметка без расширения / без изменений, ничего не качается. Тест в Task 8.

---

### Task 1: Данные

**Files:** Modify `src/lib/db/schema.ts`; Create `drizzle/0007_*.sql`; Test `tests/unit/schema-2b.test.ts`

**Interfaces — Produces:**
- `studioSightings` (`titleId` FK cascade, `studioId` FK cascade, `season`, `number`, `seenAt`, `basis: 'seen'|'published'`, `fromPack: boolean`; unique title+studio+season+number);
- `oldCopies` (`titleId` FK cascade, `season`, `number`, `path`, `size`, `reason`, `createdAt`);
- `notices` (`titleId` FK cascade, `kind: 'season-subscribed'|'season-not-included'`, `text`, `createdAt`);
- `episodeFiles.dubPosition: number | null`, `downloads.dubPosition: number | null`, `subscriptions.maxSeason: number | null`;
- миграция заполняет `max_season` у существующих подписок номером последнего сезона сериала.

- [ ] **Step 1: Failing test:** вставка/уникальность наблюдений, каскады при удалении сериала, новые колонки читаются. **Step 2–4:** RED → GREEN (миграция с `UPDATE subscriptions SET max_season = …`). **Step 5: Commit** `feat(db): наблюдения студий, старые копии, заметки`.

---

### Task 2: Наблюдения

**Files:** Create `src/lib/sightings.ts`; Modify `src/lib/search.ts`, `src/worker/main.ts`; Test `tests/unit/sightings.test.ts`

**Interfaces — Produces:**
```ts
export function recordSightings(db, titleId: number, releases: Release[]): void;
export function backfillSightings(db): void; // один раз (флаг app_settings['sightings.backfilled'])
```
По спецификации §1. `searchTitle` вызывает `recordSightings` после сохранения раздач; воркер при старте — `backfillSightings`.

- [ ] **Step 1: Failing tests:** отдельная серия → `seen`, `fromPack=false`; пак «1–8» → 8 записей `fromPack=true`; пак без диапазона → серии сезона с датой эфира; `publishedAt` раньше → `published` и её дата;
  повтор с более поздней датой — запись не меняется, с более ранней — меняется; отдельная серия после пака → `fromPack=false`; нераспознанная студия и `match` не `match` — ничего; backfill один раз.
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(forecast): наблюдения студий`.

---

### Task 3: Задержки и прогноз

**Files:** Create `src/lib/forecast.ts`; Test `tests/unit/forecast.test.ts`

**Interfaces — Produces:**
```ts
export type StudioDelay = { studioId: number; days: number | null; count: number; basis: 'seen' | 'published' | 'packs' | 'none'; basisText: string };
export function studioDelays(db, titleId: number): Map<number, StudioDelay>;
export type PositionForecast = { label: string; studioId: number | null; expected: string | null; observedDays: number | null; delay: StudioDelay | null };
export type EpisodeForecast = { positions: PositionForecast[]; eta: string | null; etaText: string; fallbackNote: string; progress: number | null; fallbackMark: number | null };
export function forecastEpisode(profile: Profile, ep: { season: number; number: number; airDate: string }, delays: Map<number, StudioDelay>,
  sightings: { studioId: number; season: number; number: number; seenAt: number }[], studioName: (id: number) => string | undefined, today: string): EpisodeForecast;
export function formatDelay(days: number): string; // «+1 день», «+1,5 дня», «+5 дней»
```
`basisText`: «по N сериям» (склонение), «≈ по датам раздач», «только паки», «нет данных». `etaText`: «≈ сегодня» / «≈ завтра» / «≈ 2 октября» / «прогноза нет».
`progress` — (сегодня − эфир) / (eta − эфир), 0…1; `fallbackMark` — то же для даты открытия следующей позиции.

- [ ] **Step 1: Failing tests:** медиана (нечётное/чётное число, округление до 0,5); приоритет классов (отдельные `seen` > `published` > паки); отрицательные задержки и серии без даты игнорируются (Review Focus №4);
  прогноз: ожидаемые даты по позициям, наблюдённая задержка, `etaText`, строка запасного варианта для «студия → студия», «студия → Любая», без запасной; `formatDelay`.
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(forecast): задержки студий и прогноз`.

---

### Task 4: Прогноз на экранах

**Files:** Modify `src/lib/dashboard.ts`, `src/app/(app)/page.tsx`, `src/app/(app)/calendar/page.tsx`, `src/app/(app)/series/[tmdbId]/page.tsx`, `src/components/subscribe/ProfileEditor.tsx` (+ проброс оснований);
Test `tests/unit/dashboard.test.ts`

**Interfaces — Produces:** `WaitingItem` += `etaText`, `progress`, `fallbackMark`, `delayText` («HDrezka обычно +1 день»), `fallbackNote`; `calendarWeek` — события `kind: 'forecast'` (`sub` «HDrezka ≈ +1 д»);
`seriesDubColumns(db, titleId, season, today)` → колонки студий профиля (до 3) и ячейки серий `{ kind: 'done' | 'expected' | 'none'; text }`; `speedBlock(db, titleId)` → `{ name, text, width }[]`;
`delayBasis(db, titleId)` → `Record<studioId, basisText>` для окна подписки.

- [ ] **Step 1: Failing tests:** данные «Ждём озвучку» с прогнозом; события прогноза в календаре; колонки студий и блок скорости.
- [ ] **Step 2–4:** RED → GREEN → UI по макетам. **Step 5:** скриншоты desktop + 390 px против макетов. **Step 6: Commit** `feat(forecast): прогноз на «Сегодня», в календаре, карточке и подписке`.

---

### Task 5: Замена на лучшую версию

**Files:** Create `src/lib/upgrade.ts`; Modify `src/lib/autosearch.ts`, `src/lib/downloads.ts` (`dubPosition` в загрузке и файле), `src/lib/activity.ts`; Test `tests/unit/upgrade.test.ts`, `tests/unit/autosearch.test.ts`

**Interfaces — Produces:**
```ts
export const UPGRADE_DAYS = 30;
export function upgradeCandidates(sub: Subscription, files: EpisodeFile[], episodes: Episode[], today: string): EpisodeFile[];
export function betterVerdict(file: EpisodeFile, verdicts: Verdict[], releasesById: Map<number, Release>, target: number): Verdict | null;
export function upgradeNote(file: EpisodeFile, release: Release, verdict: Verdict, profile: Profile, studioName): string; // «Улучшение: LostFilm → HDrezka» / «Улучшение: 1080p → 2160p»
```
`startRelease(..., studioLabel, opts?: { dubPosition?: number | null; note?: string })` — сохраняет в загрузке; импорт переносит `dubPosition` в `episode_files`.
`searchSubscription`: после основных серий — кандидаты на замену (без `wanted_state`), лучшая раздача → `startRelease` с `note`.

- [ ] **Step 1: Failing tests:** кандидаты (позиция > 0 и флаг; ниже целевого качества; старше 30 дней — нет; флаг выключен — только качество); «что лучше» (позиция выше; та же позиция, качество выше, но не выше целевого; хуже — `null`);
  поиск по подписке: серия LostFilm (позиция 1) и вышла HDrezka (позиция 0) → загрузка с `note` «Улучшение: LostFilm → HDrezka», `wanted_state` не появился; импорт пишет `dubPosition`.
- [ ] **Step 2–4:** RED → GREEN; в «Активности» `note` показывается у качающейся замены. **Step 5: Commit** `feat(upgrade): замена на озвучку выше и целевое качество`.

---

### Task 6: Старая копия после улучшения

**Files:** Create `src/lib/old-copies.ts`; Modify `src/lib/downloads.ts` (импорт); Test `tests/unit/old-copies.test.ts`, `tests/unit/sync.test.ts`

**Interfaces — Produces:**
```ts
export const OLD_DIR = '.dublyarr-old';
export async function retireOldCopy(db, media: string, prev: EpisodeFile, reason: string, now: number): Promise<void>; // удалить или в скрытую папку + old_copies
export async function confirmOldCopies(db, media: string, deleteIds: number[]): Promise<{ deleted: number; freed: number }>; // удаляет отмеченные, ставит флаг правила
export function oldCopiesSummary(db): { count: number; size: number };
```
Импорт (`importEpisode`): если у серии уже есть файл — новый путь равен старому → сначала `retireOldCopy` (перенос), потом импорт; иначе импорт, потом `retireOldCopy`.
Удаление — только `path` внутри `{media}/.dublyarr-old` (`path.relative` без `..`), иначе ошибка и запись не трогается.

- [ ] **Step 1: Failing tests:** до подтверждения — перенос в скрытую папку и запись `old_copies`; подтверждение удаляет только отмеченные и ставит флаг; после флага — удаление сразу при импорте;
  тот же путь (Review Focus №2); `old_copies.path` с `..` — отказ (№1); импорт новой упал — старая на месте, `episode_files` прежний (№3).
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(retention): старая копия после улучшения`.

---

### Task 7: Страница старых копий и «Требует внимания»

**Files:** Create `src/app/(app)/old-copies/page.tsx`, `src/app/(app)/old-copies/actions.ts`, `src/app/(app)/old-copies/OldCopiesForm.tsx`; Modify `src/lib/dashboard.ts`, `src/app/(app)/page.tsx`; Test `tests/unit/dashboard.test.ts`

**Interfaces — Produces:** `todayData().attention` += «Старые копии после улучшения: N · X ГБ» (`href: '/old-copies'`), пока есть записи и правило не подтверждено.
Страница: список (сериал · серия · причина · размер), галочки (по умолчанию все), итог «Освободится X ГБ», «Удалить отмеченные» (action → `confirmOldCopies`), «Оставить все» (назад).

- [ ] **Step 1: Failing test:** пункт во «Требует внимания» с числом и размером; после подтверждения пункта нет. **Step 2–4:** RED → GREEN → страница. **Step 5: Commit** `feat(retention): подтверждение удаления старых копий`.

---

### Task 8: Новые сезоны и заметки

**Files:** Create `src/lib/seasons-watch.ts`, `src/lib/notices.ts`; Modify `src/lib/subscriptions.ts` (`maxSeason` при подписке, учёт в `wantedEpisodes`), `src/worker/handlers.ts` (после `syncTitle`), `src/lib/catalog.ts` (`openTitle` после синхронизации),
`src/lib/dashboard.ts`, `src/app/(app)/page.tsx`; Test `tests/unit/seasons-watch.test.ts`, `tests/unit/wanted.test.ts`

**Interfaces — Produces:**
```ts
export function extendSeasons(db, titleId: number, now?: number): 'extended' | 'noted' | 'none';
export function recentNotices(db, now?: number): { tmdbId: number; title: string; text: string; createdAt: number }[]; // за 3 дня
```
`wantedEpisodes(sub, …)` пропускает серии сезонов > `sub.maxSeason` (если не `null`). `subscribe` ставит `maxSeason` = последний сезон сериала.

- [ ] **Step 1: Failing tests:** новый сезон + флаг → `maxSeason` растёт, заметка «Подписался на 3-й сезон»; без флага → заметка «Вышел 3-й сезон — подписка его не включает», граница прежняя;
  повторный вызов — без второй заметки; без подписки — ничего (Review Focus №5); `wantedEpisodes` не берёт сезон за границей; заметки старше 3 дней не показываются.
- [ ] **Step 2–4:** RED → GREEN; блок «Новости» на «Сегодня». **Step 5: Commit** `feat(seasons): автоподписка на новые сезоны`.

---

### Task 9: E2E и документация

**Files:** Modify `tests/e2e/jackett-stub.mjs` (`POST /__add2160` — в выдаче появляется пак LostFilm 2160p с сидами); Create `tests/e2e/07-upgrade.spec.ts`; Modify `CLAUDE.md` («Решения (фаза 2b)»).

- [ ] **Step 1: Сценарий** (после 06: E1–E3 LostFilm 1080p): `/__air` для E1–E3 с датой «позавчера» → «Обновить из TMDB» → `/__add2160` → «Искать сейчас» → в «Активности» «Улучшение: 1080p → 2160p» →
  после синхронизации на «Сегодня» «Старые копии после улучшения» → страница → «Удалить отмеченные» → в медиатеке только файлы `[LostFilm 2160p]`, папка `.dublyarr-old` пуста.
- [ ] **Step 2:** `pnpm e2e` — 7 сценариев PASS. **Step 3:** `CLAUDE.md`. **Step 4:** всё зелёное. **Step 5: Commit** `test(e2e): замена на лучшее качество и старые копии; документация`.
