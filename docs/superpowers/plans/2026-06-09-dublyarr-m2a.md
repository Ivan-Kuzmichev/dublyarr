# Dublyarr M2a — отслеживание и пресеты качества: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавление тайтлов в отслеживание (озвучка + пресет качества + monitor_rule), синк эпизодов из TMDb, страница «Отслеживаемое», бейдж в поиске, редактор пресетов в настройках.

**Architecture:** Новые таблицы `quality_presets`, `titles`, `episodes` (embedded-миграция 0001), репозитории в `packages/core/src/db/`, тонкие API-роуты в `apps/web/app/api/`, RSC-страницы + клиентские формы (fetch + `router.refresh()`). Глобальная лестница качеств — чистый TS-модуль `@dublyarr/core/quality`, безопасный для клиента.

**Tech Stack:** Next.js 15 App Router, Drizzle + better-sqlite3, Vitest, Playwright. CSS Modules, без Tailwind. UI на русском.

**Scope:** Только отслеживание (спека §4–§6, §8 п.1–3, 6-Качество). Скачивание/qBittorrent/files — план M2b. Календарь/активность/воркер — M3.

**Ветка:** работать в ветке `m2a-tracking` от `main`.

---

## Структура файлов

**packages/core:**
- Create: `src/quality.ts` — лестница качеств, ранги, маппинг parsed→key
- Create: `src/db/presets.ts` — CRUD пресетов + валидация
- Create: `src/db/titles.ts` — CRUD тайтлов, синк/выбор эпизодов
- Modify: `src/tmdb.ts` — класс `TmdbError`, таймаут fetch, `getSeasonEpisodes`
- Modify: `src/jackett.ts` — таймаут fetch
- Modify: `src/db/migrations.ts` — миграция `0001_tracking` (3 таблицы + сид 2 пресетов)
- Modify: `src/db/schema.ts` — drizzle-таблицы `qualityPresets`, `titles`, `episodes`
- Modify: `src/db/index.ts` — pragma `foreign_keys = ON`, реэкспорт presets/titles
- Modify: `package.json` — export `"./quality"`
- Test: `test/quality.test.ts`, `test/tmdb.test.ts`, `test/db.test.ts`, `test/presets.test.ts`, `test/titles.test.ts`

**apps/web:**
- Create: `app/api/presets/route.ts` (GET, POST), `app/api/presets/[id]/route.ts` (PATCH, DELETE)
- Create: `app/api/titles/route.ts` (GET, POST), `app/api/titles/[id]/route.ts` (PATCH, DELETE), `app/api/titles/[id]/episodes/route.ts` (PATCH)
- Create: `app/api/studios/route.ts` (GET ?query=) — список студий из Jackett для селекта озвучки
- Modify: `components/PosterCard.tsx` + `PosterCard.module.css` — 4 слота бейджей (tl/tr/bl/br)
- Modify: `app/page.tsx` — страница «Отслеживаемое» (секции Сериалы/Фильмы) + Create: `app/tracked.module.css`
- Modify: `app/search/page.tsx` — бейдж «✓ отслеживается»
- Modify: `app/title/[type]/[id]/page.tsx` — TmdbError + данные трекинга + Create: `app/title/[type]/[id]/TrackingBlock.tsx`, `EpisodeList.tsx`, `tracking.module.css`
- Modify: `app/settings/page.tsx` — вкладки Качество/Интеграции + Create: `app/settings/PresetsEditor.tsx`, расширение `settings.module.css`
- Test: `e2e/presets.spec.ts`, `e2e/tracking.spec.ts`

**Соглашения (повторяют M1):**
- Тесты vitest запускаются `npm test -w @dublyarr/core`, typecheck — `npm run typecheck` (корень), e2e — `npm run test:e2e -w @dublyarr/web` (порт 3100, workers:1, DATA_DIR=./.e2e-data; спеки, требующие TMDb, гейтятся `process.env.TMDB_API_KEY`).
- Импорты внутри core — с расширением `.js` (ESM-спецификаторы поверх .ts, см. extensionAlias в next.config.ts).
- Коммит после каждой задачи.

---

### Task 1: Лестница качеств (`packages/core/src/quality.ts`)

Глобальная фиксированная лестница (спека §4/§6): BDRemux 2160p > WEB-DL 2160p > BDRemux 1080p > BluRay 1080p > BDRip 1080p > WEB-DL 1080p > WEBRip 1080p > HDTV 1080p > 720p > SD. Модуль — чистый TS без зависимостей (его импортирует и клиентский код настроек).

**Files:**
- Create: `packages/core/src/quality.ts`
- Modify: `packages/core/package.json` (exports)
- Test: `packages/core/test/quality.test.ts`

- [ ] **Step 1: Написать падающий тест**

Создать `packages/core/test/quality.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  QUALITY_LADDER,
  highestAllowed,
  qualityKeyFor,
  qualityLabel,
  qualityRank,
} from "../src/quality.js";

describe("QUALITY_LADDER", () => {
  test("порядок: лучшее сверху", () => {
    expect(QUALITY_LADDER.map((q) => q.key)).toEqual([
      "bdremux-2160p",
      "webdl-2160p",
      "bdremux-1080p",
      "bluray-1080p",
      "bdrip-1080p",
      "webdl-1080p",
      "webrip-1080p",
      "hdtv-1080p",
      "720p",
      "sd",
    ]);
  });
});

describe("qualityRank", () => {
  test("выше по лестнице — больше ранг", () => {
    expect(qualityRank("bdremux-2160p")).toBeGreaterThan(qualityRank("webdl-1080p"));
    expect(qualityRank("720p")).toBeGreaterThan(qualityRank("sd"));
  });
  test("неизвестный ключ → -1", () => {
    expect(qualityRank("vhs")).toBe(-1);
  });
});

describe("qualityKeyFor (парсер → ключ лестницы)", () => {
  test("точные совпадения", () => {
    expect(qualityKeyFor("BDRemux", "2160p")).toBe("bdremux-2160p");
    expect(qualityKeyFor("WEB-DL", "2160p")).toBe("webdl-2160p");
    expect(qualityKeyFor("BluRay", "1080p")).toBe("bluray-1080p");
    expect(qualityKeyFor("BDRip", "1080p")).toBe("bdrip-1080p");
    expect(qualityKeyFor("WEB-DL", "1080p")).toBe("webdl-1080p");
    expect(qualityKeyFor("WEBRip", "1080p")).toBe("webrip-1080p");
    expect(qualityKeyFor("HDTV", "1080p")).toBe("hdtv-1080p");
  });
  test("Remux считается BDRemux", () => {
    expect(qualityKeyFor("Remux", "2160p")).toBe("bdremux-2160p");
    expect(qualityKeyFor("Remux", "1080p")).toBe("bdremux-1080p");
  });
  test("неизвестный источник падает в нижнюю ступень разрешения", () => {
    expect(qualityKeyFor("HDRip", "2160p")).toBe("webdl-2160p");
    expect(qualityKeyFor("HDRip", "1080p")).toBe("hdtv-1080p");
    expect(qualityKeyFor(null, "1080p")).toBe("hdtv-1080p");
  });
  test("720p и ниже", () => {
    expect(qualityKeyFor("WEB-DL", "720p")).toBe("720p");
    expect(qualityKeyFor("DVDRip", "480p")).toBe("sd");
    expect(qualityKeyFor("DVDRip", null)).toBe("sd");
  });
  test("совсем ничего → null", () => {
    expect(qualityKeyFor(null, null)).toBeNull();
  });
});

describe("qualityLabel", () => {
  test("человекочитаемая метка", () => {
    expect(qualityLabel("webdl-1080p")).toBe("WEB-DL 1080p");
    expect(qualityLabel("nope")).toBe("nope");
  });
});

describe("highestAllowed", () => {
  test("самое высокое из отмеченных", () => {
    expect(highestAllowed(["hdtv-1080p", "webdl-1080p", "720p"])).toBe("webdl-1080p");
  });
  test("пустой список → null", () => {
    expect(highestAllowed([])).toBeNull();
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -w @dublyarr/core -- quality`
Expected: FAIL — `Cannot find module '../src/quality.js'`

- [ ] **Step 3: Реализация**

Создать `packages/core/src/quality.ts`:

```ts
export interface QualityLevel {
  key: string;
  label: string;
}

export const QUALITY_LADDER: QualityLevel[] = [
  { key: "bdremux-2160p", label: "BDRemux 2160p" },
  { key: "webdl-2160p", label: "WEB-DL 2160p" },
  { key: "bdremux-1080p", label: "BDRemux 1080p" },
  { key: "bluray-1080p", label: "BluRay 1080p" },
  { key: "bdrip-1080p", label: "BDRip 1080p" },
  { key: "webdl-1080p", label: "WEB-DL 1080p" },
  { key: "webrip-1080p", label: "WEBRip 1080p" },
  { key: "hdtv-1080p", label: "HDTV 1080p" },
  { key: "720p", label: "720p" },
  { key: "sd", label: "SD" },
];

export function qualityRank(key: string): number {
  const i = QUALITY_LADDER.findIndex((q) => q.key === key);
  return i === -1 ? -1 : QUALITY_LADDER.length - i;
}

export function qualityLabel(key: string): string {
  return QUALITY_LADDER.find((q) => q.key === key)?.label ?? key;
}

const SOURCE_1080: Record<string, string> = {
  bdremux: "bdremux-1080p",
  remux: "bdremux-1080p",
  bluray: "bluray-1080p",
  bdrip: "bdrip-1080p",
  "web-dl": "webdl-1080p",
  webrip: "webrip-1080p",
  hdtv: "hdtv-1080p",
};

export function qualityKeyFor(
  source: string | null,
  resolution: string | null,
): string | null {
  const src = source?.toLowerCase() ?? null;
  if (resolution === "2160p") {
    return src === "bdremux" || src === "remux" ? "bdremux-2160p" : "webdl-2160p";
  }
  if (resolution === "1080p") {
    return (src && SOURCE_1080[src]) || "hdtv-1080p";
  }
  if (resolution === "720p") return "720p";
  if (resolution) return "sd";
  return source ? "sd" : null;
}

export function highestAllowed(allowed: string[]): string | null {
  let best: string | null = null;
  for (const key of allowed) {
    if (best === null || qualityRank(key) > qualityRank(best)) best = key;
  }
  return best;
}
```

- [ ] **Step 4: Тест зелёный**

Run: `npm test -w @dublyarr/core -- quality`
Expected: PASS (все тесты quality.test.ts)

- [ ] **Step 5: Добавить export в package.json**

В `packages/core/package.json` в `"exports"` добавить строку (после `"./parser"`):

```json
    "./quality": "./src/quality.ts",
```

- [ ] **Step 6: Typecheck и коммит**

Run: `npm run typecheck`
Expected: чисто.

```bash
git add packages/core/src/quality.ts packages/core/test/quality.test.ts packages/core/package.json
git commit -m "feat(core): глобальная лестница качеств (quality.ts)"
```

---

### Task 2: TmdbError + таймауты fetch

Из финального ревью M1: заменить строковый контракт `e.message.includes("404")` на типизированную ошибку; добавить таймауты внешним запросам.

**Files:**
- Modify: `packages/core/src/tmdb.ts`
- Modify: `packages/core/src/jackett.ts`
- Modify: `apps/web/app/title/[type]/[id]/page.tsx`
- Test: `packages/core/test/tmdb.test.ts`

- [ ] **Step 1: Падающий тест на TmdbError**

В `packages/core/test/tmdb.test.ts` добавить в импорт `searchMulti, TmdbError` и `afterEach, vi` из vitest:

```ts
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  TmdbError,
  normalizeDetails,
  normalizeSearchResults,
  searchMulti,
} from "../src/tmdb.js";
```

И добавить в конец файла:

```ts
describe("TmdbError", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("не-2xx ответ → TmdbError со status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response('{"status_message":"not found"}', {
          status: 404,
          statusText: "Not Found",
        }),
      ),
    );
    const err = await searchMulti("x", "key").catch((e) => e);
    expect(err).toBeInstanceOf(TmdbError);
    expect((err as TmdbError).status).toBe(404);
    expect((err as TmdbError).message).toContain("404");
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -w @dublyarr/core -- tmdb`
Expected: FAIL — `TmdbError` не экспортируется.

- [ ] **Step 3: Реализация в tmdb.ts**

В `packages/core/src/tmdb.ts` добавить класс перед `tmdbGet` (после объявления `BASE` и типов):

```ts
export class TmdbError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "TmdbError";
  }
}
```

В `tmdbGet` заменить строки

```ts
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TMDb ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
```

на

```ts
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new TmdbError(
      res.status,
      `TMDb ${res.status} ${res.statusText}: ${body.slice(0, 200)}`,
    );
  }
```

- [ ] **Step 4: Таймаут в jackett.ts**

В `packages/core/src/jackett.ts` в `searchJackett` заменить

```ts
  const res = await fetch(u, { headers: { Accept: "application/xml" } });
```

на

```ts
  const res = await fetch(u, {
    headers: { Accept: "application/xml" },
    signal: AbortSignal.timeout(30_000),
  });
```

- [ ] **Step 5: Тесты зелёные**

Run: `npm test -w @dublyarr/core`
Expected: PASS (все юнит-тесты core).

- [ ] **Step 6: Перевести страницу тайтла на TmdbError**

В `apps/web/app/title/[type]/[id]/page.tsx`:

В импорт из `@dublyarr/core/tmdb` добавить `TmdbError`:

```ts
import { TmdbError, getDetails, posterUrl, type TmdbType } from "@dublyarr/core/tmdb";
```

Заменить catch-блок

```ts
  } catch (e) {
    if (e instanceof Error && e.message.includes("404")) notFound();
    throw e;
  }
```

на

```ts
  } catch (e) {
    if (e instanceof TmdbError && e.status === 404) notFound();
    throw e;
  }
```

- [ ] **Step 7: Typecheck и коммит**

Run: `npm run typecheck`
Expected: чисто.

```bash
git add packages/core/src/tmdb.ts packages/core/src/jackett.ts packages/core/test/tmdb.test.ts "apps/web/app/title/[type]/[id]/page.tsx"
git commit -m "feat(core): TmdbError со статусом + таймауты внешних fetch"
```

---

### Task 3: getSeasonEpisodes (TMDb-эпизоды сезона)

**Files:**
- Modify: `packages/core/src/tmdb.ts`
- Test: `packages/core/test/tmdb.test.ts`

- [ ] **Step 1: Падающий тест**

В `packages/core/test/tmdb.test.ts` добавить `normalizeSeasonEpisodes` в импорт из `../src/tmdb.js` и в конец файла:

```ts
describe("normalizeSeasonEpisodes", () => {
  test("маппит эпизоды сезона", () => {
    const out = normalizeSeasonEpisodes({
      season_number: 1,
      episodes: [
        { season_number: 1, episode_number: 1, air_date: "2013-12-02", name: "Пилот" },
        { season_number: 1, episode_number: 2, air_date: null, name: "" },
      ],
    });
    expect(out).toEqual([
      { season: 1, episode: 1, airDate: "2013-12-02", name: "Пилот" },
      { season: 1, episode: 2, airDate: null, name: "" },
    ]);
  });

  test("нет episodes → пустой массив", () => {
    expect(normalizeSeasonEpisodes({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -w @dublyarr/core -- tmdb`
Expected: FAIL — `normalizeSeasonEpisodes` не экспортируется.

- [ ] **Step 3: Реализация**

В `packages/core/src/tmdb.ts` добавить в конец файла:

```ts
export interface TmdbEpisode {
  season: number;
  episode: number;
  airDate: string | null;
  name: string;
}

export function normalizeSeasonEpisodes(data: any): TmdbEpisode[] {
  return ((data.episodes ?? []) as any[]).map((e) => ({
    season: e.season_number,
    episode: e.episode_number,
    airDate: e.air_date || null,
    name: e.name || "",
  }));
}

export async function getSeasonEpisodes(
  tvId: number,
  season: number,
  apiKey: string,
): Promise<TmdbEpisode[]> {
  const data = await tmdbGet(`/tv/${tvId}/season/${season}`, {}, apiKey);
  return normalizeSeasonEpisodes(data);
}
```

(Примечание: файл уже содержит `/* eslint-disable @typescript-eslint/no-explicit-any */` выше по тексту — `any` допустим.)

- [ ] **Step 4: Тест зелёный**

Run: `npm test -w @dublyarr/core -- tmdb`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add packages/core/src/tmdb.ts packages/core/test/tmdb.test.ts
git commit -m "feat(core): getSeasonEpisodes — эпизоды сезона из TMDb"
```

---

### Task 4: Миграция 0001 + drizzle-схема + foreign_keys

Таблицы `quality_presets`, `titles`, `episodes` (спека §4) + сид двух пресетов («FullHD», «4K»), pragma `foreign_keys = ON` и тест идемпотентности миграций (из ревью M1). Колонка `episodes.file_id` пока без FK — таблица `files` появится в M2b (SQLite не умеет ADD CONSTRAINT, мягкая ссылка как в Sonarr).

**Files:**
- Modify: `packages/core/src/db/migrations.ts`
- Modify: `packages/core/src/db/schema.ts`
- Modify: `packages/core/src/db/index.ts`
- Test: `packages/core/test/db.test.ts`

- [ ] **Step 1: Падающие тесты**

В `packages/core/test/db.test.ts` добавить в конец файла:

```ts
describe("миграция 0001_tracking", () => {
  test("foreign_keys включён", () => {
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  test("таблицы созданы, пресеты засеяны", () => {
    const names = (
      sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
        .all() as { name: string }[]
    ).map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining(["quality_presets", "titles", "episodes"]),
    );
    const presets = sqlite
      .prepare(`SELECT name FROM quality_presets ORDER BY id`)
      .all() as { name: string }[];
    expect(presets.map((p) => p.name)).toEqual(["FullHD", "4K"]);
  });

  test("повторное открытие БД идемпотентно", () => {
    const second = openDb(join(dir, "test.db"));
    const presets = second.sqlite
      .prepare(`SELECT count(*) AS n FROM quality_presets`)
      .get() as { n: number };
    expect(presets.n).toBe(2);
    second.sqlite.close();
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test -w @dublyarr/core -- db`
Expected: FAIL — `foreign_keys` = 0, таблиц нет.

- [ ] **Step 3: Миграция**

В `packages/core/src/db/migrations.ts` добавить элемент в массив `migrations` после `0000_init`:

```ts
  {
    id: "0001_tracking",
    sql: `CREATE TABLE quality_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      allowed TEXT NOT NULL,
      preferred TEXT NOT NULL,
      upgrade_enabled INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE titles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tmdb_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('movie','tv')),
      title_ru TEXT NOT NULL,
      title_original TEXT NOT NULL,
      year TEXT NOT NULL DEFAULT '',
      poster_path TEXT,
      overview TEXT NOT NULL DEFAULT '',
      tmdb_status TEXT,
      tracked INTEGER NOT NULL DEFAULT 1,
      quality_preset_id INTEGER NOT NULL REFERENCES quality_presets(id) ON DELETE RESTRICT,
      voiceover TEXT NOT NULL DEFAULT 'any',
      monitor_rule TEXT NOT NULL DEFAULT 'all' CHECK (monitor_rule IN ('all','future_only','manual')),
      root_folder TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (tmdb_id, type)
    );
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
      season INTEGER NOT NULL,
      episode INTEGER NOT NULL,
      air_date TEXT,
      name_ru TEXT NOT NULL DEFAULT '',
      wanted INTEGER NOT NULL DEFAULT 0,
      file_id INTEGER,
      UNIQUE (title_id, season, episode)
    );
    INSERT INTO quality_presets (name, allowed, preferred, upgrade_enabled) VALUES
      ('FullHD', '["bluray-1080p","bdrip-1080p","webdl-1080p","webrip-1080p","hdtv-1080p"]', 'webdl-1080p', 0),
      ('4K', '["bdremux-2160p","webdl-2160p","bdremux-1080p","webdl-1080p"]', 'bdremux-2160p', 1);`,
  },
```

- [ ] **Step 4: Pragma foreign_keys**

В `packages/core/src/db/index.ts` в `openDb` после строки `sqlite.pragma("busy_timeout = 5000");` добавить:

```ts
  sqlite.pragma("foreign_keys = ON");
```

- [ ] **Step 5: Drizzle-схема**

Заменить содержимое `packages/core/src/db/schema.ts` целиком на:

```ts
import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const qualityPresets = sqliteTable("quality_presets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  allowed: text("allowed").notNull(),
  preferred: text("preferred").notNull(),
  upgradeEnabled: integer("upgrade_enabled").notNull().default(0),
});

export const titles = sqliteTable(
  "titles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tmdbId: integer("tmdb_id").notNull(),
    type: text("type", { enum: ["movie", "tv"] }).notNull(),
    titleRu: text("title_ru").notNull(),
    titleOriginal: text("title_original").notNull(),
    year: text("year").notNull().default(""),
    posterPath: text("poster_path"),
    overview: text("overview").notNull().default(""),
    tmdbStatus: text("tmdb_status"),
    tracked: integer("tracked").notNull().default(1),
    qualityPresetId: integer("quality_preset_id")
      .notNull()
      .references(() => qualityPresets.id),
    voiceover: text("voiceover").notNull().default("any"),
    monitorRule: text("monitor_rule", { enum: ["all", "future_only", "manual"] })
      .notNull()
      .default("all"),
    rootFolder: text("root_folder"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [uniqueIndex("titles_tmdb_unique").on(t.tmdbId, t.type)],
);

export const episodes = sqliteTable(
  "episodes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    titleId: integer("title_id")
      .notNull()
      .references(() => titles.id, { onDelete: "cascade" }),
    season: integer("season").notNull(),
    episode: integer("episode").notNull(),
    airDate: text("air_date"),
    nameRu: text("name_ru").notNull().default(""),
    wanted: integer("wanted").notNull().default(0),
    fileId: integer("file_id"),
  },
  (t) => [uniqueIndex("episodes_unique").on(t.titleId, t.season, t.episode)],
);
```

- [ ] **Step 6: Тесты зелёные**

Run: `npm test -w @dublyarr/core -- db`
Expected: PASS (включая старые тесты settings).

- [ ] **Step 7: Typecheck и коммит**

Run: `npm run typecheck`
Expected: чисто.

```bash
git add packages/core/src/db/migrations.ts packages/core/src/db/schema.ts packages/core/src/db/index.ts packages/core/test/db.test.ts
git commit -m "feat(core): миграция 0001 — quality_presets, titles, episodes + foreign_keys"
```

---

### Task 5: Репозиторий пресетов (`packages/core/src/db/presets.ts`)

**Files:**
- Create: `packages/core/src/db/presets.ts`
- Modify: `packages/core/src/db/index.ts` (реэкспорт)
- Test: `packages/core/test/presets.test.ts`

- [ ] **Step 1: Падающий тест**

Создать `packages/core/test/presets.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { openDb } from "../src/db/index.js";
import {
  createPreset,
  deletePreset,
  getPreset,
  listPresets,
  updatePreset,
} from "../src/db/presets.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-presets-"));
const { db, sqlite } = openDb(join(dir, "test.db"));

afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("listPresets / getPreset", () => {
  test("видит засеянные пресеты с распарсенным allowed", () => {
    const all = listPresets(db);
    expect(all.map((p) => p.name)).toEqual(["FullHD", "4K"]);
    expect(all[0].allowed).toContain("webdl-1080p");
    expect(all[0].preferred).toBe("webdl-1080p");
    expect(all[0].upgradeEnabled).toBe(false);
    expect(all[1].upgradeEnabled).toBe(true);
    expect(getPreset(db, all[0].id)?.name).toBe("FullHD");
    expect(getPreset(db, 9999)).toBeNull();
  });
});

describe("createPreset", () => {
  test("создаёт валидный пресет", () => {
    const r = createPreset(db, {
      name: "720p эконом",
      allowed: ["720p", "sd"],
      preferred: "720p",
      upgradeEnabled: false,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.preset.id).toBeGreaterThan(0);
  });

  test("отклоняет preferred вне allowed", () => {
    const r = createPreset(db, {
      name: "Битый",
      allowed: ["720p"],
      preferred: "webdl-1080p",
      upgradeEnabled: false,
    });
    expect(r).toEqual({ ok: false, error: "Предпочитаемое качество должно быть среди отмеченных" });
  });

  test("отклоняет неизвестный ключ качества и пустые поля", () => {
    expect(
      createPreset(db, { name: "X", allowed: ["vhs"], preferred: "vhs", upgradeEnabled: false }).ok,
    ).toBe(false);
    expect(
      createPreset(db, { name: " ", allowed: ["720p"], preferred: "720p", upgradeEnabled: false }).ok,
    ).toBe(false);
    expect(
      createPreset(db, { name: "Y", allowed: [], preferred: "720p", upgradeEnabled: false }).ok,
    ).toBe(false);
  });

  test("отклоняет дубль имени", () => {
    const r = createPreset(db, {
      name: "FullHD",
      allowed: ["720p"],
      preferred: "720p",
      upgradeEnabled: false,
    });
    expect(r.ok).toBe(false);
  });
});

describe("updatePreset / deletePreset", () => {
  test("обновляет пресет", () => {
    const id = listPresets(db).find((p) => p.name === "720p эконом")!.id;
    const r = updatePreset(db, id, {
      name: "720p эконом",
      allowed: ["webdl-1080p", "720p"],
      preferred: "webdl-1080p",
      upgradeEnabled: true,
    });
    expect(r.ok).toBe(true);
    expect(getPreset(db, id)?.upgradeEnabled).toBe(true);
  });

  test("удаляет неиспользуемый пресет", () => {
    const id = listPresets(db).find((p) => p.name === "720p эконом")!.id;
    expect(deletePreset(db, id)).toEqual({ ok: true });
    expect(getPreset(db, id)).toBeNull();
  });

  test("отказывается удалять пресет, на который ссылается тайтл", () => {
    const presetId = listPresets(db)[0].id;
    sqlite
      .prepare(
        `INSERT INTO titles (tmdb_id, type, title_ru, title_original, quality_preset_id)
         VALUES (1, 'movie', 'Тест', 'Test', ?)`,
      )
      .run(presetId);
    const r = deletePreset(db, presetId);
    expect(r.ok).toBe(false);
    sqlite.prepare(`DELETE FROM titles WHERE tmdb_id = 1`).run();
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -w @dublyarr/core -- presets`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализация**

Создать `packages/core/src/db/presets.ts`:

```ts
import { eq } from "drizzle-orm";
import { QUALITY_LADDER } from "../quality.js";
import type { Db } from "./index.js";
import { qualityPresets } from "./schema.js";

export interface QualityPreset {
  id: number;
  name: string;
  allowed: string[];
  preferred: string;
  upgradeEnabled: boolean;
}

export interface PresetInput {
  name: string;
  allowed: string[];
  preferred: string;
  upgradeEnabled: boolean;
}

export type PresetResult =
  | { ok: true; preset: QualityPreset }
  | { ok: false; error: string };

type Row = typeof qualityPresets.$inferSelect;

function rowToPreset(row: Row): QualityPreset {
  return {
    id: row.id,
    name: row.name,
    allowed: JSON.parse(row.allowed) as string[],
    preferred: row.preferred,
    upgradeEnabled: row.upgradeEnabled === 1,
  };
}

function validate(input: PresetInput): string | null {
  if (!input.name.trim()) return "Укажите имя пресета";
  if (input.allowed.length === 0) return "Отметьте хотя бы одно качество";
  const known = new Set(QUALITY_LADDER.map((q) => q.key));
  for (const key of input.allowed) {
    if (!known.has(key)) return `Неизвестное качество: ${key}`;
  }
  if (!input.allowed.includes(input.preferred)) {
    return "Предпочитаемое качество должно быть среди отмеченных";
  }
  return null;
}

function toRow(input: PresetInput) {
  return {
    name: input.name.trim(),
    allowed: JSON.stringify(input.allowed),
    preferred: input.preferred,
    upgradeEnabled: input.upgradeEnabled ? 1 : 0,
  };
}

export function listPresets(db: Db): QualityPreset[] {
  return db.select().from(qualityPresets).all().map(rowToPreset);
}

export function getPreset(db: Db, id: number): QualityPreset | null {
  const row = db.select().from(qualityPresets).where(eq(qualityPresets.id, id)).get();
  return row ? rowToPreset(row) : null;
}

export function createPreset(db: Db, input: PresetInput): PresetResult {
  const error = validate(input);
  if (error) return { ok: false, error };
  try {
    const row = db.insert(qualityPresets).values(toRow(input)).returning().get();
    return { ok: true, preset: rowToPreset(row) };
  } catch {
    return { ok: false, error: "Пресет с таким именем уже существует" };
  }
}

export function updatePreset(db: Db, id: number, input: PresetInput): PresetResult {
  const error = validate(input);
  if (error) return { ok: false, error };
  try {
    const row = db
      .update(qualityPresets)
      .set(toRow(input))
      .where(eq(qualityPresets.id, id))
      .returning()
      .get();
    if (!row) return { ok: false, error: "Пресет не найден" };
    return { ok: true, preset: rowToPreset(row) };
  } catch {
    return { ok: false, error: "Пресет с таким именем уже существует" };
  }
}

export function deletePreset(db: Db, id: number): { ok: boolean; error?: string } {
  try {
    db.delete(qualityPresets).where(eq(qualityPresets.id, id)).run();
    return { ok: true };
  } catch {
    return { ok: false, error: "Пресет используется отслеживаемыми тайтлами" };
  }
}
```

В `packages/core/src/db/index.ts` добавить в конец:

```ts
export * from "./presets.js";
```

- [ ] **Step 4: Тесты зелёные**

Run: `npm test -w @dublyarr/core -- presets`
Expected: PASS

- [ ] **Step 5: Typecheck и коммит**

Run: `npm run typecheck`
Expected: чисто.

```bash
git add packages/core/src/db/presets.ts packages/core/src/db/index.ts packages/core/test/presets.test.ts
git commit -m "feat(core): CRUD пресетов качества с валидацией"
```

---

### Task 6: Репозиторий тайтлов и эпизодов (`packages/core/src/db/titles.ts`)

**Files:**
- Create: `packages/core/src/db/titles.ts`
- Modify: `packages/core/src/db/index.ts` (реэкспорт)
- Test: `packages/core/test/titles.test.ts`

- [ ] **Step 1: Падающий тест**

Создать `packages/core/test/titles.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { openDb } from "../src/db/index.js";
import { listPresets } from "../src/db/presets.js";
import {
  addTitle,
  deleteTitle,
  getTitle,
  getTitleByTmdb,
  listEpisodes,
  listTrackedTitles,
  listTrackedTmdbKeys,
  setEpisodesWanted,
  setSeasonWanted,
  syncEpisodes,
  updateTitle,
} from "../src/db/titles.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-titles-"));
const { db, sqlite } = openDb(join(dir, "test.db"));
const presetId = listPresets(db)[0].id;

afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const rick = {
  tmdbId: 60625,
  type: "tv" as const,
  titleRu: "Рик и Морти",
  titleOriginal: "Rick and Morty",
  year: "2013",
  posterPath: "/poster.jpg",
  overview: "Учёный Рик...",
  tmdbStatus: "Returning Series",
  qualityPresetId: presetId,
  voiceover: "Сыендук",
  monitorRule: "all" as const,
};

describe("addTitle / get / list", () => {
  test("добавляет и находит тайтл", () => {
    const t = addTitle(db, rick);
    expect(t.id).toBeGreaterThan(0);
    expect(getTitle(db, t.id)?.titleRu).toBe("Рик и Морти");
    expect(getTitleByTmdb(db, "tv", 60625)?.id).toBe(t.id);
    expect(getTitleByTmdb(db, "movie", 60625)).toBeNull();
    expect(listTrackedTitles(db).map((x) => x.tmdbId)).toEqual([60625]);
    expect(listTrackedTmdbKeys(db)).toEqual(new Set(["tv:60625"]));
  });

  test("дубль (tmdb_id, type) бросает", () => {
    expect(() => addTitle(db, rick)).toThrow();
  });
});

describe("syncEpisodes", () => {
  const titleId = () => getTitleByTmdb(db, "tv", 60625)!.id;
  const eps = [
    { season: 1, episode: 1, airDate: "2013-12-02", name: "Пилот" },
    { season: 1, episode: 2, airDate: "2013-12-09", name: "Пёс-газонокосильщик" },
    { season: 2, episode: 1, airDate: "2099-01-01", name: "Будущая серия" },
    { season: 2, episode: 2, airDate: null, name: "Без даты" },
  ];

  test("monitor_rule=all → все wanted", () => {
    syncEpisodes(db, titleId(), eps, "all", "2026-06-09");
    const rows = listEpisodes(db, titleId());
    expect(rows).toHaveLength(4);
    expect(rows.every((e) => e.wanted)).toBe(true);
  });

  test("повторный синк не трогает ручные wanted, обновляет метаданные", () => {
    const first = listEpisodes(db, titleId())[0];
    setEpisodesWanted(db, titleId(), [first.id], false);
    syncEpisodes(
      db,
      titleId(),
      [{ season: 1, episode: 1, airDate: "2013-12-02", name: "Пилот (обновлено)" }],
      "all",
      "2026-06-09",
    );
    const rows = listEpisodes(db, titleId());
    const e11 = rows.find((e) => e.season === 1 && e.episode === 1)!;
    expect(e11.wanted).toBe(false);
    expect(e11.nameRu).toBe("Пилот (обновлено)");
    expect(rows).toHaveLength(4);
  });

  test("monitor_rule=future_only → wanted только будущие и без даты", () => {
    const t = addTitle(db, { ...rick, tmdbId: 1399, titleRu: "Игра престолов", titleOriginal: "Game of Thrones", monitorRule: "future_only" });
    syncEpisodes(db, t.id, eps, "future_only", "2026-06-09");
    const bySeason = listEpisodes(db, t.id);
    expect(bySeason.find((e) => e.season === 1 && e.episode === 1)!.wanted).toBe(false);
    expect(bySeason.find((e) => e.season === 2 && e.episode === 1)!.wanted).toBe(true);
    expect(bySeason.find((e) => e.season === 2 && e.episode === 2)!.wanted).toBe(true);
  });

  test("monitor_rule=manual → ничего не wanted", () => {
    const t = addTitle(db, { ...rick, tmdbId: 456, titleRu: "Симпсоны", titleOriginal: "The Simpsons", monitorRule: "manual" });
    syncEpisodes(db, t.id, eps, "manual", "2026-06-09");
    expect(listEpisodes(db, t.id).some((e) => e.wanted)).toBe(false);
  });
});

describe("setSeasonWanted / updateTitle / deleteTitle", () => {
  test("сезон целиком", () => {
    const id = getTitleByTmdb(db, "tv", 456)!.id;
    setSeasonWanted(db, id, 1, true);
    const rows = listEpisodes(db, id);
    expect(rows.filter((e) => e.season === 1).every((e) => e.wanted)).toBe(true);
    expect(rows.filter((e) => e.season === 2).some((e) => e.wanted)).toBe(false);
  });

  test("updateTitle меняет озвучку/правило", () => {
    const id = getTitleByTmdb(db, "tv", 60625)!.id;
    const t = updateTitle(db, id, { voiceover: "any", monitorRule: "manual" });
    expect(t?.voiceover).toBe("any");
    expect(t?.monitorRule).toBe("manual");
  });

  test("deleteTitle каскадно удаляет эпизоды", () => {
    const id = getTitleByTmdb(db, "tv", 456)!.id;
    deleteTitle(db, id);
    expect(getTitle(db, id)).toBeNull();
    const n = sqlite
      .prepare(`SELECT count(*) AS n FROM episodes WHERE title_id = ?`)
      .get(id) as { n: number };
    expect(n.n).toBe(0);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test -w @dublyarr/core -- titles`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализация**

Создать `packages/core/src/db/titles.ts`:

```ts
import { and, asc, eq, inArray } from "drizzle-orm";
import type { TmdbEpisode } from "../tmdb.js";
import type { Db } from "./index.js";
import { episodes, titles } from "./schema.js";

export type MonitorRule = "all" | "future_only" | "manual";
export type TitleType = "movie" | "tv";

export type Title = typeof titles.$inferSelect;

export interface TitleInput {
  tmdbId: number;
  type: TitleType;
  titleRu: string;
  titleOriginal: string;
  year: string;
  posterPath: string | null;
  overview: string;
  tmdbStatus: string | null;
  qualityPresetId: number;
  voiceover: string;
  monitorRule: MonitorRule;
}

export interface Episode {
  id: number;
  titleId: number;
  season: number;
  episode: number;
  airDate: string | null;
  nameRu: string;
  wanted: boolean;
  fileId: number | null;
}

export function addTitle(db: Db, input: TitleInput): Title {
  return db.insert(titles).values(input).returning().get();
}

export function getTitle(db: Db, id: number): Title | null {
  return db.select().from(titles).where(eq(titles.id, id)).get() ?? null;
}

export function getTitleByTmdb(db: Db, type: TitleType, tmdbId: number): Title | null {
  return (
    db
      .select()
      .from(titles)
      .where(and(eq(titles.type, type), eq(titles.tmdbId, tmdbId)))
      .get() ?? null
  );
}

export function listTrackedTitles(db: Db): Title[] {
  return db
    .select()
    .from(titles)
    .where(eq(titles.tracked, 1))
    .orderBy(asc(titles.titleRu))
    .all();
}

/** Ключи вида "tv:60625" для бейджа «✓ отслеживается» в поиске. */
export function listTrackedTmdbKeys(db: Db): Set<string> {
  const rows = db
    .select({ type: titles.type, tmdbId: titles.tmdbId })
    .from(titles)
    .where(eq(titles.tracked, 1))
    .all();
  return new Set(rows.map((r) => `${r.type}:${r.tmdbId}`));
}

export interface TitlePatch {
  voiceover?: string;
  qualityPresetId?: number;
  monitorRule?: MonitorRule;
}

export function updateTitle(db: Db, id: number, patch: TitlePatch): Title | null {
  if (Object.keys(patch).length === 0) return getTitle(db, id);
  return (
    db.update(titles).set(patch).where(eq(titles.id, id)).returning().get() ?? null
  );
}

export function deleteTitle(db: Db, id: number): void {
  db.delete(titles).where(eq(titles.id, id)).run();
}

function wantedFor(rule: MonitorRule, airDate: string | null, today: string): number {
  if (rule === "manual") return 0;
  if (rule === "all") return 1;
  return airDate === null || airDate > today ? 1 : 0;
}

/** Upsert эпизодов из TMDb: метаданные обновляются, wanted у существующих не трогаем. */
export function syncEpisodes(
  db: Db,
  titleId: number,
  eps: TmdbEpisode[],
  rule: MonitorRule,
  today: string = new Date().toISOString().slice(0, 10),
): void {
  for (const e of eps) {
    db.insert(episodes)
      .values({
        titleId,
        season: e.season,
        episode: e.episode,
        airDate: e.airDate,
        nameRu: e.name,
        wanted: wantedFor(rule, e.airDate, today),
      })
      .onConflictDoUpdate({
        target: [episodes.titleId, episodes.season, episodes.episode],
        set: { airDate: e.airDate, nameRu: e.name },
      })
      .run();
  }
}

function rowToEpisode(row: typeof episodes.$inferSelect): Episode {
  return { ...row, wanted: row.wanted === 1 };
}

export function listEpisodes(db: Db, titleId: number): Episode[] {
  return db
    .select()
    .from(episodes)
    .where(eq(episodes.titleId, titleId))
    .orderBy(asc(episodes.season), asc(episodes.episode))
    .all()
    .map(rowToEpisode);
}

export function setEpisodesWanted(
  db: Db,
  titleId: number,
  episodeIds: number[],
  wanted: boolean,
): void {
  if (episodeIds.length === 0) return;
  db.update(episodes)
    .set({ wanted: wanted ? 1 : 0 })
    .where(and(eq(episodes.titleId, titleId), inArray(episodes.id, episodeIds)))
    .run();
}

export function setSeasonWanted(
  db: Db,
  titleId: number,
  season: number,
  wanted: boolean,
): void {
  db.update(episodes)
    .set({ wanted: wanted ? 1 : 0 })
    .where(and(eq(episodes.titleId, titleId), eq(episodes.season, season)))
    .run();
}
```

В `packages/core/src/db/index.ts` добавить в конец:

```ts
export * from "./titles.js";
```

- [ ] **Step 4: Тесты зелёные**

Run: `npm test -w @dublyarr/core`
Expected: PASS (весь пакет core).

- [ ] **Step 5: Typecheck и коммит**

Run: `npm run typecheck`
Expected: чисто.

```bash
git add packages/core/src/db/titles.ts packages/core/src/db/index.ts packages/core/test/titles.test.ts
git commit -m "feat(core): репозиторий тайтлов и эпизодов с синком из TMDb"
```

---

### Task 7: API пресетов (`/api/presets`)

Тонкие роуты поверх репозитория (логика и валидация уже протестированы в core; роуты покрываются e2e в Task 14 — паттерн M1).

**Files:**
- Create: `apps/web/app/api/presets/route.ts`
- Create: `apps/web/app/api/presets/[id]/route.ts`

- [ ] **Step 1: Создать `apps/web/app/api/presets/route.ts`**

```ts
import { NextResponse } from "next/server";
import { createPreset, listPresets, type PresetInput } from "@dublyarr/core/db";
import { getDb } from "@/server/db";

export async function GET() {
  return NextResponse.json(listPresets(getDb()));
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<PresetInput>;
  const input: PresetInput = {
    name: typeof body.name === "string" ? body.name : "",
    allowed: Array.isArray(body.allowed) ? body.allowed.filter((k) => typeof k === "string") : [],
    preferred: typeof body.preferred === "string" ? body.preferred : "",
    upgradeEnabled: body.upgradeEnabled === true,
  };
  const r = createPreset(getDb(), input);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json(r.preset, { status: 201 });
}
```

- [ ] **Step 2: Создать `apps/web/app/api/presets/[id]/route.ts`**

```ts
import { NextResponse } from "next/server";
import { deletePreset, updatePreset, type PresetInput } from "@dublyarr/core/db";
import { getDb } from "@/server/db";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const body = (await req.json()) as Partial<PresetInput>;
  const input: PresetInput = {
    name: typeof body.name === "string" ? body.name : "",
    allowed: Array.isArray(body.allowed) ? body.allowed.filter((k) => typeof k === "string") : [],
    preferred: typeof body.preferred === "string" ? body.preferred : "",
    upgradeEnabled: body.upgradeEnabled === true,
  };
  const r = updatePreset(getDb(), id, input);
  if (!r.ok) {
    const status = r.error === "Пресет не найден" ? 404 : 400;
    return NextResponse.json({ error: r.error }, { status });
  }
  return NextResponse.json(r.preset);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const r = deletePreset(getDb(), id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Проверка вручную**

Run: `npm run typecheck` — чисто. Затем `npm run dev` (фоном) и:

```bash
curl -s localhost:3000/api/presets | head -c 300
```

Expected: JSON-массив с пресетами «FullHD» и «4K». Остановить dev-сервер.

- [ ] **Step 4: Коммит**

```bash
git add apps/web/app/api/presets
git commit -m "feat(web): API пресетов качества"
```

---

### Task 8: API тайтлов и студий (`/api/titles`, `/api/studios`)

POST /api/titles тянет детали из TMDb, создаёт тайтл и (для сериалов) синкает эпизоды всех сезонов. GET /api/studios возвращает студии озвучки из Jackett для селекта (Jackett не настроен/недоступен → пустой список, не ошибка).

**Files:**
- Create: `apps/web/app/api/titles/route.ts`
- Create: `apps/web/app/api/titles/[id]/route.ts`
- Create: `apps/web/app/api/titles/[id]/episodes/route.ts`
- Create: `apps/web/app/api/studios/route.ts`

- [ ] **Step 1: Создать `apps/web/app/api/titles/route.ts`**

```ts
import { NextResponse } from "next/server";
import {
  addTitle,
  getPreset,
  getSetting,
  getTitleByTmdb,
  listTrackedTitles,
  syncEpisodes,
  type MonitorRule,
  type TitleType,
} from "@dublyarr/core/db";
import { TmdbError, getDetails, getSeasonEpisodes, type TmdbEpisode } from "@dublyarr/core/tmdb";
import { getDb } from "@/server/db";

export async function GET() {
  return NextResponse.json(listTrackedTitles(getDb()));
}

const MONITOR_RULES = new Set(["all", "future_only", "manual"]);

export async function POST(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  const type = body.type === "movie" || body.type === "tv" ? (body.type as TitleType) : null;
  const tmdbId = Number(body.tmdbId);
  const qualityPresetId = Number(body.qualityPresetId);
  const voiceover = typeof body.voiceover === "string" && body.voiceover.trim() ? body.voiceover.trim() : "any";
  const monitorRule = MONITOR_RULES.has(String(body.monitorRule))
    ? (body.monitorRule as MonitorRule)
    : "all";

  if (!type || !Number.isInteger(tmdbId) || tmdbId <= 0) {
    return NextResponse.json({ error: "Некорректные type/tmdbId" }, { status: 400 });
  }
  const db = getDb();
  if (!getPreset(db, qualityPresetId)) {
    return NextResponse.json({ error: "Пресет не найден" }, { status: 400 });
  }
  if (getTitleByTmdb(db, type, tmdbId)) {
    return NextResponse.json({ error: "Уже отслеживается" }, { status: 409 });
  }
  const apiKey = getSetting(db, "tmdb_api_key");
  if (!apiKey) {
    return NextResponse.json({ error: "TMDb API ключ не настроен" }, { status: 400 });
  }

  try {
    const details = await getDetails(type, tmdbId, apiKey);
    const title = addTitle(db, {
      tmdbId,
      type,
      titleRu: details.title,
      titleOriginal: details.originalTitle,
      year: details.year,
      posterPath: details.posterPath,
      overview: details.overview,
      tmdbStatus: details.status,
      qualityPresetId,
      voiceover,
      monitorRule,
    });
    if (type === "tv" && details.seasons) {
      const eps: TmdbEpisode[] = [];
      for (let s = 1; s <= details.seasons; s++) {
        eps.push(...(await getSeasonEpisodes(tmdbId, s, apiKey)));
      }
      syncEpisodes(db, title.id, eps, monitorRule);
    }
    return NextResponse.json(title, { status: 201 });
  } catch (e) {
    if (e instanceof TmdbError && e.status === 404) {
      return NextResponse.json({ error: "Тайтл не найден в TMDb" }, { status: 404 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
```

- [ ] **Step 2: Создать `apps/web/app/api/titles/[id]/route.ts`**

```ts
import { NextResponse } from "next/server";
import {
  deleteTitle,
  getPreset,
  getTitle,
  updateTitle,
  type MonitorRule,
  type TitlePatch,
} from "@dublyarr/core/db";
import { getDb } from "@/server/db";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const MONITOR_RULES = new Set(["all", "future_only", "manual"]);

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const db = getDb();
  if (!getTitle(db, id)) return NextResponse.json({ error: "Не найдено" }, { status: 404 });

  const body = (await req.json()) as Record<string, unknown>;
  const patch: TitlePatch = {};
  if (typeof body.voiceover === "string" && body.voiceover.trim()) {
    patch.voiceover = body.voiceover.trim();
  }
  if (body.qualityPresetId !== undefined) {
    const presetId = Number(body.qualityPresetId);
    if (!getPreset(db, presetId)) {
      return NextResponse.json({ error: "Пресет не найден" }, { status: 400 });
    }
    patch.qualityPresetId = presetId;
  }
  if (body.monitorRule !== undefined) {
    if (!MONITOR_RULES.has(String(body.monitorRule))) {
      return NextResponse.json({ error: "Некорректный monitor_rule" }, { status: 400 });
    }
    patch.monitorRule = body.monitorRule as MonitorRule;
  }
  return NextResponse.json(updateTitle(db, id, patch));
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  deleteTitle(getDb(), id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Создать `apps/web/app/api/titles/[id]/episodes/route.ts`**

Body: `{ wanted: boolean }` + либо `episodeIds: number[]`, либо `season: number`.

```ts
import { NextResponse } from "next/server";
import { getTitle, listEpisodes, setEpisodesWanted, setSeasonWanted } from "@dublyarr/core/db";
import { getDb } from "@/server/db";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  }
  const db = getDb();
  if (!getTitle(db, id)) return NextResponse.json({ error: "Не найдено" }, { status: 404 });

  const body = (await req.json()) as Record<string, unknown>;
  if (typeof body.wanted !== "boolean") {
    return NextResponse.json({ error: "Поле wanted обязательно" }, { status: 400 });
  }
  if (Array.isArray(body.episodeIds)) {
    const ids = body.episodeIds.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    setEpisodesWanted(db, id, ids, body.wanted);
  } else if (body.season !== undefined && Number.isInteger(Number(body.season))) {
    setSeasonWanted(db, id, Number(body.season), body.wanted);
  } else {
    return NextResponse.json({ error: "Укажите episodeIds или season" }, { status: 400 });
  }
  return NextResponse.json(listEpisodes(db, id));
}
```

- [ ] **Step 4: Создать `apps/web/app/api/studios/route.ts`**

```ts
import { NextResponse } from "next/server";
import { getSetting } from "@dublyarr/core/db";
import { searchJackett } from "@dublyarr/core/jackett";
import { parseRelease, summarizeStudioAvailability } from "@dublyarr/core/parser";
import { getDb } from "@/server/db";

export async function GET(req: Request) {
  const query = new URL(req.url).searchParams.get("query")?.trim();
  if (!query) return NextResponse.json({ studios: [] });
  const db = getDb();
  const url = getSetting(db, "jackett_url");
  const apiKey = getSetting(db, "jackett_api_key");
  if (!url || !apiKey) return NextResponse.json({ studios: [] });
  try {
    const releases = (await searchJackett({ url, apiKey }, query)).map(parseRelease);
    const studios = [...new Set(summarizeStudioAvailability(releases).map((r) => r.studio))];
    return NextResponse.json({ studios });
  } catch {
    return NextResponse.json({ studios: [] });
  }
}
```

- [ ] **Step 5: Typecheck и коммит**

Run: `npm run typecheck`
Expected: чисто.

```bash
git add apps/web/app/api/titles apps/web/app/api/studios
git commit -m "feat(web): API отслеживания тайтлов, эпизодов и списка студий"
```

---

### Task 9: PosterCard с четырьмя слотами бейджей

Спека §8 п.1 требует бейджи в 4 углах постера. Обобщаем PosterCard (`topLeft/topRight/bottomLeft/bottomRight`) и переводим страницу поиска на новый API.

**Files:**
- Modify: `apps/web/components/PosterCard.tsx`
- Modify: `apps/web/components/PosterCard.module.css`
- Modify: `apps/web/app/search/page.tsx`

- [ ] **Step 1: Переписать `apps/web/components/PosterCard.tsx`**

Заменить содержимое целиком:

```tsx
import Image from "next/image";
import Link from "next/link";
import styles from "./PosterCard.module.css";

export interface Badge {
  text: string;
  color?: string; // фон; по умолчанию полупрозрачный чёрный
}

export interface PosterCardProps {
  href: string;
  title: string;
  subtitle: string;
  posterUrl: string | null;
  topLeft?: Badge | null;
  topRight?: Badge | null;
  bottomLeft?: Badge | null;
  bottomRight?: Badge | null;
}

function BadgeSpan({ badge, className }: { badge: Badge; className: string }) {
  return (
    <span
      className={`${styles.badge} ${className}`}
      style={badge.color ? { background: badge.color } : undefined}
    >
      {badge.text}
    </span>
  );
}

export function PosterCard(p: PosterCardProps) {
  return (
    <Link href={p.href} className={styles.card}>
      <div className={styles.poster}>
        {p.posterUrl ? (
          <Image src={p.posterUrl} alt={p.title} fill sizes="180px"
            className={styles.img} />
        ) : (
          <div className={styles.noPoster}>нет постера</div>
        )}
        {p.topLeft && <BadgeSpan badge={p.topLeft} className={styles.tl} />}
        {p.topRight && <BadgeSpan badge={p.topRight} className={styles.tr} />}
        {p.bottomLeft && <BadgeSpan badge={p.bottomLeft} className={styles.bl} />}
        {p.bottomRight && <BadgeSpan badge={p.bottomRight} className={styles.br} />}
      </div>
      <div className={styles.title}>{p.title}</div>
      <div className={styles.subtitle}>{p.subtitle}</div>
    </Link>
  );
}
```

- [ ] **Step 2: Обновить `apps/web/components/PosterCard.module.css`**

Удалить классы `.type`, `.rating`, `.corner`; на их место добавить:

```css
.badge {
  position: absolute;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  font-size: 9px;
  font-weight: bold;
  border-radius: 4px;
  padding: 2px 5px;
  max-width: calc(100% - 14px);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tl { top: 7px; left: 7px; }
.tr { top: 7px; right: 7px; }
.bl { bottom: 7px; left: 7px; }
.br { bottom: 7px; right: 7px; }
```

Остальные классы (`.card`, `.poster`, `.img`, `.noPoster`, `.title`, `.subtitle`) не трогать.

- [ ] **Step 3: Перевести поиск на новый API**

В `apps/web/app/search/page.tsx` заменить рендер PosterCard:

```tsx
            <PosterCard
              key={`${r.type}-${r.id}`}
              href={`/title/${r.type}/${r.id}`}
              title={r.title}
              subtitle={`${r.year} · ${r.type === "tv" ? "сериал" : "фильм"}`}
              posterUrl={posterUrl(r.posterPath)}
              topLeft={{ text: r.type === "tv" ? "TV" : "Фильм", color: "var(--accent)" }}
              bottomRight={r.rating ? { text: `★ ${r.rating.toFixed(1)}` } : null}
            />
```

- [ ] **Step 4: Проверка**

Run: `npm run typecheck` — чисто. Run: `npm run test:e2e -w @dublyarr/web`
Expected: существующие e2e зелёные (search.spec проверяет карточки).

- [ ] **Step 5: Коммит**

```bash
git add apps/web/components/PosterCard.tsx apps/web/components/PosterCard.module.css apps/web/app/search/page.tsx
git commit -m "refactor(web): PosterCard с четырьмя слотами бейджей"
```

---

### Task 10: Страница «Отслеживаемое» (`app/page.tsx`)

Спека §8 п.1: секции «Сериалы»/«Фильмы», бейджи: верх-лево тип (красный/accent), верх-право целевое качество (серым — скачанного ещё нет, файлы появятся в M2b), низ-лево озвучка (зелёный), низ-право статус «⏳». Под постером: название, год · контекст. Карточки «+» нет.

**Files:**
- Modify: `apps/web/app/page.tsx`
- Create: `apps/web/app/tracked.module.css`

- [ ] **Step 1: Создать `apps/web/app/tracked.module.css`**

```css
.grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 16px;
}

@media (max-width: 1024px) {
  .grid { grid-template-columns: repeat(4, 1fr); }
}

@media (max-width: 600px) {
  .grid { grid-template-columns: repeat(3, 1fr); gap: 10px; }
}

.empty { color: var(--text-muted); }

.section { margin: 18px 0 10px; }
```

(Сетка повторяет `search.module.css` — те же брейкпоинты 6/4/3.)

- [ ] **Step 2: Переписать `apps/web/app/page.tsx`**

Заменить содержимое целиком:

```tsx
import { listPresets, listTrackedTitles } from "@dublyarr/core/db";
import { qualityLabel } from "@dublyarr/core/quality";
import { posterUrl } from "@dublyarr/core/tmdb";
import { getDb } from "@/server/db";
import { PosterCard } from "@/components/PosterCard";
import styles from "./tracked.module.css";

export const dynamic = "force-dynamic";

const STATUS_RU: Record<string, string> = {
  "Returning Series": "выходит",
  Ended: "завершён",
  Canceled: "закрыт",
  "In Production": "в производстве",
  Released: "вышел",
  "Post Production": "постпродакшн",
  Planned: "анонсирован",
};

export default function TrackedPage() {
  const db = getDb();
  const titles = listTrackedTitles(db);
  const presetLabel = new Map(
    listPresets(db).map((p) => [p.id, qualityLabel(p.preferred)]),
  );
  const tv = titles.filter((t) => t.type === "tv");
  const movies = titles.filter((t) => t.type === "movie");

  if (titles.length === 0) {
    return (
      <>
        <h1>Отслеживаемое</h1>
        <p className={styles.empty}>
          Пока пусто. Найдите фильм или сериал через «Поиск» и добавьте в отслеживание.
        </p>
      </>
    );
  }

  const section = (items: typeof titles) => (
    <div className={styles.grid}>
      {items.map((t) => (
        <PosterCard
          key={t.id}
          href={`/title/${t.type}/${t.tmdbId}`}
          title={t.titleRu}
          subtitle={`${t.year} · ${STATUS_RU[t.tmdbStatus ?? ""] ?? t.tmdbStatus ?? "—"}`}
          posterUrl={posterUrl(t.posterPath)}
          topLeft={{ text: t.type === "tv" ? "TV" : "Фильм", color: "var(--accent)" }}
          topRight={{ text: presetLabel.get(t.qualityPresetId) ?? "—" }}
          bottomLeft={{
            text: t.voiceover === "any" ? "Любая" : t.voiceover,
            color: "var(--ok)",
          }}
          bottomRight={{ text: "⏳" }}
        />
      ))}
    </div>
  );

  return (
    <>
      <h1>Отслеживаемое</h1>
      {tv.length > 0 && (
        <>
          <h2 className={styles.section}>Сериалы</h2>
          {section(tv)}
        </>
      )}
      {movies.length > 0 && (
        <>
          <h2 className={styles.section}>Фильмы</h2>
          {section(movies)}
        </>
      )}
    </>
  );
}
```

Примечание: если переменной `--ok` нет в `app/globals.css`, добавить в `:root` строку `--ok: #2e9e5b;` (в M1 она используется в settings.module.css — проверить и не дублировать).

- [ ] **Step 3: Проверка**

Run: `npm run typecheck` — чисто. Открыть `npm run dev` → `/` — пустое состояние («Пока пусто…») рендерится.

- [ ] **Step 4: Коммит**

```bash
git add apps/web/app/page.tsx apps/web/app/tracked.module.css
git commit -m "feat(web): страница «Отслеживаемое» с секциями и бейджами"
```

---

### Task 11: Бейдж «✓ отслеживается» в поиске

**Files:**
- Modify: `apps/web/app/search/page.tsx`

- [ ] **Step 1: Подмешать ключи отслеживаемого**

В `apps/web/app/search/page.tsx`:

Импорт: заменить строку `import { getSetting } from "@dublyarr/core/db";` на

```ts
import { getSetting, listTrackedTmdbKeys } from "@dublyarr/core/db";
```

После строки `const apiKey = getSetting(getDb(), "tmdb_api_key");` добавить:

```ts
  const trackedKeys = listTrackedTmdbKeys(getDb());
```

В рендере PosterCard (из Task 9) добавить проп:

```tsx
              topRight={
                trackedKeys.has(`${r.type}:${r.id}`)
                  ? { text: "✓ отслеживается", color: "var(--ok)" }
                  : null
              }
```

- [ ] **Step 2: Проверка и коммит**

Run: `npm run typecheck` — чисто.

```bash
git add apps/web/app/search/page.tsx
git commit -m "feat(web): бейдж «✓ отслеживается» в результатах поиска"
```

---

### Task 12: Блок отслеживания на странице тайтла

Спека §8 п.3: селект озвучки (студии из Jackett + «Любая русская»), селект пресета, monitor_rule, добавление/удаление; для сериалов — сезоны с чекбоксами серий. Кнопка «Искать сейчас» — M3 (воркера нет), список файлов — M2b. Серверная страница передаёт состояние пропсами; мутации — fetch + `router.refresh()`.

**Files:**
- Modify: `apps/web/app/title/[type]/[id]/page.tsx`
- Create: `apps/web/app/title/[type]/[id]/TrackingBlock.tsx`
- Create: `apps/web/app/title/[type]/[id]/EpisodeList.tsx`
- Create: `apps/web/app/title/[type]/[id]/tracking.module.css`

- [ ] **Step 1: Создать `apps/web/app/title/[type]/[id]/tracking.module.css`**

```css
.block {
  background: var(--surface);
  border-radius: var(--radius);
  padding: 14px 16px;
  margin: 14px 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 640px;
}

.row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }

.field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--text-2); }

.field select {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  padding: 8px 10px;
  font-size: 14px;
  min-width: 160px;
}

.primary {
  background: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 8px;
  color: #fff;
  padding: 9px 16px;
  cursor: pointer;
  font-size: 14px;
}

.danger {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-muted);
  padding: 8px 14px;
  cursor: pointer;
}

.trackedBadge { color: var(--ok); font-weight: bold; font-size: 14px; }

.error { color: #e05c5c; font-size: 13px; margin: 0; }

.season { margin: 10px 0 4px; display: flex; align-items: center; gap: 10px; }

.episodes { display: flex; flex-direction: column; gap: 2px; }

.episode {
  display: flex; gap: 8px; align-items: baseline;
  font-size: 13px; padding: 3px 0;
  border-bottom: 1px solid var(--border);
}

.episode code { color: var(--text-muted); font-size: 12px; }

.epDate { margin-left: auto; color: var(--text-muted); font-size: 12px; white-space: nowrap; }
```

- [ ] **Step 2: Создать `apps/web/app/title/[type]/[id]/EpisodeList.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./tracking.module.css";

export interface EpisodeRow {
  id: number;
  season: number;
  episode: number;
  airDate: string | null;
  nameRu: string;
  wanted: boolean;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function airLabel(airDate: string | null): string {
  if (!airDate) return "дата неизвестна";
  const today = new Date().toISOString().slice(0, 10);
  const [y, m, d] = airDate.split("-");
  const human = `${d}.${m}.${y}`;
  return airDate <= today ? `вышла ${human}` : `выйдет ${human}`;
}

export function EpisodeList({
  titleId,
  episodes,
}: {
  titleId: number;
  episodes: EpisodeRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    await fetch(`/api/titles/${titleId}/episodes`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    router.refresh();
  }

  const seasons = [...new Set(episodes.map((e) => e.season))].sort((a, b) => a - b);

  return (
    <div data-testid="episode-list">
      <h2>Серии</h2>
      {seasons.map((season) => {
        const eps = episodes.filter((e) => e.season === season);
        const allWanted = eps.every((e) => e.wanted);
        return (
          <div key={season}>
            <div className={styles.season}>
              <h3>Сезон {season}</h3>
              <label>
                <input
                  type="checkbox"
                  checked={allWanted}
                  disabled={busy}
                  onChange={(e) => patch({ season, wanted: e.target.checked })}
                />{" "}
                все серии
              </label>
            </div>
            <div className={styles.episodes}>
              {eps.map((e) => (
                <label key={e.id} className={styles.episode}>
                  <input
                    type="checkbox"
                    checked={e.wanted}
                    disabled={busy}
                    onChange={(ev) =>
                      patch({ episodeIds: [e.id], wanted: ev.target.checked })
                    }
                  />
                  <code>
                    S{pad(e.season)}E{pad(e.episode)}
                  </code>
                  <span>{e.nameRu || "—"}</span>
                  <span className={styles.epDate}>{airLabel(e.airDate)}</span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Создать `apps/web/app/title/[type]/[id]/TrackingBlock.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "./tracking.module.css";

export interface PresetOption {
  id: number;
  name: string;
}

export interface TrackedState {
  id: number;
  voiceover: string;
  qualityPresetId: number;
  monitorRule: "all" | "future_only" | "manual";
}

const RULES: { value: TrackedState["monitorRule"]; label: string }[] = [
  { value: "all", label: "Все серии" },
  { value: "future_only", label: "Только новые" },
  { value: "manual", label: "Вручную" },
];

export function TrackingBlock({
  type,
  tmdbId,
  tracked,
  presets,
  searchQuery,
}: {
  type: "movie" | "tv";
  tmdbId: number;
  tracked: TrackedState | null;
  presets: PresetOption[];
  searchQuery: string;
}) {
  const router = useRouter();
  const [studios, setStudios] = useState<string[]>([]);
  const [voiceover, setVoiceover] = useState(tracked?.voiceover ?? "any");
  const [presetId, setPresetId] = useState(tracked?.qualityPresetId ?? presets[0]?.id ?? 0);
  const [rule, setRule] = useState<TrackedState["monitorRule"]>(tracked?.monitorRule ?? "all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/studios?query=${encodeURIComponent(searchQuery)}`)
      .then((r) => r.json())
      .then((d: { studios: string[] }) => setStudios(d.studios))
      .catch(() => {});
  }, [searchQuery]);

  async function call(input: RequestInfo, init: RequestInit) {
    setBusy(true);
    setError(null);
    const res = await fetch(input, {
      ...init,
      headers: { "Content-Type": "application/json" },
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? `Ошибка ${res.status}`);
      return false;
    }
    router.refresh();
    return true;
  }

  function add() {
    void call("/api/titles", {
      method: "POST",
      body: JSON.stringify({ type, tmdbId, voiceover, qualityPresetId: presetId, monitorRule: rule }),
    });
  }

  function patch(body: Record<string, unknown>) {
    if (!tracked) return;
    void call(`/api/titles/${tracked.id}`, { method: "PATCH", body: JSON.stringify(body) });
  }

  function remove() {
    if (!tracked) return;
    if (!window.confirm("Убрать из отслеживания? Список серий будет удалён.")) return;
    void call(`/api/titles/${tracked.id}`, { method: "DELETE" });
  }

  // выбранная ранее озвучка может отсутствовать в текущей выдаче Jackett
  const options = [...new Set([...studios, ...(voiceover !== "any" ? [voiceover] : [])])];

  return (
    <div className={styles.block} data-testid="tracking-block">
      {tracked && <span className={styles.trackedBadge}>✓ отслеживается</span>}
      <div className={styles.row}>
        <label className={styles.field}>
          <span>Озвучка</span>
          <select
            data-testid="tracking-voiceover"
            value={voiceover}
            disabled={busy}
            onChange={(e) => {
              setVoiceover(e.target.value);
              if (tracked) patch({ voiceover: e.target.value });
            }}
          >
            <option value="any">Любая русская</option>
            {options.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Качество</span>
          <select
            data-testid="tracking-preset"
            value={presetId}
            disabled={busy}
            onChange={(e) => {
              setPresetId(Number(e.target.value));
              if (tracked) patch({ qualityPresetId: Number(e.target.value) });
            }}
          >
            {presets.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        {type === "tv" && (
          <label className={styles.field}>
            <span>Мониторинг</span>
            <select
              data-testid="tracking-monitor"
              value={rule}
              disabled={busy}
              onChange={(e) => {
                const v = e.target.value as TrackedState["monitorRule"];
                setRule(v);
                if (tracked) patch({ monitorRule: v });
              }}
            >
              {RULES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className={styles.row}>
        {!tracked ? (
          <button className={styles.primary} data-testid="tracking-add" disabled={busy || !presetId} onClick={add}>
            {busy ? "Добавляю…" : "Добавить в отслеживание"}
          </button>
        ) : (
          <button className={styles.danger} data-testid="tracking-remove" disabled={busy} onClick={remove}>
            Убрать из отслеживания
          </button>
        )}
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Вшить в страницу тайтла**

В `apps/web/app/title/[type]/[id]/page.tsx`:

Добавить импорты:

```ts
import { getTitleByTmdb, listEpisodes, listPresets } from "@dublyarr/core/db";
import { TrackingBlock } from "./TrackingBlock";
import { EpisodeList } from "./EpisodeList";
```

После строки `const poster = posterUrl(details.posterPath, 500);` добавить:

```ts
  const trackedTitle = getTitleByTmdb(db, type as TmdbType, numId);
  const presets = listPresets(db).map((p) => ({ id: p.id, name: p.name }));
  const episodeRows = trackedTitle
    ? listEpisodes(db, trackedTitle.id).map((e) => ({
        id: e.id,
        season: e.season,
        episode: e.episode,
        airDate: e.airDate,
        nameRu: e.nameRu,
        wanted: e.wanted,
      }))
    : [];
```

В JSX между `</div>` героя (закрывающим `styles.hero`) и `<h2>Доступные озвучки</h2>` вставить:

```tsx
      <TrackingBlock
        type={type as TmdbType}
        tmdbId={numId}
        tracked={
          trackedTitle
            ? {
                id: trackedTitle.id,
                voiceover: trackedTitle.voiceover,
                qualityPresetId: trackedTitle.qualityPresetId,
                monitorRule: trackedTitle.monitorRule,
              }
            : null
        }
        presets={presets}
        searchQuery={details.originalTitle || details.title}
      />
```

А после блока `<Suspense>…</Suspense>` (таблица озвучек) добавить:

```tsx
      {trackedTitle && type === "tv" && episodeRows.length > 0 && (
        <EpisodeList titleId={trackedTitle.id} episodes={episodeRows} />
      )}
```

- [ ] **Step 5: Проверка в браузере**

Run: `npm run typecheck` — чисто. `npm run dev`, открыть `/title/tv/60625` (нужен TMDb-ключ в настройках): блок с селектами и кнопкой «Добавить в отслеживание» виден; без Jackett селект озвучки содержит только «Любая русская». Добавить → бейдж «✓ отслеживается», секция «Серии» с чекбоксами; `/` показывает карточку. Убрать из отслеживания → блок возвращается в исходное состояние.

- [ ] **Step 6: Коммит**

```bash
git add "apps/web/app/title/[type]/[id]"
git commit -m "feat(web): блок отслеживания и выбор серий на странице тайтла"
```

---

### Task 13: Настройки — вкладки и редактор пресетов

Спека §8 п.6: вкладка «Качество» с редактором пресетов (чекбоксы по лестнице, preferred, upgrade). Вкладки серверные через `?tab=` (Качество · Интеграции), на мобильном — горизонтальный скролл. Клиентский редактор импортирует лестницу из `@dublyarr/core/quality` (чистый TS, без better-sqlite3).

**Files:**
- Modify: `apps/web/app/settings/page.tsx`
- Create: `apps/web/app/settings/PresetsEditor.tsx`
- Modify: `apps/web/app/settings/settings.module.css`

- [ ] **Step 1: Переписать `apps/web/app/settings/page.tsx`**

```tsx
import Link from "next/link";
import { getAllSettings, listPresets } from "@dublyarr/core/db";
import { getDb } from "@/server/db";
import { PresetsEditor } from "./PresetsEditor";
import { SettingsForm } from "./SettingsForm";
import styles from "./settings.module.css";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "quality", label: "Качество" },
  { key: "integrations", label: "Интеграции" },
] as const;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const active = tab === "integrations" ? "integrations" : "quality";
  const db = getDb();

  return (
    <>
      <h1>Настройки</h1>
      <nav className={styles.tabs} data-testid="settings-tabs">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/settings?tab=${t.key}`}
            className={t.key === active ? styles.tabActive : styles.tab}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {active === "quality" ? (
        <PresetsEditor initial={listPresets(db)} />
      ) : (
        <SettingsForm initial={getAllSettings(db)} />
      )}
    </>
  );
}
```

- [ ] **Step 2: Дополнить `apps/web/app/settings/settings.module.css`**

Добавить в конец файла:

```css
.tabs {
  display: flex;
  gap: 6px;
  margin: 0 0 16px;
  overflow-x: auto;
}

.tab,
.tabActive {
  padding: 7px 14px;
  border-radius: 8px;
  font-size: 14px;
  white-space: nowrap;
  color: var(--text-2);
  border: 1px solid var(--border);
}

.tabActive {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.presetList { display: flex; flex-direction: column; gap: 14px; max-width: 520px; }

.qualityGrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 14px;
  font-size: 13px;
}

.qualityGrid label { display: flex; gap: 6px; align-items: center; }

.field select {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  padding: 9px 12px;
  font-size: 14px;
}

.inline { display: flex; gap: 6px; align-items: center; font-size: 13px; color: var(--text-2); }

.err { color: #e05c5c; font-size: 13px; margin: 0; }
```

- [ ] **Step 3: Создать `apps/web/app/settings/PresetsEditor.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { QUALITY_LADDER, highestAllowed } from "@dublyarr/core/quality";
import styles from "./settings.module.css";

interface Preset {
  id: number;
  name: string;
  allowed: string[];
  preferred: string;
  upgradeEnabled: boolean;
}

type Draft = Omit<Preset, "id"> & { id: number | null };

function PresetCard({
  draft,
  onDone,
}: {
  draft: Draft;
  onDone: () => void;
}) {
  const [p, setP] = useState<Draft>(draft);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(key: string, checked: boolean) {
    const allowed = checked ? [...p.allowed, key] : p.allowed.filter((k) => k !== key);
    let preferred = p.preferred;
    if (!allowed.includes(preferred)) preferred = highestAllowed(allowed) ?? "";
    setP({ ...p, allowed, preferred });
  }

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(p.id === null ? "/api/presets" : `/api/presets/${p.id}`, {
      method: p.id === null ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: p.name,
        allowed: p.allowed,
        preferred: p.preferred,
        upgradeEnabled: p.upgradeEnabled,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? `Ошибка ${res.status}`);
      return;
    }
    onDone();
  }

  async function remove() {
    if (p.id === null) return onDone();
    if (!window.confirm(`Удалить пресет «${p.name}»?`)) return;
    setBusy(true);
    const res = await fetch(`/api/presets/${p.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? `Ошибка ${res.status}`);
      return;
    }
    onDone();
  }

  return (
    <div className={styles.card} data-testid="preset-card">
      <label className={styles.field}>
        <span>Название</span>
        <input
          value={p.name}
          onChange={(e) => setP({ ...p, name: e.target.value })}
        />
      </label>
      <div className={styles.qualityGrid}>
        {QUALITY_LADDER.map((q) => (
          <label key={q.key}>
            <input
              type="checkbox"
              checked={p.allowed.includes(q.key)}
              onChange={(e) => toggle(q.key, e.target.checked)}
            />
            {q.label}
          </label>
        ))}
      </div>
      <label className={styles.field}>
        <span>Предпочитаемое</span>
        <select
          value={p.preferred}
          onChange={(e) => setP({ ...p, preferred: e.target.value })}
        >
          {QUALITY_LADDER.filter((q) => p.allowed.includes(q.key)).map((q) => (
            <option key={q.key} value={q.key}>{q.label}</option>
          ))}
        </select>
      </label>
      <label className={styles.inline}>
        <input
          type="checkbox"
          checked={p.upgradeEnabled}
          onChange={(e) => setP({ ...p, upgradeEnabled: e.target.checked })}
        />
        Апгрейдить до предпочитаемого (старый файл удаляется)
      </label>
      <div className={styles.actions}>
        <button disabled={busy} onClick={save}>Сохранить</button>
        <button disabled={busy} onClick={remove}>
          {p.id === null ? "Отмена" : "Удалить"}
        </button>
      </div>
      {error && <p className={styles.err}>{error}</p>}
    </div>
  );
}

export function PresetsEditor({ initial }: { initial: Preset[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);

  function done() {
    setAdding(false);
    router.refresh();
  }

  return (
    <div className={styles.presetList}>
      <h2>Пресеты качества</h2>
      {initial.map((p) => (
        <PresetCard key={`${p.id}-${p.name}-${p.preferred}`} draft={p} onDone={done} />
      ))}
      {adding ? (
        <PresetCard
          draft={{ id: null, name: "", allowed: [], preferred: "", upgradeEnabled: false }}
          onDone={done}
        />
      ) : (
        <div className={styles.actions}>
          <button data-testid="preset-new" onClick={() => setAdding(true)}>
            Новый пресет
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Проверка существующих e2e**

`e2e/settings.spec.ts` ходит на `/settings` и работает с формой интеграций — теперь она на вкладке `?tab=integrations`. Открыть спек и в каждом тесте заменить `page.goto("/settings")` на `page.goto("/settings?tab=integrations")` (точные строки — по факту содержимого файла).

Run: `npm run test:e2e -w @dublyarr/web`
Expected: PASS.

- [ ] **Step 5: Проверка в браузере**

`npm run dev` → `/settings`: вкладка «Качество» по умолчанию, карточки FullHD и 4K, чекбоксы по лестнице; создать пресет «Тест», удалить его; вкладка «Интеграции» — прежняя форма.

- [ ] **Step 6: Коммит**

```bash
git add apps/web/app/settings apps/web/e2e/settings.spec.ts
git commit -m "feat(web): вкладки настроек и редактор пресетов качества"
```

---

### Task 14: e2e, README и финальная проверка

**Files:**
- Create: `apps/web/e2e/presets.spec.ts`
- Create: `apps/web/e2e/tracking.spec.ts`
- Modify: `README.md`

- [ ] **Step 1: e2e редактора пресетов (без внешних ключей)**

Создать `apps/web/e2e/presets.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("редактор пресетов: сид, создание и удаление", async ({ page }) => {
  await page.goto("/settings?tab=quality");
  await expect(page.getByTestId("preset-card")).toHaveCount(2);
  await expect(page.locator("input[value='FullHD']")).toBeVisible();

  await page.getByTestId("preset-new").click();
  const draft = page.getByTestId("preset-card").last();
  await draft.locator("label", { hasText: "Название" }).locator("input").fill("Тест 720p");
  await draft.locator("label", { hasText: /^720p$/ }).locator("input").check();
  await draft.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.locator("input[value='Тест 720p']")).toBeVisible();

  page.on("dialog", (d) => d.accept());
  const created = page.getByTestId("preset-card").filter({
    has: page.locator("input[value='Тест 720p']"),
  });
  await created.getByRole("button", { name: "Удалить" }).click();
  await expect(page.locator("input[value='Тест 720p']")).toHaveCount(0);
});
```

- [ ] **Step 2: e2e отслеживания (гейт по TMDB_API_KEY)**

Создать `apps/web/e2e/tracking.spec.ts` (паттерн гейта — как в существующих спеках M1, сверить с `e2e/title.spec.ts`):

```ts
import { expect, test } from "@playwright/test";

const TMDB_KEY = process.env.TMDB_API_KEY;

test.describe("отслеживание", () => {
  test.skip(!TMDB_KEY, "нужен TMDB_API_KEY в .env");

  test("добавить → бейджи → убрать", async ({ page, request }) => {
    await request.put("/api/settings", { data: { tmdb_api_key: TMDB_KEY } });

    await page.goto("/title/tv/60625");
    await expect(page.getByTestId("tracking-block")).toBeVisible();
    await page.getByTestId("tracking-add").click();
    await expect(page.getByTestId("tracking-remove")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("✓ отслеживается")).toBeVisible();
    await expect(page.getByTestId("episode-list")).toBeVisible();

    await page.goto("/");
    await expect(page.getByText("Сериалы")).toBeVisible();
    await expect(page.getByText("Рик и Морти")).toBeVisible();

    await page.goto("/search?q=rick+and+morty");
    await expect(page.getByText("✓ отслеживается").first()).toBeVisible();

    await page.goto("/title/tv/60625");
    page.on("dialog", (d) => d.accept());
    await page.getByTestId("tracking-remove").click();
    await expect(page.getByTestId("tracking-add")).toBeVisible();
  });
});
```

Примечание: спек самоочищающийся (в конце убирает тайтл) — БД у e2e общая (workers: 1, `.e2e-data`).

- [ ] **Step 3: Прогнать всё**

```bash
npm test
npm run typecheck
npm run test:e2e -w @dublyarr/web
```

Expected: юнит-тесты PASS, typecheck чисто, e2e PASS (tracking-спек скипается без TMDB_API_KEY; локально с ключом в `.env` — проходит).

- [ ] **Step 4: README**

В `README.md` в раздел «Структура» ничего не менять; после блока «Разработка» добавить раздел:

```markdown
## Что умеет (M2a)

- Поиск по TMDb, страница тайтла с таблицей доступных озвучек (Jackett).
- Отслеживание: озвучка («Любая русская» или конкретная студия), пресет качества,
  правило мониторинга (все серии / только новые / вручную), выбор серий чекбоксами.
- Страница «Отслеживаемое» с бейджами; пресеты качества редактируются в
  Настройки → Качество.
- Скачивание (qBittorrent) — в M2b, автоматика — в M3.
```

- [ ] **Step 5: Финальный коммит**

```bash
git add apps/web/e2e/presets.spec.ts apps/web/e2e/tracking.spec.ts README.md
git commit -m "test(web): e2e отслеживания и пресетов; README M2a"
```

---

## Чего сознательно нет в M2a (не считать пропуском)

- Кнопка «Искать сейчас», статусы скачивания на карточках (реальные ⬇/✓), список файлов, root_folder UI — M2b/M3.
- `files`, `downloads`, `history`, `blacklist`, `studio_aliases`, `tracker_studio_map` как таблицы — M2b/M3 (алиасы пока живут констанами в parser.ts, как в M1).
- Ежедневный TMDb-синк эпизодов — M3 (воркер); в M2a эпизоды синкаются один раз при добавлении.
- Вкладки настроек кроме «Качество»/«Интеграции» — добавляются в M2b (qBittorrent, папки) и M3/M4.





