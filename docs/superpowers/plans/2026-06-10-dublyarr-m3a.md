# Dublyarr M3a — движок автоматики (воркер + конвейер) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Воркер-процесс с cron-тиком автоматически находит недостающие раздачи в нужной озвучке/качестве, скачивает их через qBittorrent и импортирует в библиотеку; пользователь может запустить поиск вручную кнопкой «Искать сейчас».

**Architecture:** Чистая логика (скоринг, выбор кандидатов, конвейер, поллинг, grab) живёт в `packages/core` с инъекцией клиентов Jackett/qBittorrent и часов — тестируется юнитами без сети. Новый процесс `apps/worker` на cron-тике дёргает `tick()` и `pollAll()` из core. API-роуты Next.js и воркер используют один и тот же core-код (DRY): logic grab/poll вынесена из существующего роута `/api/downloads` в core. Новые таблицы `history` (аудит) и `blacklist` (битые раздачи).

**Tech Stack:** Node + TypeScript, Drizzle ORM + better-sqlite3, pino (логи воркера), tsx (запуск воркера), Vitest. Next.js 15 для API/UI.

---

## Контекст для исполнителя

- Монорепо npm workspaces: `packages/core` (`@dublyarr/core`, exports — сырые `.ts`), `apps/web` (Next.js 15), новый `apps/worker`. Корневой `package.json` уже включает `apps/*` и `packages/*` в workspaces.
- Внутри core импорты между файлами пишутся с расширением `.js` (резолвится в `.ts`).
- Ожидаемые отказы — result-объекты или просто запись в history; точные русские строки — контракт UI.
- SQLite в WAL (`openDb` ставит pragma WAL + foreign_keys=ON), безопасен для двух процессов (web + worker).
- Готово из M2b: `@dublyarr/core/qbittorrent` (`QbtClient`, `QbtError`, `qbtStateToStatus`), `@dublyarr/core/import` (`importDownload`), `@dublyarr/core/naming` (`DEFAULT_NAMING_TV/MOVIE`), `@dublyarr/core/parser` (`parseRelease`, `ParsedRelease`, тип `JackettRelease` из `@dublyarr/core/jackett`), `@dublyarr/core/quality` (`qualityKeyFor`, `qualityRank`, `qualityLabel`), db-модули `titles`/`episodes`/`downloads`/`files`/`presets`/`settings`.
- `JackettRelease` (из `packages/core/src/jackett.ts`) содержит `guid`, `link`, `title`, `description`, `indexer`, `seeders`, `size`. `searchJackett({url, apiKey}, query)` возвращает `JackettRelease[]`.
- `parseRelease(r)` даёт `r.parsed`: `voiceovers: {kind, studios[]}[]`, `quality: {source, resolution}`, `seasons: number[]`, `episodes`.
- `Title` (db) поля: `id, type ("movie"|"tv"), titleRu, titleOriginal, year, qualityPresetId, voiceover ("any"|studio), monitorRule, tracked`. `Episode`: `id, titleId, season, episode, airDate, wanted (boolean), fileId (number|null)`.
- `QualityPreset`: `id, name, allowed: string[], preferred: string, upgradeEnabled: boolean` (через `getPreset(db, id)`).
- Команды: `npm test -w @dublyarr/core`, `npm run typecheck`, `npm run test:e2e -w @dublyarr/web`.
- **DRY-рефактор (Задачи 6–7):** логика grab (createDownload + qbt.addTorrent + резолв hash по тегу) и poll/refresh/import (сейчас в `apps/web/app/api/downloads/route.ts`) выносится в core, чтобы воркер и web использовали одно и то же. Существующее e2e не должно сломаться.

---

### Task 1: Миграция 0003 — таблицы history и blacklist

**Files:**
- Modify: `packages/core/src/db/migrations.ts`
- Modify: `packages/core/src/db/schema.ts`
- Test: `packages/core/test/db.test.ts`

- [ ] **Step 1: Написать падающий тест**

Дописать в конец `packages/core/test/db.test.ts` новый describe со своей temp-БД (по образцу describe «миграция 0002» — свои префиксованные имена + afterAll cleanup):

```ts
describe("миграция 0003: history и blacklist", () => {
  const m3dir = mkdtempSync(join(tmpdir(), "dublyarr-m3-"));
  const { sqlite: m3sqlite } = openDb(join(m3dir, "m3.db"));

  afterAll(() => {
    m3sqlite.close();
    rmSync(m3dir, { recursive: true, force: true });
  });

  test("таблицы созданы", () => {
    const names = (
      m3sqlite
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('history','blacklist')`,
        )
        .all() as { name: string }[]
    ).map((r) => r.name);
    expect(names.sort()).toEqual(["blacklist", "history"]);
  });

  test("history.title_id → SET NULL при удалении тайтла", () => {
    m3sqlite
      .prepare(
        `INSERT INTO titles (tmdb_id, type, title_ru, title_original, quality_preset_id)
         VALUES (1, 'movie', 'Т', 'T', 1)`,
      )
      .run();
    const t = m3sqlite.prepare(`SELECT id FROM titles WHERE tmdb_id = 1`).get() as { id: number };
    m3sqlite
      .prepare(`INSERT INTO history (title_id, kind, message) VALUES (?, 'search', 'x')`)
      .run(t.id);
    m3sqlite.prepare(`DELETE FROM titles WHERE id = ?`).run(t.id);
    const row = m3sqlite.prepare(`SELECT title_id FROM history`).get() as { title_id: number | null };
    expect(row.title_id).toBeNull();
  });

  test("blacklist уникален по (title_id, release_guid)", () => {
    m3sqlite
      .prepare(
        `INSERT INTO titles (tmdb_id, type, title_ru, title_original, quality_preset_id)
         VALUES (2, 'tv', 'Т2', 'T2', 1)`,
      )
      .run();
    const t = m3sqlite.prepare(`SELECT id FROM titles WHERE tmdb_id = 2`).get() as { id: number };
    m3sqlite
      .prepare(`INSERT INTO blacklist (title_id, release_guid, reason) VALUES (?, 'g1', 'r')`)
      .run(t.id);
    expect(() =>
      m3sqlite
        .prepare(`INSERT INTO blacklist (title_id, release_guid, reason) VALUES (?, 'g1', 'r2')`)
        .run(t.id),
    ).toThrow();
  });
});
```

Если `afterAll`/`rmSync` ещё не импортированы в файле — добавь их.

- [ ] **Step 2: Прогнать тест — убедиться, что падает**

Run: `npm test -w @dublyarr/core -- db`
Expected: FAIL — таблиц нет.

- [ ] **Step 3: Добавить миграцию**

В `packages/core/src/db/migrations.ts` добавить элемент в конец массива `migrations`:

```ts
  {
    id: "0003_history_blacklist",
    sql: `CREATE TABLE history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title_id INTEGER REFERENCES titles(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX history_created_idx ON history (created_at);
    CREATE TABLE blacklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
      release_guid TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (title_id, release_guid)
    );`,
  },
```

- [ ] **Step 4: Добавить drizzle-схему**

В `packages/core/src/db/schema.ts` дописать в конец файла (импорт `index`/`uniqueIndex` уже есть; если `index` не импортирован — добавь его в импорт из `drizzle-orm/sqlite-core`):

```ts
export const history = sqliteTable(
  "history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    titleId: integer("title_id").references(() => titles.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    message: text("message").notNull().default(""),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [index("history_created_idx").on(t.createdAt)],
);

export const blacklist = sqliteTable(
  "blacklist",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    titleId: integer("title_id")
      .notNull()
      .references(() => titles.id, { onDelete: "cascade" }),
    releaseGuid: text("release_guid").notNull(),
    reason: text("reason").notNull().default(""),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [uniqueIndex("blacklist_unique").on(t.titleId, t.releaseGuid)],
);
```

- [ ] **Step 5: Прогнать тесты**

Run: `npm test -w @dublyarr/core -- db`
Expected: PASS (все тесты файла).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/db/migrations.ts packages/core/src/db/schema.ts packages/core/test/db.test.ts
git commit -m "feat(core): миграция 0003 — таблицы history и blacklist"
```

---

### Task 2: Ключи настроек мониторинга

**Files:**
- Modify: `packages/core/src/db/settings.ts`
- Test: `packages/core/test/db.test.ts`

- [ ] **Step 1: Написать падающий тест**

Дописать в `packages/core/test/db.test.ts` новый describe со своей temp-БД:

```ts
describe("ключи настроек мониторинга", () => {
  const monDir = mkdtempSync(join(tmpdir(), "dublyarr-mon-"));
  const { db: monDb, sqlite: monSqlite } = openDb(join(monDir, "mon.db"));

  afterAll(() => {
    monSqlite.close();
    rmSync(monDir, { recursive: true, force: true });
  });

  test("getAllSettings отдаёт ключи мониторинга", () => {
    const all = getAllSettings(monDb);
    for (const k of ["monitor_interval_min", "monitor_min_seeders", "monitor_stall_hours"]) {
      expect(all).toHaveProperty(k, null);
    }
  });
});
```

- [ ] **Step 2: Прогнать тест — убедиться, что падает**

Run: `npm test -w @dublyarr/core -- db`
Expected: FAIL.

- [ ] **Step 3: Расширить SETTING_KEYS**

В `packages/core/src/db/settings.ts` добавить три ключа в конец массива `SETTING_KEYS`:

```ts
  "monitor_interval_min",
  "monitor_min_seeders",
  "monitor_stall_hours",
```

Затем дописать в конец файла дефолты и типизированный геттер чисел:

```ts
export const MONITOR_DEFAULTS = {
  monitor_interval_min: 15,
  monitor_min_seeders: 1,
  monitor_stall_hours: 6,
} as const;

/** Число из настроек с дефолтом и нижней границей 0; нечисло → дефолт. */
export function getMonitorNumber(
  db: Db,
  key: keyof typeof MONITOR_DEFAULTS,
): number {
  const raw = getSetting(db, key);
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : MONITOR_DEFAULTS[key];
}
```

- [ ] **Step 4: Прогнать тесты и typecheck**

Run: `npm test -w @dublyarr/core -- db && npm run typecheck`
Expected: PASS / exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/db/settings.ts packages/core/test/db.test.ts
git commit -m "feat(core): ключи настроек мониторинга и getMonitorNumber"
```

---

### Task 3: db/history.ts — аудит событий

**Files:**
- Create: `packages/core/src/db/history.ts`
- Modify: `packages/core/src/db/index.ts`
- Test: `packages/core/test/history.test.ts`

- [ ] **Step 1: Написать падающие тесты**

Создать `packages/core/test/history.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
  addHistory,
  addTitle,
  listHistory,
  openDb,
  recentSearchAt,
} from "../src/db/index.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-history-"));
const { db, sqlite } = openDb(join(dir, "history.db"));

afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const title = addTitle(db, {
  tmdbId: 1,
  type: "tv",
  titleRu: "Т",
  titleOriginal: "T",
  year: "2020",
  posterPath: null,
  overview: "",
  tmdbStatus: null,
  qualityPresetId: 1,
  voiceover: "any",
  monitorRule: "all",
});

describe("history", () => {
  test("addHistory + listHistory: новые сверху", () => {
    addHistory(db, { titleId: title.id, kind: "search", message: "ищу" });
    addHistory(db, { titleId: title.id, kind: "grab", message: "качаю" });
    const rows = listHistory(db, 10, 0);
    expect(rows).toHaveLength(2);
    expect(rows[0].kind).toBe("grab");
    expect(rows[0].titleId).toBe(title.id);
  });

  test("listHistory пагинация через limit/offset", () => {
    const page = listHistory(db, 1, 1);
    expect(page).toHaveLength(1);
    expect(page[0].kind).toBe("search");
  });

  test("recentSearchAt: ISO-время последнего search или null", () => {
    addHistory(db, {
      titleId: title.id,
      kind: "search",
      message: "явное время",
      createdAt: "2030-01-01T00:00:00Z",
    });
    expect(recentSearchAt(db, title.id)).toBe("2030-01-01T00:00:00Z");
    addHistory(db, { titleId: 99999, kind: "search", message: "другой тайтл" });
    expect(recentSearchAt(db, 12345)).toBeNull();
  });
});
```

- [ ] **Step 2: Прогнать тесты — убедиться, что падают**

Run: `npm test -w @dublyarr/core -- history`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать history.ts**

Создать `packages/core/src/db/history.ts`:

```ts
import { and, desc, eq, max } from "drizzle-orm";
import type { Db } from "./index.js";
import { history } from "./schema.js";

export type HistoryKind =
  | "search"
  | "grab"
  | "import"
  | "upgrade"
  | "fail"
  | "not_found";

export interface HistoryEvent {
  id: number;
  titleId: number | null;
  kind: HistoryKind;
  message: string;
  createdAt: string;
}

export interface HistoryInput {
  titleId: number | null;
  kind: HistoryKind;
  message: string;
  /** По умолчанию — datetime('now') на стороне БД. */
  createdAt?: string;
}

export function addHistory(db: Db, input: HistoryInput): HistoryEvent {
  const values = {
    titleId: input.titleId,
    kind: input.kind,
    message: input.message,
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
  };
  return db.insert(history).values(values).returning().get() as HistoryEvent;
}

export function listHistory(db: Db, limit: number, offset: number): HistoryEvent[] {
  return db
    .select()
    .from(history)
    .orderBy(desc(history.id))
    .limit(limit)
    .offset(offset)
    .all() as HistoryEvent[];
}

/** ISO-время последнего события kind=search для тайтла (для рейт-лимита) или null. */
export function recentSearchAt(db: Db, titleId: number): string | null {
  const row = db
    .select({ t: max(history.createdAt) })
    .from(history)
    .where(and(eq(history.titleId, titleId), eq(history.kind, "search")))
    .get();
  return row?.t ?? null;
}
```

- [ ] **Step 4: Реэкспортировать**

В `packages/core/src/db/index.ts` добавить:

```ts
export * from "./history.js";
```

- [ ] **Step 5: Прогнать тесты**

Run: `npm test -w @dublyarr/core -- history`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/db/history.ts packages/core/src/db/index.ts packages/core/test/history.test.ts
git commit -m "feat(core): db-модуль history с рейт-лимитом по последнему поиску"
```

---

### Task 4: db/blacklist.ts — битые раздачи

**Files:**
- Create: `packages/core/src/db/blacklist.ts`
- Modify: `packages/core/src/db/index.ts`
- Test: `packages/core/test/blacklist.test.ts`

- [ ] **Step 1: Написать падающие тесты**

Создать `packages/core/test/blacklist.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
  addTitle,
  blacklistRelease,
  isBlacklisted,
  listBlacklist,
  openDb,
} from "../src/db/index.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-blacklist-"));
const { db, sqlite } = openDb(join(dir, "blacklist.db"));

afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const title = addTitle(db, {
  tmdbId: 1,
  type: "tv",
  titleRu: "Т",
  titleOriginal: "T",
  year: "2020",
  posterPath: null,
  overview: "",
  tmdbStatus: null,
  qualityPresetId: 1,
  voiceover: "any",
  monitorRule: "all",
});

describe("blacklist", () => {
  test("blacklistRelease + isBlacklisted", () => {
    expect(isBlacklisted(db, title.id, "guid-1")).toBe(false);
    blacklistRelease(db, title.id, "guid-1", "завис");
    expect(isBlacklisted(db, title.id, "guid-1")).toBe(true);
    expect(isBlacklisted(db, title.id, "guid-2")).toBe(false);
  });

  test("повторный blacklistRelease идемпотентен (UNIQUE не падает)", () => {
    expect(() => blacklistRelease(db, title.id, "guid-1", "снова")).not.toThrow();
    expect(listBlacklist(db, title.id)).toHaveLength(1);
  });

  test("listBlacklist по тайтлу", () => {
    blacklistRelease(db, title.id, "guid-3", "битая");
    const rows = listBlacklist(db, title.id);
    expect(rows.map((r) => r.releaseGuid).sort()).toEqual(["guid-1", "guid-3"]);
  });
});
```

- [ ] **Step 2: Прогнать тесты — убедиться, что падают**

Run: `npm test -w @dublyarr/core -- blacklist`
Expected: FAIL.

- [ ] **Step 3: Реализовать blacklist.ts**

Создать `packages/core/src/db/blacklist.ts`:

```ts
import { and, eq } from "drizzle-orm";
import type { Db } from "./index.js";
import { blacklist } from "./schema.js";

export type BlacklistRow = typeof blacklist.$inferSelect;

/** Заносит раздачу в blacklist; повторный вызов с тем же guid — no-op (UNIQUE). */
export function blacklistRelease(
  db: Db,
  titleId: number,
  releaseGuid: string,
  reason: string,
): void {
  db.insert(blacklist)
    .values({ titleId, releaseGuid, reason })
    .onConflictDoNothing({ target: [blacklist.titleId, blacklist.releaseGuid] })
    .run();
}

export function isBlacklisted(db: Db, titleId: number, releaseGuid: string): boolean {
  const row = db
    .select({ id: blacklist.id })
    .from(blacklist)
    .where(and(eq(blacklist.titleId, titleId), eq(blacklist.releaseGuid, releaseGuid)))
    .get();
  return row != null;
}

export function listBlacklist(db: Db, titleId: number): BlacklistRow[] {
  return db.select().from(blacklist).where(eq(blacklist.titleId, titleId)).all();
}
```

- [ ] **Step 4: Реэкспортировать**

В `packages/core/src/db/index.ts` добавить:

```ts
export * from "./blacklist.js";
```

- [ ] **Step 5: Прогнать тесты**

Run: `npm test -w @dublyarr/core -- blacklist`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/db/blacklist.ts packages/core/src/db/index.ts packages/core/test/blacklist.test.ts
git commit -m "feat(core): db-модуль blacklist битых раздач"
```

---

### Task 5: scoring.ts — фильтр и скоринг раздач

**Files:**
- Create: `packages/core/src/scoring.ts`
- Modify: `packages/core/package.json` (exports)
- Test: `packages/core/test/scoring.test.ts`

- [ ] **Step 1: Написать падающие тесты**

Создать `packages/core/test/scoring.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { parseRelease, type ParsedRelease } from "../src/parser.js";
import type { JackettRelease } from "../src/jackett.js";
import { pickBestRelease, releaseMatches, scoreRelease, type ScoreContext } from "../src/scoring.js";

function rel(over: Partial<JackettRelease> & { title: string }): ParsedRelease<JackettRelease> {
  const base: JackettRelease = {
    title: over.title,
    description: over.description ?? "",
    indexer: over.indexer ?? "RuTracker",
    trackerType: "public",
    guid: over.guid ?? over.title,
    comments: "",
    pubDate: "",
    size: over.size ?? 1_000_000,
    seeders: over.seeders ?? 10,
    peers: 0,
    grabs: 0,
    link: over.link ?? `magnet:${over.title}`,
  };
  return parseRelease(base);
}

const ctx: ScoreContext = {
  allowed: ["webdl-1080p", "bluray-1080p", "hdtv-1080p"],
  preferred: "bluray-1080p",
  voiceover: "Сыендук",
  minSeeders: 2,
};

describe("releaseMatches", () => {
  test("совпадение озвучки + качество в allowed + сиды ≥ min", () => {
    const r = rel({ title: "Show S01 1080p BluRay", description: "VO (Сыендук)", seeders: 5 });
    expect(releaseMatches(r, ctx)).toBe(true);
  });

  test("чужая озвучка → нет", () => {
    const r = rel({ title: "Show S01 1080p BluRay", description: "VO (HDrezka)", seeders: 5 });
    expect(releaseMatches(r, ctx)).toBe(false);
  });

  test("voiceover=any принимает любую студию", () => {
    const r = rel({ title: "Show S01 1080p BluRay", description: "VO (HDrezka)", seeders: 5 });
    expect(releaseMatches(r, { ...ctx, voiceover: "any" })).toBe(true);
  });

  test("качество вне allowed → нет", () => {
    const r = rel({ title: "Show S01 2160p WEB-DL", description: "VO (Сыендук)", seeders: 5 });
    expect(releaseMatches(r, ctx)).toBe(false);
  });

  test("мало сидов → нет", () => {
    const r = rel({ title: "Show S01 1080p BluRay", description: "VO (Сыендук)", seeders: 1 });
    expect(releaseMatches(r, ctx)).toBe(false);
  });
});

describe("scoreRelease", () => {
  test("ближе к preferred → выше", () => {
    const exact = rel({ title: "S01 1080p BluRay", description: "VO (Сыендук)" });
    const far = rel({ title: "S01 1080p HDTV", description: "VO (Сыендук)" });
    expect(scoreRelease(exact, ctx)).toBeGreaterThan(scoreRelease(far, ctx));
  });

  test("при равном качестве больше сидов → выше", () => {
    const more = rel({ title: "S01 1080p BluRay", description: "VO (Сыендук)", seeders: 50 });
    const less = rel({ title: "S01 1080p BluRay", description: "VO (Сыендук)", seeders: 5 });
    expect(scoreRelease(more, ctx)).toBeGreaterThan(scoreRelease(less, ctx));
  });
});

describe("pickBestRelease", () => {
  test("выбирает лучший из подходящих, игнорит blacklisted", () => {
    const good = rel({ title: "S01 1080p BluRay", description: "VO (Сыендук)", guid: "g-good", seeders: 30 });
    const bad = rel({ title: "S01 1080p HDTV", description: "VO (Сыендук)", guid: "g-bad", seeders: 5 });
    const wrongVo = rel({ title: "S01 1080p BluRay", description: "VO (HDrezka)", guid: "g-wrong" });
    const best = pickBestRelease([bad, good, wrongVo], ctx, (guid) => guid === "g-good");
    // g-good в блэклисте → должен выбрать bad (единственный оставшийся подходящий)
    expect(best?.guid).toBe("g-bad");
  });

  test("нет подходящих → null", () => {
    const wrongVo = rel({ title: "S01 1080p BluRay", description: "VO (HDrezka)" });
    expect(pickBestRelease([wrongVo], ctx, () => false)).toBeNull();
  });
});
```

- [ ] **Step 2: Прогнать тесты — убедиться, что падают**

Run: `npm test -w @dublyarr/core -- scoring`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать scoring.ts**

Создать `packages/core/src/scoring.ts`:

```ts
import type { JackettRelease } from "./jackett.js";
import type { ParsedRelease } from "./parser.js";
import { qualityKeyFor, qualityRank } from "./quality.js";

export interface ScoreContext {
  /** Ключи качеств из пресета (галочки по лестнице). */
  allowed: string[];
  /** Предпочитаемый ключ качества. */
  preferred: string;
  /** Выбранная студия озвучки или "any". */
  voiceover: string;
  /** Минимум сидов. */
  minSeeders: number;
}

type Rel = ParsedRelease<JackettRelease>;

function studios(r: Rel): string[] {
  return r.parsed.voiceovers.flatMap((v) => v.studios);
}

/** Ключ качества раздачи по source+resolution или null, если не распознан. */
export function releaseQualityKey(r: Rel): string | null {
  return qualityKeyFor(r.parsed.quality.source, r.parsed.quality.resolution);
}

/** Проходит ли раздача базовые фильтры: озвучка, качество в allowed, сиды ≥ min. */
export function releaseMatches(r: Rel, ctx: ScoreContext): boolean {
  if (ctx.voiceover !== "any" && !studios(r).includes(ctx.voiceover)) return false;
  const key = releaseQualityKey(r);
  if (!key || !ctx.allowed.includes(key)) return false;
  if (r.seeders < ctx.minSeeders) return false;
  return true;
}

/**
 * Чем ближе качество к preferred — тем выше; при равной близости выше тот,
 * у кого выше абсолютный ранг; финальный tie-break — сиды.
 */
export function scoreRelease(r: Rel, ctx: ScoreContext): number {
  const key = releaseQualityKey(r);
  const rank = key ? qualityRank(key) : 0;
  const dist = Math.abs(rank - qualityRank(ctx.preferred));
  const seeders = Math.min(r.seeders, 9999);
  return -dist * 1_000_000 + rank * 10_000 + seeders;
}

/**
 * Лучшая подходящая раздача из списка (не в blacklist) или null.
 * isBlacklisted(guid) — предикат проверки чёрного списка.
 */
export function pickBestRelease(
  releases: Rel[],
  ctx: ScoreContext,
  isBlacklisted: (guid: string) => boolean,
): Rel | null {
  const candidates = releases
    .filter((r) => releaseMatches(r, ctx) && !isBlacklisted(r.guid))
    .sort((a, b) => scoreRelease(b, ctx) - scoreRelease(a, ctx));
  return candidates[0] ?? null;
}
```

- [ ] **Step 4: Добавить export-путь**

В `packages/core/package.json` в `exports` добавить:

```json
    "./scoring": "./src/scoring.ts",
```

- [ ] **Step 5: Прогнать тесты и typecheck**

Run: `npm test -w @dublyarr/core -- scoring && npm run typecheck`
Expected: PASS / exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/scoring.ts packages/core/package.json packages/core/test/scoring.test.ts
git commit -m "feat(core): скоринг и фильтрация раздач по озвучке/качеству/сидам"
```

---

### Task 6: Вынести grab в core (grabRelease) + переписать API POST

**Files:**
- Create: `packages/core/src/grab.ts`
- Modify: `packages/core/package.json` (exports)
- Modify: `apps/web/app/api/downloads/route.ts` (POST)
- Test: `packages/core/test/grab.test.ts`

Это DRY-рефактор: логика «создать download → qbt.addTorrent → дождаться hash по тегу» переезжает в core, чтобы её использовали и API, и воркер. Поведение API POST не меняется.

- [ ] **Step 1: Написать падающие тесты**

Создать `packages/core/test/grab.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test, vi } from "vitest";
import { addTitle, getDownload, openDb } from "../src/db/index.js";
import { grabRelease } from "../src/grab.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-grab-"));
const { db, sqlite } = openDb(join(dir, "grab.db"));

afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const title = addTitle(db, {
  tmdbId: 1, type: "tv", titleRu: "Т", titleOriginal: "T", year: "2020",
  posterPath: null, overview: "", tmdbStatus: null,
  qualityPresetId: 1, voiceover: "Сыендук", monitorRule: "all",
});

const input = {
  titleId: title.id,
  link: "magnet:?xt=urn:btih:abc",
  guid: "g-1",
  releaseTitle: "Show.S01.1080p",
  episodesCovered: [10, 11],
  voiceoverStudio: "Сыендук",
  qualitySource: "BluRay",
  qualityResolution: "1080p",
};

describe("grabRelease", () => {
  test("создаёт download, зовёт addTorrent с тегом, резолвит hash", async () => {
    const addTorrent = vi.fn().mockResolvedValue(undefined);
    const listTorrents = vi
      .fn()
      .mockResolvedValue([{ hash: "HASH1", progress: 0.1 }]);
    const qbt = { addTorrent, listTorrents } as never;

    const d = await grabRelease(db, qbt, input, { stagingDir: "/staging", waitMs: 0 });
    expect(d.qbitHash).toBe("HASH1");
    expect(d.status).toBe("downloading");
    expect(d.episodesCovered).toEqual([10, 11]);

    const addArg = addTorrent.mock.calls[0][0];
    expect(addArg.url).toBe(input.link);
    expect(addArg.category).toBe("dublyarr");
    expect(addArg.savePath).toBe("/staging");
    expect(addArg.tags).toBe(d.tag);
  });

  test("addTorrent падает → download failed, исключение проброшено", async () => {
    const qbt = {
      addTorrent: vi.fn().mockRejectedValue(new Error("qbt down")),
      listTorrents: vi.fn(),
    } as never;
    const err = await grabRelease(db, qbt, { ...input, guid: "g-2" }, { waitMs: 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    // последний созданный download должен быть failed
    const all = sqlite.prepare(`SELECT * FROM downloads ORDER BY id DESC LIMIT 1`).get() as {
      status: string;
      error: string;
    };
    expect(all.status).toBe("failed");
    expect(all.error).toContain("qbt down");
  });

  test("hash не нашёлся за отведённые попытки → download остаётся queued", async () => {
    const qbt = {
      addTorrent: vi.fn().mockResolvedValue(undefined),
      listTorrents: vi.fn().mockResolvedValue([]),
    } as never;
    const d = await grabRelease(db, qbt, { ...input, guid: "g-3" }, { waitMs: 0, attempts: 2 });
    expect(d.status).toBe("queued");
    expect(d.qbitHash).toBeNull();
    expect(getDownload(db, d.id)?.status).toBe("queued");
  });
});
```

- [ ] **Step 2: Прогнать тесты — убедиться, что падают**

Run: `npm test -w @dublyarr/core -- grab`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать grab.ts**

Создать `packages/core/src/grab.ts`:

```ts
import { createDownload, updateDownload, type Download } from "./db/downloads.js";
import type { Db } from "./db/index.js";
import { QbtError, type QbtClient } from "./qbittorrent.js";

export interface GrabInput {
  titleId: number;
  link: string;
  guid: string;
  releaseTitle: string;
  episodesCovered: number[];
  voiceoverStudio: string | null;
  qualitySource: string | null;
  qualityResolution: string | null;
}

export interface GrabOptions {
  /** Путь staging для qBittorrent (savepath). */
  stagingDir?: string;
  /** Сколько раз опрашивать listTorrents в поисках hash (по умолчанию 5). */
  attempts?: number;
  /** Пауза между попытками, мс (по умолчанию 1000; в тестах 0). */
  waitMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Создаёт download, добавляет раздачу в qBittorrent (category=dublyarr, tag=download.tag)
 * и пытается резолвить hash по тегу. При ошибке addTorrent помечает download failed и
 * пробрасывает исключение. Если hash не нашёлся — download остаётся queued
 * (hash доберётся при следующем поллинге).
 */
export async function grabRelease(
  db: Db,
  qbt: QbtClient,
  input: GrabInput,
  opts: GrabOptions = {},
): Promise<Download> {
  let download = createDownload(db, {
    titleId: input.titleId,
    releaseGuid: input.guid,
    releaseTitle: input.releaseTitle,
    episodesCovered: input.episodesCovered,
    voiceoverStudio: input.voiceoverStudio,
    qualitySource: input.qualitySource,
    qualityResolution: input.qualityResolution,
  });

  try {
    await qbt.addTorrent({
      url: input.link,
      savePath: opts.stagingDir || undefined,
      category: "dublyarr",
      tags: download.tag,
    });
  } catch (e) {
    const msg = e instanceof QbtError ? e.message : "qBittorrent недоступен";
    updateDownload(db, download.id, { status: "failed", error: msg });
    throw e;
  }

  const attempts = opts.attempts ?? 5;
  const waitMs = opts.waitMs ?? 1000;
  for (let i = 0; i < attempts; i++) {
    try {
      const found = (await qbt.listTorrents({ tag: download.tag }))[0];
      if (found) {
        download = updateDownload(db, download.id, {
          qbitHash: found.hash,
          status: "downloading",
          progress: found.progress,
        })!;
        break;
      }
    } catch {
      break; // hash доберётся при следующем поллинге
    }
    if (i < attempts - 1) await sleep(waitMs);
  }

  return download;
}
```

- [ ] **Step 4: Добавить export-путь**

В `packages/core/package.json` в `exports` добавить:

```json
    "./grab": "./src/grab.ts",
```

- [ ] **Step 5: Переписать API POST через grabRelease**

В `apps/web/app/api/downloads/route.ts` заменить тело `POST` после вычисления `episodesCovered` (строки, создающие download и весь блок addTorrent + цикл резолва hash) на использование core. Импорты: добавить `import { grabRelease } from "@dublyarr/core/grab";` и убрать из импорта `createDownload`, если он больше не используется в файле (проверь — он используется только тут). Новый хвост POST:

```ts
  try {
    const download = await grabRelease(
      db,
      qbt,
      {
        titleId,
        link,
        guid,
        releaseTitle,
        episodesCovered,
        voiceoverStudio,
        qualitySource,
        qualityResolution,
      },
      { stagingDir: getSetting(db, "staging_dir") || undefined },
    );
    return NextResponse.json(download, { status: 201 });
  } catch (e) {
    const msg = e instanceof QbtError ? e.message : "qBittorrent недоступен";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
```

(`QbtError` уже импортирован в файле. `updateDownload` остаётся импортирован — используется в `refreshOne`.)

- [ ] **Step 6: Прогнать тесты и typecheck**

Run: `npm test -w @dublyarr/core && npm run typecheck`
Expected: PASS / exit 0.

- [ ] **Step 7: Прогнать e2e (регрессия не должна сломать grab-flow)**

Run: `npm run test:e2e -w @dublyarr/web`
Expected: все спеки PASS, 0 failed.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/grab.ts packages/core/package.json packages/core/test/grab.test.ts apps/web/app/api/downloads/route.ts
git commit -m "refactor(core): вынести grabRelease в core, API POST использует его"
```

---

### Task 7: Вынести poll/refresh/import в core (poll.ts) + переписать API GET

**Files:**
- Create: `packages/core/src/poll.ts`
- Modify: `packages/core/package.json` (exports)
- Modify: `apps/web/app/api/downloads/route.ts` (GET, убрать локальный refreshOne)
- Test: `packages/core/test/poll.test.ts`

Логика рефреша статусов + автоимпорта + детект зависших (stall → blacklist) переезжает в core. И воркер, и API GET используют её. Сигнатуры строятся так, чтобы core сам читал настройки (библиотеки, шаблоны, stall_hours) через `getSetting`/`getMonitorNumber`.

- [ ] **Step 1: Написать падающие тесты**

Создать `packages/core/test/poll.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test, vi } from "vitest";
import {
  addTitle,
  createDownload,
  getDownload,
  isBlacklisted,
  openDb,
  updateDownload,
} from "../src/db/index.js";
import { refreshDownload } from "../src/poll.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-poll-"));
const { db, sqlite } = openDb(join(dir, "poll.db"));

afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const title = addTitle(db, {
  tmdbId: 1, type: "movie", titleRu: "Ф", titleOriginal: "F", year: "2020",
  posterPath: null, overview: "", tmdbStatus: null,
  qualityPresetId: 1, voiceover: "any", monitorRule: "all",
});

function newDownload(guid: string) {
  return createDownload(db, {
    titleId: title.id, releaseGuid: guid, releaseTitle: "rel",
    episodesCovered: [], voiceoverStudio: null,
    qualitySource: null, qualityResolution: null,
  });
}

describe("refreshDownload", () => {
  test("queued → downloading при появлении торрента", async () => {
    const d = newDownload("g-1");
    const qbt = {
      listTorrents: vi.fn().mockResolvedValue([{ hash: "H", state: "downloading", progress: 0.3, contentPath: "" }]),
    } as never;
    await refreshDownload(db, qbt, d, { now: new Date("2030-01-01T00:00:00Z") });
    const fresh = getDownload(db, d.id)!;
    expect(fresh.status).toBe("downloading");
    expect(fresh.qbitHash).toBe("H");
    expect(fresh.progress).toBeCloseTo(0.3);
  });

  test("downloading без торрента → failed", async () => {
    const d = newDownload("g-2");
    updateDownload(db, d.id, { status: "downloading", qbitHash: "H2", progress: 0.5 });
    const qbt = { listTorrents: vi.fn().mockResolvedValue([]) } as never;
    await refreshDownload(db, qbt, getDownload(db, d.id)!, { now: new Date("2030-01-01T00:00:00Z") });
    expect(getDownload(db, d.id)!.status).toBe("failed");
  });

  test("зависший downloading дольше stall_hours → failed + blacklist", async () => {
    const d = newDownload("g-stall");
    // createdAt по умолчанию datetime('now'); искусственно состарим
    sqlite.prepare(`UPDATE downloads SET status='downloading', qbit_hash='H3', created_at='2030-01-01T00:00:00Z' WHERE id=?`).run(d.id);
    const qbt = {
      // торрент есть, но stalledDL и прогресс не растёт
      listTorrents: vi.fn().mockResolvedValue([{ hash: "H3", state: "stalledDL", progress: 0.1, contentPath: "" }]),
    } as never;
    await refreshDownload(db, qbt, getDownload(db, d.id)!, {
      now: new Date("2030-01-01T10:00:00Z"), // +10ч > stall 6ч
      stallHours: 6,
    });
    expect(getDownload(db, d.id)!.status).toBe("failed");
    expect(isBlacklisted(db, title.id, "g-stall")).toBe(true);
  });
});
```

- [ ] **Step 2: Прогнать тесты — убедиться, что падают**

Run: `npm test -w @dublyarr/core -- poll`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать poll.ts**

Создать `packages/core/src/poll.ts`:

```ts
import { blacklistRelease } from "./db/blacklist.js";
import {
  getDownload,
  listDownloadsForTitle,
  REFRESHABLE_STATUSES,
  updateDownload,
  type Download,
} from "./db/downloads.js";
import { getMonitorNumber, getSetting } from "./db/settings.js";
import { getTitle } from "./db/titles.js";
import type { Db } from "./db/index.js";
import { addHistory } from "./db/history.js";
import { importDownload } from "./import.js";
import { DEFAULT_NAMING_MOVIE, DEFAULT_NAMING_TV } from "./naming.js";
import { QbtError, qbtStateToStatus, type QbtClient } from "./qbittorrent.js";

/** Состояния qBittorrent, которые считаем «застрял» (нет источника/метаданных). */
const STALLED_STATES = new Set(["stalledDL", "metaDL"]);

export interface PollOptions {
  /** Текущее время (для детекта зависших). По умолчанию new Date(). */
  now?: Date;
  /** Таймаут зависания в часах; по умолчанию читается из настроек. */
  stallHours?: number;
}

function hoursBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 3_600_000;
}

/**
 * Один проход по загрузке: queued→downloading→completed→imported по данным qBittorrent.
 * Зависшую (downloading дольше stallHours) помечает failed и заносит в blacklist.
 * Сам читает настройки библиотек/шаблонов. Кидает только при недоступности qBittorrent.
 */
export async function refreshDownload(
  db: Db,
  qbt: QbtClient,
  d: Download,
  opts: PollOptions = {},
): Promise<void> {
  const now = opts.now ?? new Date();
  const stallHours =
    opts.stallHours ?? getMonitorNumber(db, "monitor_stall_hours");
  const torrent = (await qbt.listTorrents({ tag: d.tag }))[0];

  const fresh = getDownload(db, d.id);
  if (!fresh || !REFRESHABLE_STATUSES.includes(fresh.status)) return;
  d = fresh;

  if (d.status === "queued") {
    if (!torrent) return;
    d = updateDownload(db, d.id, {
      qbitHash: torrent.hash,
      status: "downloading",
      progress: torrent.progress,
    })!;
  }

  if (d.status === "downloading") {
    if (!torrent) {
      updateDownload(db, d.id, { status: "failed", error: "Раздача пропала из qBittorrent" });
      return;
    }
    const next = qbtStateToStatus(torrent.state, torrent.progress);
    if (next === "failed") {
      updateDownload(db, d.id, { status: "failed", error: `qBittorrent: ${torrent.state}` });
      blacklistRelease(db, d.titleId, d.releaseGuid, `qBittorrent: ${torrent.state}`);
      return;
    }
    if (next === "downloading" && stallHours > 0 && STALLED_STATES.has(torrent.state)) {
      const started = new Date(d.createdAt.replace(" ", "T") + (d.createdAt.includes("Z") ? "" : "Z"));
      if (!Number.isNaN(started.getTime()) && hoursBetween(now, started) > stallHours) {
        updateDownload(db, d.id, { status: "failed", error: "Загрузка зависла (таймаут)" });
        blacklistRelease(db, d.titleId, d.releaseGuid, "Зависла дольше таймаута");
        return;
      }
    }
    d = updateDownload(db, d.id, { status: next, progress: torrent.progress })!;
  }

  if (d.status === "completed") {
    if (!torrent) {
      updateDownload(db, d.id, {
        status: "failed",
        error: "Раздача пропала из qBittorrent — импорт невозможен",
      });
      return;
    }
    if (!torrent.contentPath) return;
    const title = getTitle(db, d.titleId);
    if (!title) return;
    const libraryDir = getSetting(db, title.type === "tv" ? "library_tv" : "library_movies");
    if (!libraryDir) {
      updateDownload(db, d.id, {
        error: "Не настроена папка библиотеки (Настройки → Папки и имена)",
      });
      return;
    }
    const template =
      getSetting(db, title.type === "tv" ? "naming_tv" : "naming_movie") ||
      (title.type === "tv" ? DEFAULT_NAMING_TV : DEFAULT_NAMING_MOVIE);
    try {
      const result = importDownload(db, d, title, torrent.contentPath, { libraryDir, template });
      if (!result.ok) {
        updateDownload(db, d.id, { error: result.error });
      } else {
        addHistory(db, {
          titleId: title.id,
          kind: "import",
          message: `Импортировано: ${d.releaseTitle || d.tag}`,
        });
      }
    } catch (e) {
      updateDownload(db, d.id, {
        error: `Ошибка импорта: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
}

/** Рефреш всех обновляемых загрузок тайтла; возвращает свежий список + текст ошибки qbt. */
export async function pollTitle(
  db: Db,
  qbt: QbtClient,
  titleId: number,
  opts: PollOptions = {},
): Promise<{ downloads: Download[]; qbtError: string | null }> {
  let qbtError: string | null = null;
  const refreshable = listDownloadsForTitle(db, titleId).filter((d) =>
    REFRESHABLE_STATUSES.includes(d.status),
  );
  for (const d of refreshable) {
    try {
      await refreshDownload(db, qbt, d, opts);
    } catch (e) {
      qbtError = e instanceof QbtError ? e.message : "qBittorrent недоступен";
      break;
    }
  }
  return { downloads: listDownloadsForTitle(db, titleId), qbtError };
}
```

- [ ] **Step 4: Добавить export-путь**

В `packages/core/package.json` в `exports` добавить:

```json
    "./poll": "./src/poll.ts",
```

- [ ] **Step 5: Переписать API GET через pollTitle**

В `apps/web/app/api/downloads/route.ts`:
- удалить локальную функцию `refreshOne` целиком;
- из импортов `@dublyarr/core/db` убрать ставшие неиспользуемыми (`getDownload`, `listEpisodes` всё ещё нужен для POST — оставить; `REFRESHABLE_STATUSES`, `getDownload`, `updateDownload` использовались только в refreshOne/GET — проверь и убери неиспользуемые); убрать импорты `importDownload`, `DEFAULT_NAMING_*`, `qbtStateToStatus`;
- добавить `import { pollTitle } from "@dublyarr/core/poll";`
- заменить тело `GET` на:

```ts
export async function GET(req: Request) {
  const titleId = Number(new URL(req.url).searchParams.get("titleId"));
  if (!Number.isInteger(titleId) || titleId <= 0) {
    return NextResponse.json({ error: "Некорректный titleId" }, { status: 400 });
  }
  const db = getDb();
  const qbt = qbtFromSettings(db);
  if (!qbt) {
    return NextResponse.json({ downloads: listDownloadsForTitle(db, titleId), qbtError: null });
  }
  const { downloads, qbtError } = await pollTitle(db, qbt, titleId);
  return NextResponse.json({ downloads, qbtError });
}
```

Убедись, что `listDownloadsForTitle` остаётся импортирован из `@dublyarr/core/db`, а `QbtError`/`type Download`/`type QbtClient` больше не нужны в файле — убери неиспользуемые импорты (typecheck подскажет).

- [ ] **Step 6: Прогнать тесты и typecheck**

Run: `npm test -w @dublyarr/core && npm run typecheck`
Expected: PASS / exit 0.

- [ ] **Step 7: Прогнать e2e**

Run: `npm run test:e2e -w @dublyarr/web`
Expected: все спеки PASS, 0 failed (поведение poll сохранено).

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/poll.ts packages/core/package.json packages/core/test/poll.test.ts apps/web/app/api/downloads/route.ts
git commit -m "refactor(core): вынести poll/refresh/import в core, API GET использует его"
```

---

### Task 8: pipeline.ts — выбор кандидатов и обработка тайтла

**Files:**
- Create: `packages/core/src/pipeline.ts`
- Modify: `packages/core/package.json` (exports)
- Test: `packages/core/test/pipeline.test.ts`

Чистая логика конвейера с инъекцией поиска/grab/часов. Только сценарий «докачать недостающее» (апгрейды — M3b).

- [ ] **Step 1: Написать падающие тесты**

Создать `packages/core/test/pipeline.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test, vi } from "vitest";
import {
  addFile,
  addHistory,
  addTitle,
  listHistory,
  openDb,
  syncEpisodes,
} from "../src/db/index.js";
import { parseRelease } from "../src/parser.js";
import type { JackettRelease } from "../src/jackett.js";
import { selectCandidates, runTitle } from "../src/pipeline.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-pipeline-"));
const { db, sqlite } = openDb(join(dir, "pipeline.db"));
afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

function rawRel(over: Partial<JackettRelease> & { title: string }): JackettRelease {
  return {
    title: over.title, description: over.description ?? "", indexer: "RuTracker",
    trackerType: "public", guid: over.guid ?? over.title, comments: "", pubDate: "",
    size: 1_000_000, seeders: over.seeders ?? 10, peers: 0, grabs: 0,
    link: over.link ?? `magnet:${over.title}`,
  };
}

const TODAY = "2024-01-01";

describe("selectCandidates", () => {
  test("сериал с wanted-эпизодами без файла → кандидат missing с нужными сезонами", () => {
    const tv = addTitle(db, {
      tmdbId: 100, type: "tv", titleRu: "Сериал", titleOriginal: "Series", year: "2020",
      posterPath: null, overview: "", tmdbStatus: null,
      qualityPresetId: 1, voiceover: "Сыендук", monitorRule: "all",
    });
    syncEpisodes(db, tv.id, [
      { season: 1, episode: 1, airDate: "2020-01-01", name: "" },
      { season: 2, episode: 1, airDate: "2020-02-01", name: "" },
    ], "all", TODAY);
    const cands = selectCandidates(db, TODAY);
    const c = cands.find((x) => x.title.id === tv.id);
    expect(c?.reason).toBe("missing");
    expect(c?.wantedSeasons.sort()).toEqual([1, 2]);
  });

  test("фильм tracked без файла → кандидат missing", () => {
    const movie = addTitle(db, {
      tmdbId: 200, type: "movie", titleRu: "Фильм", titleOriginal: "Movie", year: "2020",
      posterPath: null, overview: "", tmdbStatus: null,
      qualityPresetId: 1, voiceover: "any", monitorRule: "all",
    });
    const c = selectCandidates(db, TODAY).find((x) => x.title.id === movie.id);
    expect(c?.reason).toBe("missing");
  });

  test("фильм с файлом → не кандидат", () => {
    const movie = addTitle(db, {
      tmdbId: 201, type: "movie", titleRu: "Готов", titleOriginal: "Done", year: "2020",
      posterPath: null, overview: "", tmdbStatus: null,
      qualityPresetId: 1, voiceover: "any", monitorRule: "all",
    });
    addFile(db, {
      titleId: movie.id, episodeId: null, path: "/lib/done.mkv", size: 1,
      qualitySource: "WEB-DL", qualityResolution: "1080p", voiceoverStudio: null, releaseGuid: null,
    });
    expect(selectCandidates(db, TODAY).some((x) => x.title.id === movie.id)).toBe(false);
  });

  test("рейт-лимит: искали меньше интервала назад → пропуск", () => {
    const movie = addTitle(db, {
      tmdbId: 202, type: "movie", titleRu: "Свежий", titleOriginal: "Fresh", year: "2020",
      posterPath: null, overview: "", tmdbStatus: null,
      qualityPresetId: 1, voiceover: "any", monitorRule: "all",
    });
    addHistory(db, { titleId: movie.id, kind: "search", message: "только что", createdAt: "2024-01-01T11:59:00Z" });
    const now = new Date("2024-01-01T12:00:00Z"); // 1 минута назад
    const cands = selectCandidates(db, TODAY, { now, rateLimitMinutes: 60 });
    expect(cands.some((x) => x.title.id === movie.id)).toBe(false);
  });
});

describe("runTitle", () => {
  test("находит подходящую раздачу → grab + history", async () => {
    const tv = addTitle(db, {
      tmdbId: 300, type: "tv", titleRu: "Ран", titleOriginal: "Run", year: "2020",
      posterPath: null, overview: "", tmdbStatus: null,
      qualityPresetId: 1, voiceover: "Сыендук", monitorRule: "all",
    });
    syncEpisodes(db, tv.id, [{ season: 1, episode: 1, airDate: "2020-01-01", name: "" }], "all", TODAY);

    const search = vi.fn().mockResolvedValue([
      rawRel({ title: "Run S01 1080p WEB-DL", description: "VO (Сыендук)", guid: "ok", seeders: 20 }),
      rawRel({ title: "Run S01 1080p WEB-DL", description: "VO (HDrezka)", guid: "wrong" }),
    ].map(parseRelease));
    const grab = vi.fn().mockResolvedValue(undefined);

    const cand = selectCandidates(db, TODAY).find((x) => x.title.id === tv.id)!;
    await runTitle(db, cand, { search, grab, minSeeders: 1, now: new Date("2024-06-01T00:00:00Z") });

    expect(search).toHaveBeenCalledWith("Run");
    expect(grab).toHaveBeenCalledTimes(1);
    const grabArg = grab.mock.calls[0][0];
    expect(grabArg.guid).toBe("ok");
    expect(grabArg.voiceoverStudio).toBe("Сыендук");
    const kinds = listHistory(db, 20, 0).filter((h) => h.titleId === tv.id).map((h) => h.kind);
    expect(kinds).toContain("search");
    expect(kinds).toContain("grab");
  });

  test("ничего не подошло → history not_found, grab не зван", async () => {
    const tv = addTitle(db, {
      tmdbId: 301, type: "tv", titleRu: "Пусто", titleOriginal: "Empty", year: "2020",
      posterPath: null, overview: "", tmdbStatus: null,
      qualityPresetId: 1, voiceover: "Сыендук", monitorRule: "all",
    });
    syncEpisodes(db, tv.id, [{ season: 1, episode: 1, airDate: "2020-01-01", name: "" }], "all", TODAY);
    const search = vi.fn().mockResolvedValue([
      parseRelease(rawRel({ title: "Empty S01 1080p WEB-DL", description: "VO (HDrezka)", guid: "x" })),
    ]);
    const grab = vi.fn();
    const cand = selectCandidates(db, TODAY).find((x) => x.title.id === tv.id)!;
    await runTitle(db, cand, { search, grab, minSeeders: 1, now: new Date() });
    expect(grab).not.toHaveBeenCalled();
    expect(listHistory(db, 50, 0).some((h) => h.titleId === tv.id && h.kind === "not_found")).toBe(true);
  });
});
```

- [ ] **Step 2: Прогнать тесты — убедиться, что падают**

Run: `npm test -w @dublyarr/core -- pipeline`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать pipeline.ts**

Создать `packages/core/src/pipeline.ts`:

```ts
import { isBlacklisted } from "./db/blacklist.js";
import type { Db } from "./db/index.js";
import { addHistory, recentSearchAt } from "./db/history.js";
import { getPreset } from "./db/presets.js";
import { listEpisodes, listTrackedTitles, type Episode, type Title } from "./db/titles.js";
import { listFiles } from "./db/files.js";
import type { GrabInput } from "./grab.js";
import type { JackettRelease } from "./jackett.js";
import type { ParsedRelease } from "./parser.js";
import { pickBestRelease, type ScoreContext } from "./scoring.js";

export interface Candidate {
  title: Title;
  reason: "missing";
  /** Сезоны с wanted-эпизодами без файла (для tv); для movie — []. */
  wantedSeasons: number[];
  /** wanted-эпизоды без файла (для расчёта episodesCovered при grab). */
  wantedEpisodes: Episode[];
}

export interface SelectOptions {
  now?: Date;
  /** Не искать тайтл чаще, чем раз в N минут (по умолчанию 60). */
  rateLimitMinutes?: number;
}

/**
 * Кандидаты на поиск: сериалы с wanted-эпизодами без файла и фильмы без файлов.
 * Исключает тайтлы, по которым искали недавно (рейт-лимит по history).
 */
export function selectCandidates(
  db: Db,
  today: string,
  opts: SelectOptions = {},
): Candidate[] {
  const now = opts.now ?? new Date();
  const rateMs = (opts.rateLimitMinutes ?? 60) * 60_000;
  const out: Candidate[] = [];

  for (const title of listTrackedTitles(db)) {
    const last = recentSearchAt(db, title.id);
    if (last) {
      const lastMs = new Date(last.replace(" ", "T") + (last.includes("Z") ? "" : "Z")).getTime();
      if (!Number.isNaN(lastMs) && now.getTime() - lastMs < rateMs) continue;
    }

    if (title.type === "movie") {
      if (listFiles(db, title.id).length === 0) {
        out.push({ title, reason: "missing", wantedSeasons: [], wantedEpisodes: [] });
      }
      continue;
    }

    const wantedMissing = listEpisodes(db, title.id).filter((e) => e.wanted && e.fileId == null);
    if (wantedMissing.length > 0) {
      out.push({
        title,
        reason: "missing",
        wantedSeasons: [...new Set(wantedMissing.map((e) => e.season))].sort((a, b) => a - b),
        wantedEpisodes: wantedMissing,
      });
    }
  }
  return out;
}

export interface RunDeps {
  /** Поиск в Jackett по запросу → распарсенные раздачи. */
  search: (query: string) => Promise<ParsedRelease<JackettRelease>[]>;
  /** Скачать выбранную раздачу. */
  grab: (input: GrabInput) => Promise<unknown>;
  /** Минимум сидов. */
  minSeeders: number;
  now?: Date;
}

/**
 * Один тайтл: поиск → фильтр (озвучка/качество/сиды/покрытие сезонов/blacklist) →
 * скоринг → grab лучшего. Пишет историю на каждом шаге. Без апгрейдов (M3b).
 */
export async function runTitle(db: Db, cand: Candidate, deps: RunDeps): Promise<void> {
  const { title } = cand;
  addHistory(db, { titleId: title.id, kind: "search", message: `Поиск: ${title.titleOriginal}` });

  const preset = getPreset(db, title.qualityPresetId);
  if (!preset) {
    addHistory(db, { titleId: title.id, kind: "fail", message: "Пресет качества не найден" });
    return;
  }
  const ctx: ScoreContext = {
    allowed: preset.allowed,
    preferred: preset.preferred,
    voiceover: title.voiceover,
    minSeeders: deps.minSeeders,
  };

  let releases = await deps.search(title.titleOriginal);

  // Для сериала оставляем раздачи, покрывающие хотя бы один нужный сезон.
  if (title.type === "tv" && cand.wantedSeasons.length > 0) {
    const wanted = new Set(cand.wantedSeasons);
    releases = releases.filter(
      (r) => r.parsed.seasons.length === 0 || r.parsed.seasons.some((s) => wanted.has(s)),
    );
  }

  const best = pickBestRelease(releases, ctx, (guid) => isBlacklisted(db, title.id, guid));
  if (!best) {
    addHistory(db, { titleId: title.id, kind: "not_found", message: "Подходящих раздач нет" });
    return;
  }

  const episodesCovered =
    title.type === "tv"
      ? cand.wantedEpisodes
          .filter(
            (e) => best.parsed.seasons.length === 0 || best.parsed.seasons.includes(e.season),
          )
          .map((e) => e.id)
      : [];

  const studios = best.parsed.voiceovers.flatMap((v) => v.studios);
  await deps.grab({
    titleId: title.id,
    link: best.link,
    guid: best.guid,
    releaseTitle: best.title,
    episodesCovered,
    voiceoverStudio: title.voiceover !== "any" ? title.voiceover : (studios[0] ?? null),
    qualitySource: best.parsed.quality.source,
    qualityResolution: best.parsed.quality.resolution,
  });
  addHistory(db, { titleId: title.id, kind: "grab", message: `Скачиваю: ${best.title}` });
}
```

- [ ] **Step 4: Добавить export-путь**

В `packages/core/package.json` в `exports` добавить:

```json
    "./pipeline": "./src/pipeline.ts",
```

- [ ] **Step 5: Прогнать тесты и typecheck**

Run: `npm test -w @dublyarr/core -- pipeline && npm run typecheck`
Expected: PASS / exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/pipeline.ts packages/core/package.json packages/core/test/pipeline.test.ts
git commit -m "feat(core): конвейер выбора кандидатов и обработки тайтла"
```

---

### Task 9: tick.ts — единая точка одного тика (склейка конвейера и клиентов)

**Files:**
- Create: `packages/core/src/tick.ts`
- Modify: `packages/core/package.json` (exports)
- Test: `packages/core/test/tick.test.ts`

Связывает pipeline + scoring + grab + poll + реальные клиенты Jackett/qBittorrent в одну функцию `runTick(db)` (её зовут и воркер, и «Искать сейчас» — последний через `runOneTitle`).

- [ ] **Step 1: Написать падающие тесты**

Создать `packages/core/test/tick.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test, vi } from "vitest";
import { openDb, setSetting } from "../src/db/index.js";
import { makeDeps } from "../src/tick.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-tick-"));
const { db, sqlite } = openDb(join(dir, "tick.db"));
afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("makeDeps", () => {
  test("search дергает searchJackett с настройками и парсит; grab зовёт grabRelease", async () => {
    setSetting(db, "jackett_url", "http://jk");
    setSetting(db, "jackett_api_key", "key");
    setSetting(db, "qbit_url", "http://qb");
    setSetting(db, "monitor_min_seeders", "3");

    const searchJackett = vi.fn().mockResolvedValue([]);
    const qbt = { addTorrent: vi.fn(), listTorrents: vi.fn().mockResolvedValue([]) } as never;

    const deps = makeDeps(db, { searchJackett, qbt });
    expect(deps.minSeeders).toBe(3);

    await deps.search("Запрос");
    expect(searchJackett).toHaveBeenCalledWith({ url: "http://jk", apiKey: "key" }, "Запрос");
  });
});
```

(Полный сквозной `runTick` проверяется юнитами `selectCandidates`/`runTitle` из Task 8 и вручную через воркер; здесь фиксируем склейку настроек.)

- [ ] **Step 2: Прогнать тест — убедиться, что падает**

Run: `npm test -w @dublyarr/core -- tick`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать tick.ts**

Создать `packages/core/src/tick.ts`:

```ts
import type { Db } from "./db/index.js";
import { addHistory } from "./db/history.js";
import { getMonitorNumber, getSetting } from "./db/settings.js";
import { getTitle } from "./db/titles.js";
import { grabRelease, type GrabInput } from "./grab.js";
import { searchJackett as realSearchJackett } from "./jackett.js";
import { parseRelease } from "./parser.js";
import {
  runTitle,
  selectCandidates,
  type Candidate,
  type RunDeps,
} from "./pipeline.js";
import { pollTitle } from "./poll.js";
import { QbtClient } from "./qbittorrent.js";

type SearchJackett = typeof realSearchJackett;

export interface TickClients {
  /** Подменяется в тестах; по умолчанию реальный searchJackett. */
  searchJackett?: SearchJackett;
  /** Готовый qBittorrent-клиент. */
  qbt: QbtClient;
}

/** Собирает RunDeps из настроек БД и клиентов. */
export function makeDeps(db: Db, clients: TickClients): RunDeps {
  const search: SearchJackett = clients.searchJackett ?? realSearchJackett;
  const jackettUrl = getSetting(db, "jackett_url") ?? "";
  const jackettKey = getSetting(db, "jackett_api_key") ?? "";
  const stagingDir = getSetting(db, "staging_dir") || undefined;

  return {
    minSeeders: getMonitorNumber(db, "monitor_min_seeders"),
    search: async (query) =>
      (await search({ url: jackettUrl, apiKey: jackettKey }, query)).map(parseRelease),
    grab: (input: GrabInput) => grabRelease(db, clients.qbt, input, { stagingDir }),
  };
}

/** Обрабатывает одного кандидата (поиск+grab), затем пробует продвинуть его загрузки. */
async function processCandidate(db: Db, qbt: QbtClient, deps: RunDeps, cand: Candidate): Promise<void> {
  try {
    await runTitle(db, cand, deps);
  } catch (e) {
    addHistory(db, {
      titleId: cand.title.id,
      kind: "fail",
      message: `Ошибка поиска: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
  // Сразу попробуем продвинуть статусы (queued→downloading и т.п.)
  await pollTitle(db, qbt, cand.title.id).catch(() => {});
}

/**
 * Один полный тик: поллинг активных загрузок всех кандидатов + поиск недостающего.
 * Возвращает число обработанных тайтлов.
 */
export async function runTick(db: Db, clients: TickClients): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const deps = makeDeps(db, clients);
  const candidates = selectCandidates(db, today);
  for (const cand of candidates) {
    await processCandidate(db, clients.qbt, deps, cand);
  }
  return candidates.length;
}

/**
 * «Искать сейчас» для одного тайтла: игнорирует рейт-лимит, всегда ищет.
 * Возвращает true, если тайтл существует и отслеживается.
 */
export async function runOneTitle(db: Db, titleId: number, clients: TickClients): Promise<boolean> {
  const title = getTitle(db, titleId);
  if (!title || title.tracked !== 1) return false;
  const today = new Date().toISOString().slice(0, 10);
  // Кандидат строится напрямую (без рейт-лимита).
  const all = selectCandidatesForceTitle(db, today, titleId);
  const deps = makeDeps(db, clients);
  for (const cand of all) {
    await processCandidate(db, clients.qbt, deps, cand);
  }
  return true;
}

/** Кандидат для конкретного тайтла без рейт-лимита (для «Искать сейчас»). */
function selectCandidatesForceTitle(db: Db, today: string, titleId: number): Candidate[] {
  return selectCandidates(db, today, { rateLimitMinutes: 0 }).filter(
    (c) => c.title.id === titleId,
  );
}
```

- [ ] **Step 4: Добавить export-путь**

В `packages/core/package.json` в `exports` добавить:

```json
    "./tick": "./src/tick.ts",
```

- [ ] **Step 5: Прогнать тесты и typecheck**

Run: `npm test -w @dublyarr/core && npm run typecheck`
Expected: PASS / exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/tick.ts packages/core/package.json packages/core/test/tick.test.ts
git commit -m "feat(core): склейка тика (runTick/runOneTitle) с клиентами и настройками"
```

---

### Task 10: Процесс воркера apps/worker

**Files:**
- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/src/index.ts`
- Modify: `package.json` (корневой — добавить скрипт `worker`)

Тонкий рантайм: открывает БД, на интервале из настроек зовёт `runTick`. Логики для юнит-тестов тут нет (она в core); проверяется typecheck и ручным запуском.

- [ ] **Step 1: package.json воркера**

Создать `apps/worker/package.json`:

```json
{
  "name": "@dublyarr/worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@dublyarr/core": "*",
    "better-sqlite3": "^12.2.0",
    "pino": "^9.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^24.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.8.3"
  }
}
```

- [ ] **Step 2: tsconfig воркера**

Создать `apps/worker/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Реализовать src/index.ts**

Создать `apps/worker/src/index.ts`:

```ts
import { join } from "node:path";
import pino from "pino";
import { openDb, getMonitorNumber, getSetting, MONITOR_DEFAULTS } from "@dublyarr/core/db";
import { QbtClient } from "@dublyarr/core/qbittorrent";
import { runTick } from "@dublyarr/core/tick";

const log = pino({ level: process.env.LOG_LEVEL ?? "info" });
const dataDir = process.env.DATA_DIR ?? "./data";
const { db } = openDb(join(dataDir, "dublyarr.db"));

let running = false;

async function tickOnce(): Promise<void> {
  if (running) {
    log.warn("предыдущий тик ещё идёт — пропускаю");
    return;
  }
  const url = getSetting(db, "qbit_url");
  if (!url) {
    log.info("qBittorrent не настроен — тик пропущен");
    return;
  }
  running = true;
  try {
    const qbt = new QbtClient({
      url,
      username: getSetting(db, "qbit_username") ?? "",
      password: getSetting(db, "qbit_password") ?? "",
    });
    const n = await runTick(db, { qbt });
    log.info({ candidates: n }, "тик завершён");
  } catch (e) {
    log.error({ err: e instanceof Error ? e.message : String(e) }, "ошибка тика");
  } finally {
    running = false;
  }
}

function intervalMs(): number {
  const min = getMonitorNumber(db, "monitor_interval_min") || MONITOR_DEFAULTS.monitor_interval_min;
  return Math.max(1, min) * 60_000;
}

log.info({ dataDir }, "воркер Dublyarr запущен");
void tickOnce();
let timer = setTimeout(function loop() {
  void tickOnce().finally(() => {
    timer = setTimeout(loop, intervalMs());
  });
}, intervalMs());

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    log.info("остановка воркера");
    clearTimeout(timer);
    process.exit(0);
  });
}
```

- [ ] **Step 4: Корневой скрипт**

В корневом `package.json` в `scripts` добавить:

```json
    "worker": "npm run start -w @dublyarr/worker",
```

- [ ] **Step 5: Установить зависимости и проверить typecheck**

Run: `npm install`
Then: `npm run typecheck`
Expected: установка проходит; typecheck exit 0 во всех воркспейсах (включая новый worker).

- [ ] **Step 6: Smoke-проверка запуска (без qBittorrent — должен логировать и не падать)**

Run: `DATA_DIR=./.worker-smoke timeout 3 npm run worker || true`
Expected: в логах «воркер Dublyarr запущен» и «qBittorrent не настроен — тик пропущен», процесс не падает с ошибкой (выходит по timeout). Затем удалить смоук-данные: `rm -rf ./.worker-smoke`.

- [ ] **Step 7: Commit**

```bash
git add apps/worker package.json package-lock.json
git commit -m "feat(worker): процесс воркера с cron-тиком конвейера"
```

---

### Task 11: API «Искать сейчас»

**Files:**
- Create: `apps/web/app/api/titles/[id]/search/route.ts`

- [ ] **Step 1: Реализовать роут**

Создать `apps/web/app/api/titles/[id]/search/route.ts`:

```ts
import { NextResponse } from "next/server";
import { runOneTitle } from "@dublyarr/core/tick";
import { getDb } from "@/server/db";
import { qbtFromSettings } from "@/server/qbt";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const titleId = Number(id);
  if (!Number.isInteger(titleId) || titleId <= 0) {
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  }
  const db = getDb();
  const qbt = qbtFromSettings(db);
  if (!qbt) {
    return NextResponse.json({ error: "qBittorrent не настроен" }, { status: 400 });
  }
  try {
    const ok = await runOneTitle(db, titleId, { qbt });
    if (!ok) return NextResponse.json({ error: "Тайтл не отслеживается" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ошибка поиска" },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: Проверить typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/titles/[id]/search/route.ts
git commit -m "feat(web): API «Искать сейчас» для одного тайтла"
```

---

### Task 12: Кнопка «Искать сейчас» в TrackingBlock

**Files:**
- Modify: `apps/web/app/title/[type]/[id]/TrackingBlock.tsx`
- Modify: `apps/web/app/title/[type]/[id]/tracking.module.css`

- [ ] **Step 1: Прочитать текущий TrackingBlock**

Открой `apps/web/app/title/[type]/[id]/TrackingBlock.tsx`. В нём есть клиентский компонент с хелпером `call(input, init)` (fetch + router.refresh + error), состояние `busy`/`error`, и блок с кнопками для отслеживаемого тайтла (видно по `tracked`). Кнопку «Искать сейчас» нужно показывать только когда тайтл отслеживается (`tracked` не null).

- [ ] **Step 2: Добавить состояние и обработчик**

Внутри компонента (рядом с существующими useState) добавить:

```tsx
  const [searchMsg, setSearchMsg] = useState<string | null>(null);

  async function searchNow() {
    if (!tracked) return;
    setSearchMsg("Ищу…");
    try {
      const res = await fetch(`/api/titles/${tracked.id}/search`, { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setSearchMsg(data.error ?? `Ошибка ${res.status}`);
        return;
      }
      setSearchMsg("Поиск запущен — смотрите «Загрузки» ниже");
      router.refresh();
    } catch {
      setSearchMsg("Сеть недоступна");
    }
  }
```

(`useState` и `router` уже есть в компоненте — переиспользуй; если `useState` не импортирован — он импортирован, компонент клиентский.)

- [ ] **Step 3: Добавить кнопку в разметку отслеживаемого тайтла**

В блоке, который рендерится при `tracked` (рядом с кнопкой удаления/селектами), добавить:

```tsx
        <div className={styles.searchRow}>
          <button type="button" className={styles.primary} onClick={searchNow} data-testid="search-now">
            Искать сейчас
          </button>
          {searchMsg && <span className={styles.searchMsg}>{searchMsg}</span>}
        </div>
```

- [ ] **Step 4: Стили**

В `apps/web/app/title/[type]/[id]/tracking.module.css` добавить:

```css
.searchRow {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}

.searchMsg {
  color: var(--text-muted);
  font-size: 13px;
}
```

- [ ] **Step 5: Проверить typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/title
git commit -m "feat(web): кнопка «Искать сейчас» на странице тайтла"
```

---

### Task 13: Вкладка настроек «Мониторинг»

**Files:**
- Create: `apps/web/app/settings/MonitoringForm.tsx`
- Modify: `apps/web/app/settings/page.tsx`

- [ ] **Step 1: MonitoringForm**

Создать `apps/web/app/settings/MonitoringForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import styles from "./settings.module.css";

type Values = Record<
  "monitor_interval_min" | "monitor_min_seeders" | "monitor_stall_hours",
  string | null
>;

const FIELDS = [
  { key: "monitor_interval_min", label: "Интервал проверки (мин)", placeholder: "15" },
  { key: "monitor_min_seeders", label: "Минимум сидов", placeholder: "1" },
  { key: "monitor_stall_hours", label: "Таймаут зависания (ч)", placeholder: "6" },
] as const;

export function MonitoringForm({ initial }: { initial: Values }) {
  const [values, setValues] = useState<Values>(initial);
  const [status, setStatus] = useState<string | null>(null);

  async function save() {
    setStatus(null);
    try {
      const payload = Object.fromEntries(FIELDS.map((f) => [f.key, values[f.key]]));
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setStatus(res.ok ? "Сохранено" : "Ошибка сохранения");
    } catch {
      setStatus("Сеть недоступна");
    }
  }

  return (
    <div className={styles.card} data-testid="monitoring-form">
      {FIELDS.map((f) => (
        <label key={f.key} className={styles.field}>
          <span>{f.label}</span>
          <input
            type="number"
            min="0"
            placeholder={f.placeholder}
            value={values[f.key] ?? ""}
            onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
          />
        </label>
      ))}
      <p className={styles.muted}>
        Воркер проверяет отслеживаемое каждые N минут: ищет недостающее в нужной озвучке и
        качестве, скачивает и импортирует. Зависшие дольше таймаута — в чёрный список.
      </p>
      <div className={styles.actions}>
        <button onClick={save}>Сохранить</button>
      </div>
      {status && <p className={status === "Сохранено" ? styles.ok : styles.err}>{status}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Четвёртая вкладка**

В `apps/web/app/settings/page.tsx`:
- импорт: `import { MonitoringForm } from "./MonitoringForm";`
- в `TABS` добавить запись `{ key: "monitoring", label: "Мониторинг" }` (после `folders`);
- расширить вычисление `active`: добавить ветку `tab === "monitoring" ? "monitoring"` перед финальным `"quality"`;
- в рендере контента добавить ветку:

```tsx
      ) : active === "monitoring" ? (
        <MonitoringForm initial={getAllSettings(db)} />
```

(вставить в существующую цепочку тернарников перед последней веткой `SettingsForm`).

- [ ] **Step 3: Проверить typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/settings
git commit -m "feat(web): вкладка настроек «Мониторинг»"
```

---

### Task 14: e2e и README

**Files:**
- Create: `apps/web/e2e/monitoring.spec.ts`
- Modify: `README.md`

- [ ] **Step 1: e2e вкладки «Мониторинг» и кнопки «Искать сейчас»**

Создать `apps/web/e2e/monitoring.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("вкладка «Мониторинг»: сохранение переживает перезагрузку", async ({ page }) => {
  await page.goto("/settings?tab=monitoring");
  await expect(page.getByTestId("monitoring-form")).toBeVisible();

  await page.getByLabel("Интервал проверки (мин)").fill("30");
  await page.getByLabel("Минимум сидов").fill("5");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Сохранено")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Интервал проверки (мин)")).toHaveValue("30");
  await expect(page.getByLabel("Минимум сидов")).toHaveValue("5");
});

test("в настройках видна вкладка «Мониторинг»", async ({ page }) => {
  await page.goto("/settings?tab=integrations");
  await expect(page.getByTestId("settings-tabs").getByText("Мониторинг")).toBeVisible();
});
```

- [ ] **Step 2: Прогнать e2e**

Run: `npm run test:e2e -w @dublyarr/web`
Expected: все спеки PASS, 0 failed (tracking-спека требует TMDB_API_KEY из `.env`).

- [ ] **Step 3: README**

В `README.md` после секции «## Что умеет (M2b)» добавить:

```markdown
## Что умеет (M3a)

- Воркер-процесс (`npm run worker`) на cron-тике: каждые N минут ищет недостающее
  в нужной озвучке и качестве, скачивает через qBittorrent и импортирует в библиотеку.
- Скоринг раздач: ближе к предпочитаемому качеству — выше, tie-break по сидам;
  фильтр по озвучке, allowed-качествам и минимуму сидов.
- Кнопка «Искать сейчас» на странице тайтла — разовый запуск конвейера для тайтла.
- Чёрный список битых/зависших раздач (таймаут настраивается), аудит событий (history).
- Настройки → «Мониторинг»: интервал тика, минимум сидов, таймаут зависания.

Запуск воркера: `npm run worker` (читает ту же БД из `DATA_DIR`, что и веб).
```

- [ ] **Step 4: Полная проверка**

Run: `npm test && npm run typecheck && npm run test:e2e -w @dublyarr/web`
Expected: все unit зелёные, typecheck чистый, e2e без failed.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/monitoring.spec.ts README.md
git commit -m "test(web): e2e вкладки «Мониторинг»; README M3a"
```

---

## Чего сознательно нет в M3a (→ M3b и далее)

- **Апгрейды качества** (файл ниже preferred + upgrade_enabled → докачать лучше → удалить старый) — требуют переработки импортёра (замена файла); M3b.
- **Календарь** и **Активность** (все загрузки + лента history с бейджем-счётчиком в навигации) — M3b.
- **Редактируемые алиасы студий / маппинг трекер→студия** (вкладка «Озвучки») — остаются захардкоженными в `parser.ts` (работают); UI отложен.
- **RSS-мониторинг** — M5+ (по спеке).
- **Дата цифрового релиза фильма из TMDb** для точного «вышел ли фильм» — пока фильм-кандидат = tracked без файлов; уточнение в M3b при календаре.
- **Уведомления, Docker-супервизор двух процессов, CI** — M4.

## Заметки для ревьюеров

- Поллинг по-прежнему делает и веб (GET /api/downloads при открытой странице тайтла), и теперь воркер (`pollTitle` внутри тика). Оба используют один core-код (`poll.ts`); конкурентный доступ к SQLite безопасен (WAL + busy_timeout), а `refreshDownload` перечитывает строку после await (защита от гонок — унаследовано из M2b).
- `runTitle` пишет `history(kind=search)` ДО поиска — это и есть отметка рейт-лимита для `selectCandidates`. «Искать сейчас» зовёт через `rateLimitMinutes: 0`, поэтому игнорирует лимит.
- grab/poll вынесены в core (Задачи 6–7) — это рефактор существующего роута; e2e M2b должны остаться зелёными, иначе регрессия.
- Парсинг даты `createdAt` из SQLite (`datetime('now')` → `"YYYY-MM-DD HH:MM:SS"`) приводится к ISO заменой пробела на `T` и добавлением `Z`; при искусственно выставленном ISO-времени в тестах это тоже корректно.
- Воркер — тонкий рантайм без юнит-тестов; вся тестируемая логика в core. Smoke-проверка (Task 10, Step 6) подтверждает, что процесс стартует и не падает без qBittorrent.
