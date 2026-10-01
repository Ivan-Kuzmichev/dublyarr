# Фаза 2c «Расписание и уборка»: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** настраиваемая частота поиска с «чаще в день прогноза», расписание скорости 7×24 для торрентов Dublyarr, уборка в qBittorrent с подтверждением первого срабатывания.

**Architecture:** чистые решения — `src/lib/schedule.ts` (`searchDue`, `speedAt`, `speedSummary`, разбор настроек); применение скорости — `src/lib/speed.ts`;
уборка — `src/lib/cleanup.ts` (`cleanupPlan`, `runCleanup`); воркер — `subscriptions.tick` (5 мин), `cleanup.run` (1 ч), скорость — внутри `downloads.sync`;
экраны — `/settings/schedule`, блок в `/settings/download`, `/cleanup`.

**Tech Stack:** как раньше, без новых зависимостей.

**Spec:** `docs/superpowers/specs/2026-10-01-phase-2c-schedule-cleanup-design.md`; `docs/spec.md` §5, §7; макет `Settings.dc.html` (разделы «Расписание», «Загрузка»).

## Global Constraints

- Русский интерфейс; токены дизайна; цели ≥ 44 px; `requireSession()` и проверка входа во всех actions; все настройки из формы проверяются на сервере.
- Только торренты категории `dublyarr`; удаление файлов — только внутри `{downloads}/dublyarr` и только после подтверждения правила.
- Каждая задача — тест сначала, затем код, затем `pnpm test && pnpm typecheck && pnpm lint`.

## Review Focus

1. **Ночное окно через полночь** (23:00–06:00) и «только ночью» — поиск внутри окна, не вне его. Тест в Task 2.
2. **Файл нужен двум торрентам** (пак обновлён в ту же папку) — уборка старого не удаляет файл, который у нового. Тест в Task 5.
3. **Путь файла торрента вне `{downloads}/dublyarr`** (другой путь сохранения, `..`) — не удаляется. Тест в Task 5.
4. **Пользователь сам поставил загрузку на паузу, затем окно «пауза» закончилось** — его загрузка не запускается. Тест в Task 4.
5. **Уборка до подтверждения** — ничего не удалено и торрент не убран (если удаление файлов включено). Тест в Task 6.

---

### Task 1: Данные и клиент

**Files:** Modify `src/lib/db/schema.ts` (+ `drizzle/0008_*.sql`), `src/lib/qbit.ts`, `tests/unit/fake-qbit.ts`; Test `tests/unit/qbit.test.ts`, `tests/unit/schema-2c.test.ts`

**Interfaces — Produces:** `subscriptions.lastSearchedAt: number | null`; `downloads.pausedBySchedule: boolean` (default false); `QbitTorrent` += `ratio: number`, `completion_on: number` (сек, -1/0 — нет), `dl_limit: number`;
`Qbit.setDownloadLimit(hashes: string[], bytesPerSec: number): Promise<void>` (`POST /api/v2/torrents/setDownloadLimit`, `hashes` через `|`, `limit`).

- [ ] **Step 1: Failing tests:** колонки читаются; `setDownloadLimit` шлёт форму с `hashes=a|b&limit=1048576`. **Step 2–4:** RED → GREEN (фейковый клиент хранит `dl_limit`). **Step 5: Commit** `feat(db): расписание и уборка — данные`.

---

### Task 2: Настройки расписания и «пора ли искать»

**Files:** Create `src/lib/schedule.ts`; Test `tests/unit/schedule-settings.test.ts`

**Interfaces — Produces:**
```ts
export type SearchEvery = '15m' | '1h' | '2h' | '6h' | 'night';
export type ScheduleSettings = { every: SearchEvery; nightFrom: string; nightTo: string; eager: boolean; packChecks: boolean };
export type SpeedState = 'full' | 'limit' | 'pause';
export type SpeedSettings = { limitMb: number; grid: SpeedState[][] }; // 7 × 24, пн…вс
export const DEFAULT_SCHEDULE: ScheduleSettings; export const DEFAULT_SPEED: SpeedSettings;
export function getSchedule(db): ScheduleSettings; export function getSpeed(db): SpeedSettings;
export function parseScheduleForm(form: FormData): ScheduleSettings | { error: string };
export function parseSpeedForm(form: FormData): SpeedSettings | { error: string }; // grid — строка из 168 символов f/l/p
export function inNightWindow(now: Date, from: string, to: string): boolean;
export function searchDue(o: { lastSearchedAt: number | null; now: Date; settings: ScheduleSettings; eagerToday: boolean }): boolean;
export function speedAt(grid: SpeedState[][], now: Date): SpeedState;
export function speedSummary(s: SpeedSettings, now: Date): string; // «Сейчас: ограничено до 5 МБ/с · полная скорость с 00:00»
export function nextSearchAt(o: …): Date | null; // для подписи «следующая проверка в 20:00»
```

- [ ] **Step 1: Failing tests:** `searchDue` для каждой частоты; «только ночью» внутри/вне окна, окно через полночь (Review Focus №1), не чаще раза в час; `eagerToday` → 30 мин и вне окна; ни разу не искали — пора;
  `speedAt` (понедельник 00:00 — строка 0; воскресенье 23:00 — строка 6); `speedSummary` (полная / ограничено / пауза, следующее изменение, «весь день»); разбор форм (неверная частота, время «25:00», лимит 0 или > 1000, сетка не из 168 символов — ошибки).
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(schedule): настройки расписания и решение «пора искать»`.

---

### Task 3: Поиск по расписанию

**Files:** Modify `src/lib/autosearch.ts` (`searchAll` пишет `lastSearchedAt`; новая `searchDueTitles`), `src/worker/handlers.ts`, `src/worker/main.ts`; Test `tests/unit/autosearch.test.ts`

**Interfaces — Produces:** `export function dueTitles(db, now: Date, settings: ScheduleSettings): number[]` (по `searchDue`; `eagerToday` — есть `wanted_state = waiting`, прогноз которой сегодня или прошёл, см. `forecastEpisode`);
`export async function searchDue(db, deps, now): Promise<{ titles; started; errors }>`; задача `subscriptions.tick` раз в 5 мин; `subscriptions.search` («Искать сейчас») — все; `packs.check` планируется, только если `packChecks`.

- [ ] **Step 1: Failing tests:** две подписки — у одной поиск был 10 мин назад (1 ч) — не пора, у другой — 2 ч назад — пора; сериал с серией, ждущей озвучку с прогнозом на сегодня, — пора через 30 мин; после поиска `lastSearchedAt` записан.
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(schedule): поиск по расписанию и «чаще в день прогноза»`.

---

### Task 4: Расписание скорости

**Files:** Create `src/lib/speed.ts`; Modify `src/worker/handlers.ts` (`syncJob` вызывает `applySpeed`), `src/lib/activity.ts` («Пауза по расписанию»); Test `tests/unit/speed.test.ts`

**Interfaces — Produces:** `export async function applySpeed(db, qbit: Qbit, now: Date): Promise<SpeedState>`.

- [ ] **Step 1: Failing tests:** `limit` при двух качающихся — каждой `limitMb/2` МБ/с (байт/с); `full` — лимит 0; повтор без изменений не вызывает `setDownloadLimit`;
  `pause` останавливает качающиеся и ставит отметку; выход из `pause` запускает только отмеченные (загрузка на паузе вручную остаётся — Review Focus №4); «Активность» — «Пауза по расписанию».
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(schedule): расписание скорости для торрентов Dublyarr`.

---

### Task 5: План уборки

**Files:** Create `src/lib/cleanup.ts`; Test `tests/unit/cleanup.test.ts`

**Interfaces — Produces:**
```ts
export type CleanupSettings = { remove: 'import' | 'seeded' | 'never'; seedDays: number; seedRatio: number; deleteFiles: boolean; replaced: boolean; orphans: boolean };
export const DEFAULT_CLEANUP: CleanupSettings; export function getCleanup(db): CleanupSettings; export function parseCleanupForm(form: FormData): CleanupSettings | { error: string };
export type CleanupItem =
  | { kind: 'torrent'; key: string; downloadId: number; title: string; name: string; reason: string; files: string[]; size: number; inClient: boolean }
  | { kind: 'orphan'; key: string; path: string; size: number };
export async function cleanupPlan(db, qbit: Qbit, paths: Paths, settings: CleanupSettings, now: number): Promise<CleanupItem[]>;
```
`files` — абсолютные локальные пути внутри `{downloads}/dublyarr`, без файлов живых торрентов категории. `key` — `t:<downloadId>` / `o:<относительный путь>`.

- [ ] **Step 1: Failing tests:** `import` — импортированная в клиенте попадает сразу; `seeded` — по дням и по рейтингу, раньше — нет; `never` — нет; незавершённая — нет; заменённая — её файлы, кроме общих с новым торрентом (Review Focus №2);
  файл вне `{downloads}/dublyarr` не попадает (№3); брошенный файл старше суток — да, моложе — нет, файл живого торрента — нет; `replaced`/`orphans` выключены — не попадают.
- [ ] **Step 2–4:** RED → GREEN (реальная временная папка + фейковый qBittorrent). **Step 5: Commit** `feat(cleanup): план уборки`.

---

### Task 6: Выполнение уборки и подтверждение

**Files:** Modify `src/lib/cleanup.ts`; Modify `src/worker/handlers.ts`, `src/worker/main.ts` (`cleanup.run` раз в час); Test `tests/unit/cleanup.test.ts`

**Interfaces — Produces:**
```ts
export async function runCleanup(db, qbit, paths, settings, now, opts?: { confirmKeys?: string[] }): Promise<{ removed: number; deletedFiles: number; freed: number; pending: number }>;
export function cleanupConfirmed(db): { files: boolean; orphans: boolean };
export async function pendingCleanup(db, qbit, paths, now): Promise<CleanupItem[]>; // то, что ждёт подтверждения
```
Без `confirmKeys`: торрент с удалением файлов и неподтверждённым правилом — не трогается (`pending++`); `deleteFiles` выключено — торрент убирается сразу; брошенные — только при подтверждённом `orphans`.
С `confirmKeys` (страница): выполняются отмеченные, ставятся флаги правил, к которым они относятся.

- [ ] **Step 1: Failing tests:** до подтверждения — ничего не удалено, торрент в клиенте, `pending` > 0 (Review Focus №5); с `confirmKeys` — торрент убран (`deleteFiles=false` у клиента), файлы удалены, пустые папки убраны, запись `removed` + `note`, флаг подтверждения;
  после подтверждения — следующий прогон сам; `deleteFiles` выключено — торрент убран без подтверждения, файлы на месте; брошенные — до/после подтверждения.
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(cleanup): уборка с подтверждением первого срабатывания`.

---

### Task 7: «Настройки → Расписание»

**Files:** Create `src/app/(app)/settings/schedule/page.tsx`, `actions.ts`, `ScheduleForm.tsx`, `SpeedGrid.tsx`; Modify `src/app/(app)/settings/SettingsNav.tsx` (если нужно); Test `tests/unit/schedule-settings.test.ts` (разбор форм уже в Task 2)

- [ ] **Step 1:** страница по макету: частота (сегменты), ночное окно, переключатели «Чаще, когда ждём серию» (+ «сейчас так ждут N сериалов»), «Проверять обновления паков чаще», подпись «следующая проверка в HH:MM»;
  сетка 7×24: кисть «Полная / Ограничено / Пауза», проведение мышью (pointer events) и нажатие, лимит — степпер 1…1000 МБ/с, подпись `speedSummary`. Сохранение — server actions (`parseScheduleForm`, `parseSpeedForm`).
- [ ] **Step 2:** скриншоты desktop + 390 px против `Settings.dc.html`. **Step 3:** всё зелёное. **Step 4: Commit** `feat(settings): расписание поиска и скорости`.

---

### Task 8: Уборка: настройки, «Требует внимания», страница `/cleanup`

**Files:** Modify `src/app/(app)/settings/download/page.tsx` (+ `CleanupCard.tsx`, action), `src/lib/dashboard.ts`, `src/app/(app)/page.tsx`; Create `src/app/(app)/cleanup/page.tsx`, `actions.ts`, `CleanupForm.tsx`; Test `tests/unit/dashboard.test.ts`

**Interfaces — Produces:** `todayData` получает `cleanupPending?: { count: number; size: number }` (считает воркер: `app_settings['cleanup.pending']` после каждого `cleanup.run`) → пункт «Уборка загрузок: N · X ГБ — подтвердите» (`href: '/cleanup'`).

- [ ] **Step 1: Failing test:** пункт в «Требует внимания» по сохранённой сводке; нет сводки или 0 — нет пункта.
- [ ] **Step 2–4:** RED → GREEN → блок настроек по макету (сегменты «сразу после импорта / после раздачи / никогда», степперы дней и рейтинга, три переключателя), страница `/cleanup` (как `/old-copies`: строки, галочки, «Освободится», «Удалить отмеченные», «Не сейчас»). **Step 5: Commit** `feat(cleanup): настройки уборки и подтверждение`.

---

### Task 9: E2E и документация

**Files:** Modify `tests/e2e/qbit-stub.mjs` (`ratio`, `completion_on`, `dl_limit`, `setDownloadLimit`); Create `tests/e2e/08-cleanup.spec.ts`; Modify `CLAUDE.md` («Решения (фаза 2c)»).

- [ ] **Step 1: Сценарий** (после 07): «Загрузка и папки» → уборка «сразу после импорта» → «Сохранить» → «Требует внимания» «Уборка загрузок» (воркер — ждать прогона; для e2e задача `cleanup.run` ставится в очередь при сохранении настроек) → `/cleanup` → «Удалить отмеченные» →
  в заглушке qBittorrent нет торрентов с импортированными сериями, в `E2E_DIR/qbit/dublyarr` нет их файлов, в медиатеке файлы на месте.
- [ ] **Step 2:** `pnpm e2e` — 8 сценариев PASS. **Step 3:** `CLAUDE.md`. **Step 4:** всё зелёное. **Step 5: Commit** `test(e2e): уборка загрузок; документация`.
