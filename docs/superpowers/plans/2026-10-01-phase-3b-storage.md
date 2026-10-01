# Фаза 3b «Хранение»: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** правила хранения с подтверждением первого срабатывания, защита от переполнения, экран «Хранилище», удаление сериала.

**Architecture:** правила и уборка — `src/lib/retention.ts` (`retentionPlan`, `runRetention`, `retentionDue`); диск — `src/lib/storage.ts` (`diskUsage`, `checkDisk`, `storageData`);
удаление сериала — `src/lib/delete-series.ts`; старые копии (2b) переходят на режимы правила; воркер — `retention.run`; экраны — `/storage`, `/settings/storage`, карточка.

**Tech Stack:** как раньше; `fs.statfs` (Node 24).

**Spec:** `docs/superpowers/specs/2026-10-01-phase-3b-storage-design.md`; `docs/spec.md` §8; макеты `Storage.dc.html`, `MobileStorage.dc.html`, `Settings.dc.html` («Хранение»).

## Global Constraints

- Удаляются только файлы, записанные в `episode_files`/`old_copies` (и файлы торрентов Dublyarr внутри `{downloads}/dublyarr` при удалении сериала); путь проверяется на выход за пределы.
- Новое правило ничего не удаляет до подтверждения; неотмеченное — «не удалять».
- Русский интерфейс; `requireSession()`; каждая задача — тест сначала.

## Review Focus

1. **Сериал, у которого в TMDB нет «выходящего» сезона и он не завершён** (перерыв между сезонами) — последний сезон не удаляется. Тест в Task 2.
2. **Выходящий сезон скачан не в первой озвучке** (взяли запасную) — старые сезоны ещё не удаляются. Тест в Task 2.
3. **Путь `episode_files.path` с `..` или абсолютный** — уборка и удаление сериала отказывают для этого файла. Тест в Task 3 и Task 5.
4. **Диск 98 %, пользователь вручную продолжил загрузку** — следующая минута снова ставит паузу; после освобождения места запускаются только поставленные на паузу Dublyarr. Тест в Task 4.
5. **Удаление сериала, чей пак-торрент делит файлы с другим живым торрентом** — общие файлы остаются. Тест в Task 5.

---

### Task 1: Данные и настройки

**Files:** Modify `src/lib/db/schema.ts` (+ `drizzle/0011_*.sql`); Create `src/lib/retention-settings.ts`; Test `tests/unit/retention-settings.test.ts`

**Interfaces — Produces:** `subscriptions.keepAll: boolean`, `subscriptions.autoDelete: boolean`; таблица `deletions` (`id`, `titleId` FK set null, `label`, `why`, `size`, `at`);
```ts
export type RetentionSettings = { seasons: { on: boolean; keep: number; ended: 'keep' | 'clean' }; oldCopy: 'now' | '3days' | 'cleanup'; age: { days: number }; overflow: { on: boolean; warn: number; pause: number }; schedule: 'daily' | 'weekly' | 'manual' };
export const DEFAULT_RETENTION: RetentionSettings; export function getRetention(db): RetentionSettings; export function parseRetentionForm(form: FormData): RetentionSettings | { error: string };
export function retentionDue(schedule: RetentionSettings['schedule'], lastRun: number | null, now: Date): boolean; // 04:00, неделя — воскресенье
export function nextRetentionAt(schedule, lastRun, now: Date): Date | null;
```
- [ ] **Step 1: Failing tests:** колонки и таблица; разбор формы (пределы: keep 1–10, days 1–365, warn 50–99, pause > warn ≤ 99); `retentionDue` (до 04:00 — нет, после — да, второй раз за день — нет; неделя — только в воскресенье; `manual` — никогда); `nextRetentionAt`.
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(retention): данные и настройки`.

---

### Task 2: План правил

**Files:** Create `src/lib/retention.ts`; Test `tests/unit/retention.test.ts`

**Interfaces — Produces:**
```ts
export type RetentionRule = 'seasons' | 'oldCopy' | 'age';
export type RetentionItem = { key: string; rule: RetentionRule; titleId: number; label: string; why: string; files: { episodeFileId?: number; oldCopyId?: number; path: string; size: number }[]; size: number };
export function retentionPlan(db, settings: RetentionSettings, now: number, today: string): RetentionItem[];
export function seasonRule(db, titleId: number, settings: RetentionSettings, today: string): { label: string; drop: number[] }; // подпись правила для «Хранилища» и сезоны к удалению
```
- [ ] **Step 1: Failing tests:** сезоны: S1–S4 вышли, S5 выходит и скачан целиком в первой озвучке, keep 1 → удалить S1–S3, подпись «S04 + выходящий»; S5 скачан не весь — ничего; S5 в запасной озвучке — ничего (Review Focus №2);
  перерыв (выходящего нет, не завершён) — последний не трогается (№1); завершённый: `keep` — ничего, `clean` — оставить последний; `keep_all` — ничего, подпись «исключение: все»; правило выключено — ничего;
  старая копия: `3days` — моложе 3 дней нет, старше есть; `cleanup` — есть; `now` — нет (удаляется сразу при импорте); N дней: `auto_delete` и старше 30 дней — да.
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(retention): план правил хранения`.

---

### Task 3: Выполнение уборки, подтверждение, история

**Files:** Modify `src/lib/retention.ts`, `src/lib/old-copies.ts` (режимы `oldCopy`; страница `/old-copies` — через `runRetention`), `src/worker/handlers.ts`, `src/worker/main.ts`; Test `tests/unit/retention.test.ts`, `tests/unit/old-copies.test.ts`

**Interfaces — Produces:**
```ts
export async function runRetention(db, media: string, settings: RetentionSettings, now: number, opts?: { confirmKeys?: string[] }): Promise<{ deleted: number; freed: number; pending: number }>;
export function retentionConfirmed(db): Record<RetentionRule, boolean>;
export async function deleteMediaFile(media: string, rel: string): Promise<boolean>; // только внутри медиатеки; опустевшие папки — тоже
```
Воркер: `retention.tick` раз в 5 мин → если `retentionDue` — `runRetention`; сводка → `retention.pending` + `notifyPendingConfirm`.

- [ ] **Step 1: Failing tests:** неподтверждённое — ничего не удалено, `pending`; `confirmKeys` — удалены отмеченные, правило подтверждено, неотмеченные не удаляются потом; путь с `..` — отказ (Review Focus №3); пустые папки сезона убраны; `deletions` записаны;
  старая копия `now` после подтверждения — удаляется сразу при импорте (как в 2b), `3days` — остаётся в скрытой папке до уборки.
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(retention): уборка медиатеки с подтверждением`.

---

### Task 4: Диск и защита от переполнения

**Files:** Create `src/lib/storage.ts`; Modify `src/lib/speed.ts` (пауза при переполнении), `src/worker/handlers.ts`, `src/lib/activity.ts`, `src/lib/dashboard.ts`; Test `tests/unit/storage.test.ts`

**Interfaces — Produces:**
```ts
export type Disk = { total: number; free: number; used: number; pct: number };
export async function diskUsage(media: string, statfs?: typeof import('node:fs/promises').statfs): Promise<Disk | null>;
export function checkDisk(db, disk: Disk | null, settings: RetentionSettings, now: number): 'ok' | 'warn' | 'pause';
```
`applySpeed`: `app_settings['storage.paused']` → состояние `pause` независимо от сетки. «Активность»: «Пауза: мало места».

- [ ] **Step 1: Failing tests:** 91 % — `warn`, уведомление один раз в сутки, пункт «Требует внимания»; 98 % — пауза Dublyarr-загрузок; ручное «Продолжить» при 98 % — следующая минута снова пауза; 80 % — снимается, запускаются только отмеченные (Review Focus №4); `overflow.on = false` — ничего.
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(storage): защита от переполнения`.

---

### Task 5: Удаление сериала

**Files:** Create `src/lib/delete-series.ts`; Modify `src/lib/cleanup.ts` (вынести удаление файлов торрента с защитой общих файлов в общую функцию); Test `tests/unit/delete-series.test.ts`

**Interfaces — Produces:** `export async function deleteSeries(db, deps: { qbit: Qbit | null; paths: Paths }, titleId: number, mode: 'all' | 'files' | 'sub', now?: number): Promise<{ files: number; freed: number; torrents: number }>`.

- [ ] **Step 1: Failing tests:** `files` — файлы медиатеки и старые копии удалены, записи убраны, торренты убраны клиентом без файлов и их файлы удалены, подписка на месте, `deletions`; `sub` — только отписка; `all` — всё;
  общий с другим живым торрентом файл остаётся (Review Focus №5); путь вне медиатеки — не удалён (№3); без qBittorrent — медиатека удаляется, торренты — нет.
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(storage): удаление сериала`.

---

### Task 6: Данные «Хранилища»

**Files:** Modify `src/lib/storage.ts`; Test `tests/unit/storage.test.ts`

**Interfaces — Produces:**
```ts
export function storageData(db, disk: Disk | null, settings: RetentionSettings, now: number, today: string): {
  disk: Disk | null; segments: { name: string; size: number; pct: number }[];
  shows: { tmdbId: number; title: string; posterPath: string | null; seasons: string; quality: string; size: number; rule: string; keepPct: number; dropPct: number; lastAt: number }[];
  pending: RetentionItem[]; pendingRule: RetentionRule | null; forecast: { perWeek: number; weeksLeft: number | null; weeksAfter: number | null }; history: { label: string; why: string; size: number; at: number }[];
};
```
- [ ] **Step 1: Failing tests:** сегменты (сериалы/аниме/Не Dublyarr/свободно); строка сериала («S01–S09», «2160p», подпись правила, доли «останется/уйдёт»); прогноз по последнему месяцу; история.
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(storage): данные хранилища`.

---

### Task 7: Экран «Хранилище», диалог удаления, карточка

**Files:** Create `src/app/(app)/storage/page.tsx` (заменить заглушку), `actions.ts`, `DeleteSeriesDialog.tsx`, `FirstCleanup.tsx`; Modify `src/app/(app)/series/[tmdbId]/page.tsx` (+ `RetentionToggles.tsx`, кнопка «Удалить…»).

- [ ] **Step 1:** «Хранилище» по макетам (desktop + 390 px), сортировка, панель первой уборки (action → `runRetention` с `confirmKeys`), «Прогноз», «Недавно удалено»; диалог удаления (три варианта, action → `deleteSeries`); карточка — переключатели исключений (action → подписка).
- [ ] **Step 2:** скриншоты против макетов. **Step 3:** всё зелёное. **Step 4: Commit** `feat(storage): экран хранилища и удаление сериала`.

---

### Task 8: «Настройки → Хранение»

**Files:** Create `src/app/(app)/settings/storage/page.tsx`, `actions.ts`, `RetentionForm.tsx`

- [ ] **Step 1:** по макету: «Уборка» (частота, «Следующая: вс, 4 октября, 04:00 · освободит X», «Запустить сейчас» → задача `retention.run`), карточки правил (сезоны: вкл., keep, завершённые; старая копия: три режима; N дней; переполнение: два порога, «Сейчас занято N %»), «Открыть хранилище».
- [ ] **Step 2:** скриншоты. **Step 3:** всё зелёное. **Step 4: Commit** `feat(settings): правила хранения`.

---

### Task 9: E2E и документация

**Files:** Create `tests/e2e/10-storage.spec.ts`; Modify `CLAUDE.md` («Решения (фаза 3b)»).

- [ ] **Step 1: Сценарий:** «Хранилище» → строка «Игра престолов» → корзина → «Только файлы, подписка остаётся» → «Удалить файлы» → в `E2E_DIR/media/Игра престолов (2011)` нет файлов, карточка — «Подписка активна», «Недавно удалено» — запись.
- [ ] **Step 2:** `pnpm e2e` — 10 сценариев PASS. **Step 3:** `CLAUDE.md`. **Step 4:** всё зелёное. **Step 5: Commit** `test(e2e): хранилище; документация`.
