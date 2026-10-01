# Фаза 2d «Telegram»: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** уведомления в Telegram по событиям spec §12 через очередь, ответы на вопросы «тот ли сериал» кнопками, привязка чата кодом, экран настроек.

**Architecture:** клиент Bot API — `src/lib/telegram.ts` (fetch, прокси через `proxiedFetch`, маскировка токена); очередь и события — `src/lib/notify.ts`;
ответы и привязка — `src/lib/telegram-updates.ts`; воркер — `telegram.send` и `telegram.poll` (15 с); экран — `/settings/notifications`.

**Tech Stack:** как раньше, без новых зависимостей. Env `TELEGRAM_API_BASE` (по умолчанию `https://api.telegram.org`) — для заглушки в e2e.

**Spec:** `docs/superpowers/specs/2026-10-01-phase-2d-telegram-design.md`; `docs/spec.md` §12; макет `Settings.dc.html` («Уведомления»).

## Global Constraints

- Токен — только зашифрованным в `app_settings['telegram']`; в логах и текстах ошибок — `bot***` вместо токена.
- Принимаются только сообщения и нажатия из привязанного чата.
- Из Telegram ничего не удаляется (только кнопки-ссылки на страницы подтверждения).
- Русский интерфейс; `requireSession()` во всех actions; каждая задача — тест сначала.

## Review Focus

1. **Токен в ошибке сети** (fetch бросает с адресом запроса) — в логах и в ответе «Проверить» нет токена. Тест в Task 2.
2. **Нажатие кнопки из чужого чата** (бот публичный) — игнорируется, правило не меняется. Тест в Task 5.
3. **Одно событие дважды** (повторная синхронизация, тот же импорт) — одно сообщение. Тест в Task 3.
4. **Telegram недоступен сутки** — очередь не растёт бесконечно, старые помечаются «не доставлено», новые отправляются после восстановления. Тест в Task 3.
5. **Ответ на вопрос, уже решённый на сайте** — «Уже решено», правило не перезаписывается. Тест в Task 5.

---

### Task 1: Данные

**Files:** Modify `src/lib/db/schema.ts` (+ `drizzle/0009_*.sql`); Test `tests/unit/schema-2d.test.ts`

**Interfaces — Produces:** таблица `notifications` (спецификация §2); `wantedState.releaseId: number | null` (FK releases, set null); `sources.failingSince: number | null`, `sources.downNotified: boolean`.

- [ ] **Step 1: Failing test:** вставка уведомления, уникальность `key`; новые колонки. **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(db): уведомления`.

---

### Task 2: Клиент Telegram Bot API

**Files:** Create `src/lib/telegram.ts`; Test `tests/unit/telegram.test.ts`

**Interfaces — Produces:**
```ts
export type TelegramSettings = { token: string; chatId?: string; proxy?: string; baseUrl?: string };
export class TelegramError extends Error { code: 'network' | 'auth' | 'blocked' | 'rate' | 'http'; retryAfter?: number }
export type InlineButton = { text: string; data?: string; url?: string };
export function createTelegram(s: Pick<TelegramSettings, 'token' | 'proxy'>, opts?: { fetchImpl?: typeof fetch; base?: string }): {
  getMe(): Promise<{ username: string }>;
  sendMessage(chatId: string, text: string, buttons?: InlineButton[][]): Promise<{ messageId: number }>;
  editMessage(chatId: string, messageId: number, text: string): Promise<void>; // текст, кнопки убираются
  answerCallback(id: string, text: string): Promise<void>;
  getUpdates(offset: number): Promise<TgUpdate[]>; // timeout=0
};
export const getTelegramSettings: (db) => TelegramSettings | undefined; export const saveTelegramSettings: (db, s) => void;
export const maskToken: (text: string) => string; // /bot<что угодно>/ → /bot***/
```
Ошибки: 401 → `auth` («Неверный токен бота»), 403 → `blocked` («Бот заблокирован в чате»), 429 → `rate` с `retryAfter`, сеть → `network` («Telegram недоступен — проверьте прокси»).

- [ ] **Step 1: Failing tests:** `sendMessage` шлёт JSON с `chat_id`, `text`, `reply_markup.inline_keyboard` (`callback_data`/`url`); `getUpdates` с `offset`; коды ошибок; ошибка сети с токеном в адресе — в сообщении `bot***` (Review Focus №1); `maskToken`.
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(telegram): клиент Bot API`.

---

### Task 3: Очередь уведомлений

**Files:** Create `src/lib/notify.ts`; Modify `src/worker/handlers.ts`, `src/worker/main.ts`; Test `tests/unit/notify.test.ts`

**Interfaces — Produces:**
```ts
export type NotifyKind = 'downloaded' | 'stuck' | 'ask' | 'original' | 'source-down';
export const DEFAULT_EVENTS: Record<NotifyKind, boolean>;
export function getEvents(db): Record<NotifyKind, boolean>;
export function notify(db, n: { key: string; kind: NotifyKind; text: string; buttons?: InlineButton[][]; ref?: Record<string, unknown> }, now?: number): boolean; // false — выключено или уже было
export async function sendPending(db, tg: ReturnType<typeof createTelegram>, chatId: string, now?: number): Promise<{ sent: number; failed: number }>;
```

- [ ] **Step 1: Failing tests:** выключенное событие не пишется; тот же `key` — одна запись (Review Focus №3); отправка — `sent_at`, `message_id`; ошибка — `attempts`, `next_at` растёт, раньше `next_at` не шлётся; старше суток — «не доставлено» (№4);
  `rate` — `next_at = now + retryAfter`; `blocked` — без повторов.
- [ ] **Step 2–4:** RED → GREEN; воркер `telegram.send` раз в 15 с. **Step 5: Commit** `feat(telegram): очередь уведомлений`.

---

### Task 4: События

**Files:** Modify `src/lib/downloads.ts` (импорт, `stalled`, `removed`), `src/lib/autosearch.ts` (`ask` с `releaseId`, `waiting`), `src/lib/notices.ts`, `src/lib/search.ts` (`failingSince`), `src/lib/old-copies.ts`, `src/lib/cleanup.ts`; Create `src/lib/notify-texts.ts`; Test `tests/unit/notify-events.test.ts`

**Interfaces — Produces:** тексты событий (`notify-texts.ts`, чистые функции) и вызовы `notify` в местах событий; `checkSourcesDown(db, now)` в `search.ts`/воркере — «не отвечает > 1 ч» один раз, «снова отвечает» после.

- [ ] **Step 1: Failing tests:** импорт → одно «📥 …» (несколько серий — диапазон; улучшение — «Улучшено: …»); первое `stalled` → «⏳»; исчез из клиента → «⚠️»; `wanted_state` впервые `ask` → «❓» с кнопками и `ref` (`releaseId`, `titleId`); впервые `waiting` → «🕐» (выключено по умолчанию — проверить при включении);
  источник не отвечает 61 мин → «🔌» один раз, восстановился → «✅»; заметка нового сезона → сообщение; сводка старых копий / уборки → сообщение со ссылкой при заданном адресе.
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(telegram): события`.

---

### Task 5: Ответы кнопками и привязка

**Files:** Create `src/lib/telegram-updates.ts`; Modify `src/worker/handlers.ts`, `src/worker/main.ts`; Test `tests/unit/telegram-updates.test.ts`

**Interfaces — Produces:**
```ts
export function startPairing(db, now?: number): string; // 6 цифр, 10 мин
export async function pollUpdates(db, tg, now?: number): Promise<{ handled: number }>; // offset в app_settings['telegram.offset']
```
Нажатие: `m:<id>` / `r:<id>` → `addRule(titleId, trackerName, title, 'match' | 'reject')` по раздаче из `ref`, `enqueue('subscriptions.search')`, `answerCallback`, `editMessage`.

- [ ] **Step 1: Failing tests:** код привязки — `chatId` сохранён, ответ боту; неверный и просроченный код — нет; нажатие «Не тот сериал» — правило `reject`, сообщение исправлено; из чужого чата — игнор (Review Focus №2);
  правило уже есть — «Уже решено», правило прежнее (№5); `offset` растёт.
- [ ] **Step 2–4:** RED → GREEN; воркер `telegram.poll` раз в 15 с. **Step 5: Commit** `feat(telegram): ответы кнопками и привязка чата`.

---

### Task 6: «Настройки → Уведомления»

**Files:** Create `src/app/(app)/settings/notifications/page.tsx`, `actions.ts`, `TelegramCard.tsx`, `EventsCard.tsx`; Test `tests/unit/notify.test.ts` (разбор формы событий)

- [ ] **Step 1:** карточка бота (токен, «Проверить», прокси — подсказка «по умолчанию прокси TMDB», адрес Dublyarr, Chat ID, «Привязать чат» с кодом и статусом, «Отправить тестовое»), карточка событий (5 переключателей), последние 10 уведомлений.
  Actions: сохранение (токен пустой — прежний), проверка (`getMe`), привязка (`startPairing`), тестовое (сразу `sendMessage`, ошибка — текстом).
- [ ] **Step 2:** скриншоты desktop + 390 px против макета. **Step 3:** всё зелёное. **Step 4: Commit** `feat(settings): уведомления в Telegram`.

---

### Task 7: E2E и документация

**Files:** Create `tests/e2e/telegram-stub.mjs` (порт 3196: `getMe`, `sendMessage`, `editMessageText`, `answerCallbackQuery`, `getUpdates`; `POST /__push` — добавить входящее обновление, `GET /__sent` — отправленные), `tests/e2e/09-telegram.spec.ts`;
Modify `playwright.config.ts` (`TELEGRAM_API_BASE`), `CLAUDE.md` («Решения (фаза 2d)»), `README.md` (Telegram и прокси).

- [ ] **Step 1: Сценарий:** «Уведомления» → токен → «Проверить» → «@dublyarr_test_bot» → «Привязать чат» → код → `/__push` сообщение с кодом → «Чат привязан» → «Отправить тестовое» → в `/__sent` тестовое сообщение →
  `/__push` нажатие по уведомлению-вопросу (заранее — уведомление `ask` через раздачу BDRip 720p ручного поиска, или созданное тестом через страницу) → правило в ручном поиске «В чёрном списке».
- [ ] **Step 2:** `pnpm e2e` — 9 сценариев PASS. **Step 3:** документация. **Step 4:** всё зелёное. **Step 5: Commit** `test(e2e): Telegram; документация`.
