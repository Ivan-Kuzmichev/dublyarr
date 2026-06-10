# Dublyarr M2b — ручное скачивание (qBittorrent + импорт) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ручной grab релиза со страницы тайтла → qBittorrent (category=dublyarr) → отслеживание прогресса → импорт в библиотеку по шаблону имён с записью в `files` и привязкой к эпизодам.

**Architecture:** В `packages/core` добавляются клиент qBittorrent Web API v2 (класс с cookie-сессией), чистый модуль шаблонов имён, модули БД `files`/`downloads` (миграция 0002) и импортёр (hardlink/copy в библиотеку, маппинг файлов на серии по SxxEyy). В `apps/web` — тонкие API-роуты (POST grab, GET refresh-and-import, DELETE), таблица раздач с кнопкой «Скачать» на странице тайтла, блок загрузок с поллингом, список файлов с удалением, вкладка настроек «Папки и имена» и поля qBittorrent в «Интеграциях». Воркера нет — статусы обновляются при GET-запросе (poll-on-request); cron-конвейер уедет в M3.

**Tech Stack:** Next.js 15 (App Router), React 19, Drizzle ORM + better-sqlite3, qBittorrent Web API v2, Vitest, Playwright, CSS Modules (без Tailwind).

---

## Контекст для исполнителя

- Монорепо npm workspaces: `packages/core` (`@dublyarr/core`, exports — сырые `.ts`), `apps/web`.
- Внутри core импорты между файлами пишутся с расширением `.js` (резолвится в `.ts` через `extensionAlias` в next.config.ts и vitest).
- Ожидаемые отказы — result-объекты `{ok, error}` с точными русскими строками: они же контракт API и UI.
- Тонкие API-роуты: коэрсия body без zod, валидация в core.
- Клиентские мутации: `fetch` + `router.refresh()`, try/catch/finally c `setBusy` в finally, «Сеть недоступна» при сетевой ошибке.
- Команды: `npm test -w @dublyarr/core`, `npm run typecheck`, `npm run test:e2e -w @dublyarr/web` (порт 3100, workers:1, общая SQLite в `.e2e-data`).
- Существующие настройки: `SETTING_KEYS = ["tmdb_api_key", "jackett_url", "jackett_api_key"]` в `packages/core/src/db/settings.ts`.
- `episodes.file_id` — голая колонка (без FK), её заполняет импортёр.
- Уже есть: `parseRelease`/`summarizeStudioAvailability` (parser), `qualityKeyFor`/`qualityLabel` (quality), `JackettRelease` c `guid/link/size/seeders`, `getDb()` в `apps/web/server/db.ts`.

---

### Task 1: Миграция 0002 — таблицы files и downloads

**Files:**
- Modify: `packages/core/src/db/migrations.ts`
- Modify: `packages/core/src/db/schema.ts`
- Test: `packages/core/test/db.test.ts`

- [ ] **Step 1: Написать падающий тест**

Дописать в конец `packages/core/test/db.test.ts` (внутри файла уже есть импорты `openDb`, `mkdtempSync`, `tmpdir`, `join` — используй существующий стиль; новый describe со своей temp-БД):

```ts
describe("миграция 0002: files и downloads", () => {
  const dir = mkdtempSync(join(tmpdir(), "dublyarr-m2b-"));
  const { sqlite } = openDb(join(dir, "m2b.db"));

  test("таблицы созданы", () => {
    const names = (
      sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('files','downloads')`)
        .all() as { name: string }[]
    ).map((r) => r.name);
    expect(names.sort()).toEqual(["downloads", "files"]);
  });

  test("удаление тайтла каскадит downloads и files", () => {
    sqlite
      .prepare(
        `INSERT INTO titles (tmdb_id, type, title_ru, title_original, quality_preset_id)
         VALUES (1, 'movie', 'Тест', 'Test', 1)`,
      )
      .run();
    const titleId = sqlite.prepare(`SELECT id FROM titles WHERE tmdb_id = 1`).get() as { id: number };
    sqlite
      .prepare(`INSERT INTO downloads (title_id, tag) VALUES (?, 'dublyarr-x')`)
      .run(titleId.id);
    sqlite
      .prepare(`INSERT INTO files (title_id, path) VALUES (?, '/lib/a.mkv')`)
      .run(titleId.id);
    sqlite.prepare(`DELETE FROM titles WHERE id = ?`).run(titleId.id);
    expect(sqlite.prepare(`SELECT count(*) AS c FROM downloads`).get()).toEqual({ c: 0 });
    expect(sqlite.prepare(`SELECT count(*) AS c FROM files`).get()).toEqual({ c: 0 });
  });

  test("downloads.status ограничен CHECK", () => {
    sqlite
      .prepare(
        `INSERT INTO titles (tmdb_id, type, title_ru, title_original, quality_preset_id)
         VALUES (2, 'movie', 'Т2', 'T2', 1)`,
      )
      .run();
    const t = sqlite.prepare(`SELECT id FROM titles WHERE tmdb_id = 2`).get() as { id: number };
    expect(() =>
      sqlite
        .prepare(`INSERT INTO downloads (title_id, tag, status) VALUES (?, 'dublyarr-y', 'bogus')`)
        .run(t.id),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Прогнать тест — убедиться, что падает**

Run: `npm test -w @dublyarr/core -- db`
Expected: FAIL — таблиц `files`/`downloads` нет.

- [ ] **Step 3: Добавить миграцию**

В `packages/core/src/db/migrations.ts` добавить элемент в конец массива `migrations`:

```ts
  {
    id: "0002_downloads",
    sql: `CREATE TABLE files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
      episode_id INTEGER REFERENCES episodes(id) ON DELETE SET NULL,
      path TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      quality_source TEXT,
      quality_resolution TEXT,
      voiceover_studio TEXT,
      release_guid TEXT,
      downloaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
      release_guid TEXT NOT NULL DEFAULT '',
      release_title TEXT NOT NULL DEFAULT '',
      qbit_hash TEXT,
      tag TEXT NOT NULL UNIQUE,
      episodes_covered TEXT NOT NULL DEFAULT '[]',
      voiceover_studio TEXT,
      quality_source TEXT,
      quality_resolution TEXT,
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','downloading','completed','failed','imported')),
      progress REAL NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`,
  },
```

- [ ] **Step 4: Добавить drizzle-схему**

В `packages/core/src/db/schema.ts` добавить `real` в импорт из `drizzle-orm/sqlite-core` и дописать в конец файла:

```ts
export const files = sqliteTable("files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  titleId: integer("title_id")
    .notNull()
    .references(() => titles.id, { onDelete: "cascade" }),
  episodeId: integer("episode_id").references(() => episodes.id, {
    onDelete: "set null",
  }),
  path: text("path").notNull(),
  size: integer("size").notNull().default(0),
  qualitySource: text("quality_source"),
  qualityResolution: text("quality_resolution"),
  voiceoverStudio: text("voiceover_studio"),
  releaseGuid: text("release_guid"),
  downloadedAt: text("downloaded_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const downloads = sqliteTable("downloads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  titleId: integer("title_id")
    .notNull()
    .references(() => titles.id, { onDelete: "cascade" }),
  releaseGuid: text("release_guid").notNull().default(""),
  releaseTitle: text("release_title").notNull().default(""),
  qbitHash: text("qbit_hash"),
  tag: text("tag").notNull().unique(),
  episodesCovered: text("episodes_covered").notNull().default("[]"),
  voiceoverStudio: text("voiceover_studio"),
  qualitySource: text("quality_source"),
  qualityResolution: text("quality_resolution"),
  status: text("status", {
    enum: ["queued", "downloading", "completed", "failed", "imported"],
  })
    .notNull()
    .default("queued"),
  progress: real("progress").notNull().default(0),
  error: text("error"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});
```

- [ ] **Step 5: Прогнать тесты**

Run: `npm test -w @dublyarr/core -- db`
Expected: PASS (все тесты файла).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/db/migrations.ts packages/core/src/db/schema.ts packages/core/test/db.test.ts
git commit -m "feat(core): миграция 0002 — таблицы files и downloads"
```

---

### Task 2: Новые ключи настроек (qBittorrent, папки, шаблоны)

**Files:**
- Modify: `packages/core/src/db/settings.ts`
- Test: `packages/core/test/db.test.ts`

- [ ] **Step 1: Написать падающий тест**

Дописать в `packages/core/test/db.test.ts` (в новый describe со своей temp-БД, по образцу существующих):

```ts
describe("ключи настроек M2b", () => {
  const dir = mkdtempSync(join(tmpdir(), "dublyarr-keys-"));
  const { db } = openDb(join(dir, "keys.db"));

  test("getAllSettings отдаёт новые ключи", () => {
    const all = getAllSettings(db);
    for (const k of [
      "qbit_url",
      "qbit_username",
      "qbit_password",
      "library_movies",
      "library_tv",
      "staging_dir",
      "naming_tv",
      "naming_movie",
    ]) {
      expect(all).toHaveProperty(k, null);
    }
  });
});
```

Если `getAllSettings` ещё не импортирован в этом файле — добавить в импорт из `../src/db/index.js`.

- [ ] **Step 2: Прогнать тест — убедиться, что падает**

Run: `npm test -w @dublyarr/core -- db`
Expected: FAIL — ключей нет.

- [ ] **Step 3: Расширить SETTING_KEYS**

В `packages/core/src/db/settings.ts` заменить массив:

```ts
export const SETTING_KEYS = [
  "tmdb_api_key",
  "jackett_url",
  "jackett_api_key",
  "qbit_url",
  "qbit_username",
  "qbit_password",
  "library_movies",
  "library_tv",
  "staging_dir",
  "naming_tv",
  "naming_movie",
] as const;
```

- [ ] **Step 4: Прогнать тесты и typecheck**

Run: `npm test -w @dublyarr/core -- db && npm run typecheck`
Expected: PASS / exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/db/settings.ts packages/core/test/db.test.ts
git commit -m "feat(core): ключи настроек qBittorrent, библиотек и шаблонов имён"
```

---

### Task 3: Шаблоны имён и parseEpisodeTag

**Files:**
- Create: `packages/core/src/naming.ts`
- Modify: `packages/core/src/parser.ts` (в конец файла)
- Modify: `packages/core/package.json` (exports)
- Test: `packages/core/test/naming.test.ts`
- Test: `packages/core/test/parser.test.ts` (в конец)

- [ ] **Step 1: Написать падающие тесты**

Создать `packages/core/test/naming.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  DEFAULT_NAMING_MOVIE,
  DEFAULT_NAMING_TV,
  renderTemplate,
  sanitizeName,
} from "../src/naming.js";

describe("sanitizeName", () => {
  test("вырезает запрещённые символы и схлопывает пробелы", () => {
    expect(sanitizeName('Rick: and/Morty *<"?>|')).toBe("Rick and Morty");
  });
});

describe("renderTemplate", () => {
  test("сериал по дефолтному шаблону", () => {
    const out = renderTemplate(DEFAULT_NAMING_TV, {
      show: "Rick and Morty",
      year: "2013",
      season: 1,
      episode: 3,
      quality: "WEB-DL 1080p",
      vo: "Сыендук",
    });
    expect(out).toBe(
      "Rick and Morty/Season 01/Rick and Morty - S01E03 - WEB-DL 1080p Сыендук",
    );
  });

  test("фильм по дефолтному шаблону", () => {
    const out = renderTemplate(DEFAULT_NAMING_MOVIE, {
      show: "Dune",
      year: "2021",
      quality: "BDRemux 2160p",
      vo: "HDrezka",
    });
    expect(out).toBe("Dune (2021)/Dune (2021) - BDRemux 2160p HDrezka");
  });

  test("пустые quality/vo не оставляют висячих разделителей", () => {
    const out = renderTemplate(DEFAULT_NAMING_TV, {
      show: "Show",
      year: "2020",
      season: 2,
      episode: 11,
      quality: "",
      vo: "",
    });
    expect(out).toBe("Show/Season 02/Show - S02E11");
  });

  test("show с запрещёнными символами чистится в каждом сегменте", () => {
    const out = renderTemplate(DEFAULT_NAMING_MOVIE, {
      show: "What/If: Tales",
      year: "2024",
      quality: "WEB-DL 1080p",
      vo: "",
    });
    expect(out).toBe("What If Tales (2024)/What If Tales (2024) - WEB-DL 1080p");
  });
});
```

Дописать в конец `packages/core/test/parser.test.ts`:

```ts
describe("parseEpisodeTag", () => {
  test("SxxEyy в имени файла", () => {
    expect(parseEpisodeTag("Rick.and.Morty.S01E03.1080p.WEB-DL.mkv")).toEqual({
      season: 1,
      episode: 3,
    });
  });

  test("формат 1x05", () => {
    expect(parseEpisodeTag("show.1x05.hdtv.avi")).toEqual({ season: 1, episode: 5 });
  });

  test("без метки — null", () => {
    expect(parseEpisodeTag("Dune.2021.BDRemux.mkv")).toBeNull();
  });
});
```

И добавить `parseEpisodeTag` в импорт из `../src/parser.js` в начале файла.

- [ ] **Step 2: Прогнать тесты — убедиться, что падают**

Run: `npm test -w @dublyarr/core -- naming parser`
Expected: FAIL — модуля и функции нет.

- [ ] **Step 3: Реализовать naming.ts**

Создать `packages/core/src/naming.ts`:

```ts
export const DEFAULT_NAMING_TV =
  "{Show}/Season {ss}/{Show} - S{ss}E{ee} - {Quality} {VO}";
export const DEFAULT_NAMING_MOVIE =
  "{Show} ({Year})/{Show} ({Year}) - {Quality} {VO}";

/** Чистит сегмент пути от запрещённых в ФС символов. */
export function sanitizeName(s: string): string {
  return s
    .replace(/[/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface NameVars {
  show: string;
  year: string;
  season?: number;
  episode?: number;
  quality: string;
  vo: string;
}

/**
 * Подставляет токены {Show} {Year} {ss} {ee} {Quality} {VO} в шаблон.
 * Сегменты пути чистятся по отдельности; пустые токены не оставляют
 * висячих разделителей в конце сегмента.
 */
export function renderTemplate(template: string, vars: NameVars): string {
  const pad = (n?: number) => (n == null ? "" : String(n).padStart(2, "0"));
  return template
    .split("/")
    .map((segment) =>
      segment
        .replaceAll("{Show}", sanitizeName(vars.show))
        .replaceAll("{Year}", vars.year)
        .replaceAll("{ss}", pad(vars.season))
        .replaceAll("{ee}", pad(vars.episode))
        .replaceAll("{Quality}", vars.quality)
        .replaceAll("{VO}", vars.vo)
        .replace(/\s+/g, " ")
        .replace(/[\s.\-–]+$/g, "")
        .trim(),
    )
    .filter((seg) => seg.length > 0)
    .join("/");
}
```

- [ ] **Step 4: Реализовать parseEpisodeTag**

Дописать в конец `packages/core/src/parser.ts`:

```ts
/** Метка серии из имени файла: S01E03 или 1x05. */
export function parseEpisodeTag(
  name: string
): { season: number; episode: number } | null {
  const m = name.match(/\bS(\d{1,2})[\s._-]*E(\d{1,3})\b/i);
  if (m) return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) };
  const m2 = name.match(/\b(\d{1,2})x(\d{2,3})\b/);
  if (m2) return { season: parseInt(m2[1], 10), episode: parseInt(m2[2], 10) };
  return null;
}
```

- [ ] **Step 5: Добавить export-путь**

В `packages/core/package.json` в `exports` добавить строку:

```json
    "./naming": "./src/naming.ts",
```

- [ ] **Step 6: Прогнать тесты**

Run: `npm test -w @dublyarr/core -- naming parser`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/naming.ts packages/core/src/parser.ts packages/core/package.json packages/core/test/naming.test.ts packages/core/test/parser.test.ts
git commit -m "feat(core): шаблоны имён библиотеки и parseEpisodeTag"
```

---

### Task 4: Клиент qBittorrent Web API v2

**Files:**
- Create: `packages/core/src/qbittorrent.ts`
- Modify: `packages/core/package.json` (exports)
- Test: `packages/core/test/qbittorrent.test.ts`

- [ ] **Step 1: Написать падающие тесты**

Создать `packages/core/test/qbittorrent.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from "vitest";
import { QbtClient, QbtError, qbtStateToStatus } from "../src/qbittorrent.js";

const CFG = { url: "http://qbt.local:8080", username: "admin", password: "pass" };

function loginOk(sid = "abc123") {
  return new Response("Ok.", {
    status: 200,
    headers: { "set-cookie": `SID=${sid}; HttpOnly; path=/` },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("QbtClient", () => {
  test("логинится и шлёт cookie в запросах", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(new Response("4.6.5", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new QbtClient(CFG);
    expect(await client.version()).toBe("4.6.5");

    const [loginUrl, loginInit] = fetchMock.mock.calls[0];
    expect(String(loginUrl)).toBe("http://qbt.local:8080/api/v2/auth/login");
    expect(String(loginInit.body)).toContain("username=admin");
    const [, verInit] = fetchMock.mock.calls[1];
    expect((verInit.headers as Record<string, string>).Cookie).toBe("SID=abc123");
  });

  test("ответ Fails. на логин → QbtError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Fails.", { status: 200 })));
    const err = await new QbtClient(CFG).version().catch((e) => e);
    expect(err).toBeInstanceOf(QbtError);
    expect((err as QbtError).message).toBe("Неверный логин или пароль qBittorrent");
  });

  test("403 → перелогин и повтор запроса", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk("old"))
      .mockResolvedValueOnce(new Response("Forbidden", { status: 403 }))
      .mockResolvedValueOnce(loginOk("fresh"))
      .mockResolvedValueOnce(new Response("4.6.5", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await new QbtClient(CFG).version()).toBe("4.6.5");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const [, lastInit] = fetchMock.mock.calls[3];
    expect((lastInit.headers as Record<string, string>).Cookie).toBe("SID=fresh");
  });

  test("addTorrent передаёт urls/savepath/category/tags", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(new Response("Ok.", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await new QbtClient(CFG).addTorrent({
      url: "magnet:?xt=urn:btih:deadbeef",
      savePath: "/staging",
      category: "dublyarr",
      tags: "dublyarr-1",
    });
    const [addUrl, addInit] = fetchMock.mock.calls[1];
    expect(String(addUrl)).toBe("http://qbt.local:8080/api/v2/torrents/add");
    const body = String(addInit.body);
    expect(body).toContain(encodeURIComponent("magnet:?xt=urn:btih:deadbeef"));
    expect(body).toContain("savepath=%2Fstaging");
    expect(body).toContain("category=dublyarr");
    expect(body).toContain("tags=dublyarr-1");
  });

  test("addTorrent: ответ Fails. → QbtError", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(loginOk())
        .mockResolvedValueOnce(new Response("Fails.", { status: 200 })),
    );
    const err = await new QbtClient(CFG)
      .addTorrent({ url: "magnet:?xt=x" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(QbtError);
    expect((err as QbtError).message).toBe("qBittorrent отклонил раздачу");
  });

  test("listTorrents маппит поля и фильтрует по tag", async () => {
    const raw = [
      {
        hash: "deadbeef",
        name: "Rick.and.Morty.S01",
        progress: 0.42,
        state: "downloading",
        save_path: "/staging",
        content_path: "/staging/Rick.and.Morty.S01",
        size: 1000,
        dlspeed: 99,
        tags: "dublyarr-1, other",
      },
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(
        new Response(JSON.stringify(raw), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const out = await new QbtClient(CFG).listTorrents({ tag: "dublyarr-1" });
    expect(String(fetchMock.mock.calls[1][0])).toContain("tag=dublyarr-1");
    expect(out).toEqual([
      {
        hash: "deadbeef",
        name: "Rick.and.Morty.S01",
        progress: 0.42,
        state: "downloading",
        savePath: "/staging",
        contentPath: "/staging/Rick.and.Morty.S01",
        size: 1000,
        dlspeed: 99,
        tags: ["dublyarr-1", "other"],
      },
    ]);
  });
});

describe("qbtStateToStatus", () => {
  test("error и missingFiles → failed", () => {
    expect(qbtStateToStatus("error", 0.5)).toBe("failed");
    expect(qbtStateToStatus("missingFiles", 1)).toBe("failed");
  });
  test("progress >= 1 → completed", () => {
    expect(qbtStateToStatus("uploading", 1)).toBe("completed");
    expect(qbtStateToStatus("pausedUP", 1)).toBe("completed");
  });
  test("иначе downloading", () => {
    expect(qbtStateToStatus("downloading", 0.5)).toBe("downloading");
    expect(qbtStateToStatus("stalledDL", 0)).toBe("downloading");
  });
});
```

- [ ] **Step 2: Прогнать тесты — убедиться, что падают**

Run: `npm test -w @dublyarr/core -- qbittorrent`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать клиент**

Создать `packages/core/src/qbittorrent.ts`:

```ts
export interface QbtConfig {
  url: string;
  username: string;
  password: string;
}

export class QbtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QbtError";
  }
}

export interface QbtTorrent {
  hash: string;
  name: string;
  progress: number;
  state: string;
  savePath: string;
  contentPath: string;
  size: number;
  dlspeed: number;
  tags: string[];
}

export interface QbtFile {
  name: string;
  size: number;
  progress: number;
}

/** Маппинг состояния qBittorrent в статус загрузки Dublyarr. */
export function qbtStateToStatus(
  state: string,
  progress: number,
): "downloading" | "completed" | "failed" {
  if (state === "error" || state === "missingFiles") return "failed";
  if (progress >= 1) return "completed";
  return "downloading";
}

export class QbtClient {
  private cookie: string | null = null;

  constructor(private cfg: QbtConfig) {}

  private async login(): Promise<void> {
    const res = await fetch(new URL("/api/v2/auth/login", this.cfg.url), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: this.cfg.url,
      },
      body: new URLSearchParams({
        username: this.cfg.username,
        password: this.cfg.password,
      }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok || text.trim() !== "Ok.") {
      throw new QbtError("Неверный логин или пароль qBittorrent");
    }
    const m = (res.headers.get("set-cookie") ?? "").match(/SID=[^;]+/);
    if (!m) throw new QbtError("qBittorrent не вернул cookie сессии");
    this.cookie = m[0];
  }

  private async request(
    path: string,
    init: RequestInit = {},
    retry = true,
  ): Promise<Response> {
    if (!this.cookie) await this.login();
    const res = await fetch(new URL(path, this.cfg.url), {
      ...init,
      headers: {
        ...((init.headers as Record<string, string>) ?? {}),
        Cookie: this.cookie!,
        Referer: this.cfg.url,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 403 && retry) {
      this.cookie = null;
      return this.request(path, init, false);
    }
    if (!res.ok) throw new QbtError(`qBittorrent ${res.status} ${res.statusText}`);
    return res;
  }

  async version(): Promise<string> {
    return (await this.request("/api/v2/app/version")).text();
  }

  async addTorrent(opts: {
    url: string;
    savePath?: string;
    category?: string;
    tags?: string;
  }): Promise<void> {
    const body = new URLSearchParams({ urls: opts.url });
    if (opts.savePath) body.set("savepath", opts.savePath);
    if (opts.category) body.set("category", opts.category);
    if (opts.tags) body.set("tags", opts.tags);
    const res = await this.request("/api/v2/torrents/add", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const text = await res.text();
    if (text.trim() === "Fails.") throw new QbtError("qBittorrent отклонил раздачу");
  }

  async listTorrents(
    filter: { tag?: string; hashes?: string[] } = {},
  ): Promise<QbtTorrent[]> {
    const params = new URLSearchParams();
    if (filter.tag) params.set("tag", filter.tag);
    if (filter.hashes?.length) params.set("hashes", filter.hashes.join("|"));
    const qs = params.toString();
    const res = await this.request(`/api/v2/torrents/info${qs ? `?${qs}` : ""}`);
    const raw = (await res.json()) as Record<string, unknown>[];
    return raw.map((t) => ({
      hash: String(t.hash ?? ""),
      name: String(t.name ?? ""),
      progress: Number(t.progress ?? 0),
      state: String(t.state ?? ""),
      savePath: String(t.save_path ?? ""),
      contentPath: String(t.content_path ?? ""),
      size: Number(t.size ?? 0),
      dlspeed: Number(t.dlspeed ?? 0),
      tags: String(t.tags ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    }));
  }

  async listFiles(hash: string): Promise<QbtFile[]> {
    const res = await this.request(
      `/api/v2/torrents/files?hash=${encodeURIComponent(hash)}`,
    );
    const raw = (await res.json()) as Record<string, unknown>[];
    return raw.map((f) => ({
      name: String(f.name ?? ""),
      size: Number(f.size ?? 0),
      progress: Number(f.progress ?? 0),
    }));
  }

  async deleteTorrent(hash: string, deleteFiles: boolean): Promise<void> {
    await this.request("/api/v2/torrents/delete", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        hashes: hash,
        deleteFiles: String(deleteFiles),
      }).toString(),
    });
  }
}
```

- [ ] **Step 4: Добавить export-путь**

В `packages/core/package.json` в `exports` добавить:

```json
    "./qbittorrent": "./src/qbittorrent.ts",
```

- [ ] **Step 5: Прогнать тесты**

Run: `npm test -w @dublyarr/core -- qbittorrent`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/qbittorrent.ts packages/core/package.json packages/core/test/qbittorrent.test.ts
git commit -m "feat(core): клиент qBittorrent Web API v2"
```

---

### Task 5: db/files.ts — файлы библиотеки

**Files:**
- Create: `packages/core/src/db/files.ts`
- Modify: `packages/core/src/db/index.ts`
- Test: `packages/core/test/files.test.ts`

- [ ] **Step 1: Написать падающие тесты**

Создать `packages/core/test/files.test.ts`:

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  addFile,
  addTitle,
  deleteFileRecord,
  listEpisodes,
  listFiles,
  openDb,
  syncEpisodes,
  titleFileStats,
} from "../src/db/index.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-files-"));
const { db } = openDb(join(dir, "files.db"));

const title = addTitle(db, {
  tmdbId: 60625,
  type: "tv",
  titleRu: "Рик и Морти",
  titleOriginal: "Rick and Morty",
  year: "2013",
  posterPath: null,
  overview: "",
  tmdbStatus: null,
  qualityPresetId: 1,
  voiceover: "Сыендук",
  monitorRule: "all",
});
syncEpisodes(
  db,
  title.id,
  [
    { season: 1, episode: 1, airDate: "2013-12-02", name: "Пилот" },
    { season: 1, episode: 2, airDate: "2013-12-09", name: "" },
  ],
  "all",
);

describe("files", () => {
  test("addFile с episodeId проставляет episodes.file_id", () => {
    const ep = listEpisodes(db, title.id)[0];
    const f = addFile(db, {
      titleId: title.id,
      episodeId: ep.id,
      path: "/lib/Rick/Season 01/e1.mkv",
      size: 1000,
      qualitySource: "WEB-DL",
      qualityResolution: "1080p",
      voiceoverStudio: "Сыендук",
      releaseGuid: "guid-1",
    });
    expect(f.id).toBeGreaterThan(0);
    expect(listEpisodes(db, title.id)[0].fileId).toBe(f.id);
  });

  test("listFiles отдаёт файлы тайтла", () => {
    const rows = listFiles(db, title.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe("/lib/Rick/Season 01/e1.mkv");
  });

  test("titleFileStats: файлы и недостающие wanted", () => {
    const stats = titleFileStats(db);
    expect(stats.get(title.id)).toEqual({ files: 1, missingWanted: 1 });
  });

  test("deleteFileRecord возвращает строку и чистит file_id", () => {
    const f = listFiles(db, title.id)[0];
    const removed = deleteFileRecord(db, f.id);
    expect(removed?.path).toBe("/lib/Rick/Season 01/e1.mkv");
    expect(listFiles(db, title.id)).toHaveLength(0);
    expect(listEpisodes(db, title.id)[0].fileId).toBeNull();
  });

  test("deleteFileRecord по несуществующему id → null", () => {
    expect(deleteFileRecord(db, 9999)).toBeNull();
  });
});
```

- [ ] **Step 2: Прогнать тесты — убедиться, что падают**

Run: `npm test -w @dublyarr/core -- files`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать files.ts**

Создать `packages/core/src/db/files.ts`:

```ts
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "./index.js";
import { episodes, files } from "./schema.js";

export type LibFile = typeof files.$inferSelect;

export interface FileInput {
  titleId: number;
  episodeId: number | null;
  path: string;
  size: number;
  qualitySource: string | null;
  qualityResolution: string | null;
  voiceoverStudio: string | null;
  releaseGuid: string | null;
}

export function addFile(db: Db, input: FileInput): LibFile {
  const row = db.insert(files).values(input).returning().get();
  if (input.episodeId != null) {
    db.update(episodes)
      .set({ fileId: row.id })
      .where(eq(episodes.id, input.episodeId))
      .run();
  }
  return row;
}

export function getFile(db: Db, id: number): LibFile | null {
  return db.select().from(files).where(eq(files.id, id)).get() ?? null;
}

export function listFiles(db: Db, titleId: number): LibFile[] {
  return db
    .select()
    .from(files)
    .where(eq(files.titleId, titleId))
    .orderBy(asc(files.path))
    .all();
}

/** Удаляет запись и отвязывает эпизоды; саму запись возвращает для unlink на диске. */
export function deleteFileRecord(db: Db, id: number): LibFile | null {
  const row = getFile(db, id);
  if (!row) return null;
  db.update(episodes).set({ fileId: null }).where(eq(episodes.fileId, id)).run();
  db.delete(files).where(eq(files.id, id)).run();
  return row;
}

export interface TitleFileStats {
  files: number;
  missingWanted: number;
}

/** Для бейджей «✓ / ⏳» на главной: число файлов и wanted-эпизодов без файла. */
export function titleFileStats(db: Db): Map<number, TitleFileStats> {
  const out = new Map<number, TitleFileStats>();
  const fileCounts = db
    .select({ titleId: files.titleId, c: sql<number>`count(*)` })
    .from(files)
    .groupBy(files.titleId)
    .all();
  for (const r of fileCounts) out.set(r.titleId, { files: r.c, missingWanted: 0 });
  const missing = db
    .select({ titleId: episodes.titleId, c: sql<number>`count(*)` })
    .from(episodes)
    .where(and(eq(episodes.wanted, 1), isNull(episodes.fileId)))
    .groupBy(episodes.titleId)
    .all();
  for (const r of missing) {
    const e = out.get(r.titleId) ?? { files: 0, missingWanted: 0 };
    e.missingWanted = r.c;
    out.set(r.titleId, e);
  }
  return out;
}
```

- [ ] **Step 4: Реэкспортировать**

В `packages/core/src/db/index.ts` добавить после существующих реэкспортов:

```ts
export * from "./files.js";
```

- [ ] **Step 5: Прогнать тесты**

Run: `npm test -w @dublyarr/core -- files`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/db/files.ts packages/core/src/db/index.ts packages/core/test/files.test.ts
git commit -m "feat(core): db-модуль files с привязкой к эпизодам и статистикой"
```

---

### Task 6: db/downloads.ts — очередь загрузок

**Files:**
- Create: `packages/core/src/db/downloads.ts`
- Modify: `packages/core/src/db/index.ts`
- Test: `packages/core/test/downloads.test.ts`

- [ ] **Step 1: Написать падающие тесты**

Создать `packages/core/test/downloads.test.ts`:

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  addTitle,
  createDownload,
  deleteDownload,
  getDownload,
  listDownloadsForTitle,
  openDb,
  updateDownload,
} from "../src/db/index.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-downloads-"));
const { db } = openDb(join(dir, "downloads.db"));

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

describe("downloads", () => {
  test("createDownload: уникальный tag с префиксом, JSON-поля парсятся", () => {
    const d = createDownload(db, {
      titleId: title.id,
      releaseGuid: "guid-1",
      releaseTitle: "Rick.and.Morty.S01.WEB-DL",
      episodesCovered: [1, 2, 3],
      voiceoverStudio: "Сыендук",
      qualitySource: "WEB-DL",
      qualityResolution: "1080p",
    });
    expect(d.tag).toMatch(/^dublyarr-/);
    expect(d.status).toBe("queued");
    expect(d.progress).toBe(0);
    expect(d.qbitHash).toBeNull();
    expect(d.episodesCovered).toEqual([1, 2, 3]);
  });

  test("updateDownload: статус, прогресс, hash", () => {
    const d = listDownloadsForTitle(db, title.id)[0];
    const up = updateDownload(db, d.id, {
      qbitHash: "deadbeef",
      status: "downloading",
      progress: 0.5,
    });
    expect(up).toMatchObject({ qbitHash: "deadbeef", status: "downloading", progress: 0.5 });
  });

  test("пустой patch возвращает текущую строку", () => {
    const d = listDownloadsForTitle(db, title.id)[0];
    expect(updateDownload(db, d.id, {})).toMatchObject({ id: d.id, status: "downloading" });
  });

  test("listDownloadsForTitle — новые сверху", () => {
    createDownload(db, {
      titleId: title.id,
      releaseGuid: "guid-2",
      releaseTitle: "второй",
      episodesCovered: [],
      voiceoverStudio: null,
      qualitySource: null,
      qualityResolution: null,
    });
    const rows = listDownloadsForTitle(db, title.id);
    expect(rows).toHaveLength(2);
    expect(rows[0].releaseGuid).toBe("guid-2");
  });

  test("deleteDownload удаляет, getDownload → null", () => {
    const rows = listDownloadsForTitle(db, title.id);
    deleteDownload(db, rows[0].id);
    expect(getDownload(db, rows[0].id)).toBeNull();
    expect(listDownloadsForTitle(db, title.id)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Прогнать тесты — убедиться, что падают**

Run: `npm test -w @dublyarr/core -- downloads`
Expected: FAIL.

- [ ] **Step 3: Реализовать downloads.ts**

Создать `packages/core/src/db/downloads.ts`:

```ts
import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { Db } from "./index.js";
import { downloads } from "./schema.js";

export type DownloadStatus =
  | "queued"
  | "downloading"
  | "completed"
  | "failed"
  | "imported";

/** Статусы, которые обновляются по qBittorrent при GET /api/downloads. */
export const REFRESHABLE_STATUSES: DownloadStatus[] = [
  "queued",
  "downloading",
  "completed",
];

export interface Download {
  id: number;
  titleId: number;
  releaseGuid: string;
  releaseTitle: string;
  qbitHash: string | null;
  tag: string;
  episodesCovered: number[];
  voiceoverStudio: string | null;
  qualitySource: string | null;
  qualityResolution: string | null;
  status: DownloadStatus;
  progress: number;
  error: string | null;
  createdAt: string;
}

export interface DownloadInput {
  titleId: number;
  releaseGuid: string;
  releaseTitle: string;
  episodesCovered: number[];
  voiceoverStudio: string | null;
  qualitySource: string | null;
  qualityResolution: string | null;
}

type Row = typeof downloads.$inferSelect;

function rowToDownload(row: Row): Download {
  return { ...row, episodesCovered: JSON.parse(row.episodesCovered) as number[] };
}

export function createDownload(db: Db, input: DownloadInput): Download {
  const row = db
    .insert(downloads)
    .values({
      titleId: input.titleId,
      releaseGuid: input.releaseGuid,
      releaseTitle: input.releaseTitle,
      tag: `dublyarr-${randomUUID()}`,
      episodesCovered: JSON.stringify(input.episodesCovered),
      voiceoverStudio: input.voiceoverStudio,
      qualitySource: input.qualitySource,
      qualityResolution: input.qualityResolution,
    })
    .returning()
    .get();
  return rowToDownload(row);
}

export function getDownload(db: Db, id: number): Download | null {
  const row = db.select().from(downloads).where(eq(downloads.id, id)).get();
  return row ? rowToDownload(row) : null;
}

export function listDownloadsForTitle(db: Db, titleId: number): Download[] {
  return db
    .select()
    .from(downloads)
    .where(eq(downloads.titleId, titleId))
    .orderBy(desc(downloads.id))
    .all()
    .map(rowToDownload);
}

export interface DownloadPatch {
  qbitHash?: string | null;
  status?: DownloadStatus;
  progress?: number;
  error?: string | null;
}

export function updateDownload(
  db: Db,
  id: number,
  patch: DownloadPatch,
): Download | null {
  if (Object.keys(patch).length === 0) return getDownload(db, id);
  const row = db
    .update(downloads)
    .set(patch)
    .where(eq(downloads.id, id))
    .returning()
    .get();
  return row ? rowToDownload(row) : null;
}

export function deleteDownload(db: Db, id: number): void {
  db.delete(downloads).where(eq(downloads.id, id)).run();
}
```

- [ ] **Step 4: Реэкспортировать**

В `packages/core/src/db/index.ts` добавить:

```ts
export * from "./downloads.js";
```

- [ ] **Step 5: Прогнать тесты**

Run: `npm test -w @dublyarr/core -- downloads`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/db/downloads.ts packages/core/src/db/index.ts packages/core/test/downloads.test.ts
git commit -m "feat(core): db-модуль downloads с tag-идентификацией для qBittorrent"
```

---

### Task 7: Импортёр — из staging в библиотеку

**Files:**
- Create: `packages/core/src/import.ts`
- Modify: `packages/core/package.json` (exports)
- Test: `packages/core/test/import.test.ts`

- [ ] **Step 1: Написать падающие тесты**

Создать `packages/core/test/import.test.ts`:

```ts
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  addTitle,
  createDownload,
  getDownload,
  listEpisodes,
  listFiles,
  openDb,
  syncEpisodes,
} from "../src/db/index.js";
import { importDownload } from "../src/import.js";
import { DEFAULT_NAMING_MOVIE, DEFAULT_NAMING_TV } from "../src/naming.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-import-"));
const { db } = openDb(join(dir, "import.db"));
const libraryDir = join(dir, "library");

function makeDownload(titleId: number) {
  return createDownload(db, {
    titleId,
    releaseGuid: "guid-imp",
    releaseTitle: "rel",
    episodesCovered: [],
    voiceoverStudio: "Сыендук",
    qualitySource: "WEB-DL",
    qualityResolution: "1080p",
  });
}

describe("importDownload: сериал", () => {
  const title = addTitle(db, {
    tmdbId: 60625,
    type: "tv",
    titleRu: "Рик и Морти",
    titleOriginal: "Rick and Morty",
    year: "2013",
    posterPath: null,
    overview: "",
    tmdbStatus: null,
    qualityPresetId: 1,
    voiceover: "Сыендук",
    monitorRule: "all",
  });
  syncEpisodes(
    db,
    title.id,
    [
      { season: 1, episode: 1, airDate: "2013-12-02", name: "Пилот" },
      { season: 1, episode: 2, airDate: "2013-12-09", name: "" },
    ],
    "all",
  );

  test("маппит файлы по SxxEyy, кладёт по шаблону, закрывает эпизоды", () => {
    const content = join(dir, "staging", "Rick.and.Morty.S01");
    mkdirSync(content, { recursive: true });
    writeFileSync(join(content, "Rick.and.Morty.S01E01.1080p.mkv"), "video-1");
    writeFileSync(join(content, "Rick.and.Morty.S01E02.1080p.mkv"), "video-22");
    writeFileSync(join(content, "readme.txt"), "не видео");

    const d = makeDownload(title.id);
    const result = importDownload(db, d, title, content, {
      libraryDir,
      template: DEFAULT_NAMING_TV,
    });
    expect(result.ok).toBe(true);
    const expected = join(
      libraryDir,
      "Rick and Morty",
      "Season 01",
      "Rick and Morty - S01E01 - WEB-DL 1080p Сыендук.mkv",
    );
    expect(existsSync(expected)).toBe(true);

    const eps = listEpisodes(db, title.id);
    expect(eps[0].fileId).not.toBeNull();
    expect(eps[1].fileId).not.toBeNull();
    expect(listFiles(db, title.id)).toHaveLength(2);
    expect(getDownload(db, d.id)?.status).toBe("imported");
  });

  test("нет видеофайлов → ошибка, статус не imported", () => {
    const content = join(dir, "staging", "empty-rel");
    mkdirSync(content, { recursive: true });
    writeFileSync(join(content, "только.txt"), "x");
    const d = makeDownload(title.id);
    const result = importDownload(db, d, title, content, {
      libraryDir,
      template: DEFAULT_NAMING_TV,
    });
    expect(result).toEqual({ ok: false, error: "В загрузке нет видеофайлов" });
    expect(getDownload(db, d.id)?.status).toBe("queued");
  });

  test("видео без метки серии → ошибка сопоставления", () => {
    const content = join(dir, "staging", "untagged");
    mkdirSync(content, { recursive: true });
    writeFileSync(join(content, "Rick.and.Morty.Full.1080p.mkv"), "x");
    const d = makeDownload(title.id);
    const result = importDownload(db, d, title, content, {
      libraryDir,
      template: DEFAULT_NAMING_TV,
    });
    expect(result).toEqual({
      ok: false,
      error: "Не удалось сопоставить файлы с сериями",
    });
  });
});

describe("importDownload: фильм", () => {
  const movie = addTitle(db, {
    tmdbId: 438631,
    type: "movie",
    titleRu: "Дюна",
    titleOriginal: "Dune",
    year: "2021",
    posterPath: null,
    overview: "",
    tmdbStatus: null,
    qualityPresetId: 1,
    voiceover: "any",
    monitorRule: "all",
  });

  test("берёт самый большой видеофайл, content_path может быть файлом", () => {
    const content = join(dir, "staging", "dune");
    mkdirSync(content, { recursive: true });
    writeFileSync(join(content, "sample.mkv"), "tiny");
    writeFileSync(join(content, "Dune.2021.BDRemux.mkv"), "big-movie-content");

    const d = createDownload(db, {
      titleId: movie.id,
      releaseGuid: "guid-dune",
      releaseTitle: "Dune BDRemux",
      episodesCovered: [],
      voiceoverStudio: "HDrezka",
      qualitySource: "BDRemux",
      qualityResolution: "2160p",
    });
    const result = importDownload(db, d, movie, content, {
      libraryDir,
      template: DEFAULT_NAMING_MOVIE,
    });
    expect(result.ok).toBe(true);
    const expected = join(
      libraryDir,
      "Dune (2021)",
      "Dune (2021) - BDRemux 2160p HDrezka.mkv",
    );
    expect(existsSync(expected)).toBe(true);
    const rows = listFiles(db, movie.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].episodeId).toBeNull();
    expect(rows[0].qualityResolution).toBe("2160p");
  });

  test("несуществующий contentPath → ошибка", () => {
    const d = makeDownload(movie.id);
    const result = importDownload(db, d, movie, join(dir, "нет-такого"), {
      libraryDir,
      template: DEFAULT_NAMING_MOVIE,
    });
    expect(result).toEqual({ ok: false, error: "Файлы загрузки не найдены на диске" });
  });
});
```

- [ ] **Step 2: Прогнать тесты — убедиться, что падают**

Run: `npm test -w @dublyarr/core -- import`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать import.ts**

Создать `packages/core/src/import.ts`:

```ts
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { addFile, type LibFile } from "./db/files.js";
import type { Download } from "./db/downloads.js";
import { updateDownload } from "./db/downloads.js";
import type { Db } from "./db/index.js";
import { listEpisodes, type Title } from "./db/titles.js";
import { renderTemplate } from "./naming.js";
import { parseEpisodeTag } from "./parser.js";
import { qualityKeyFor, qualityLabel } from "./quality.js";

const VIDEO_EXT = new Set([".mkv", ".mp4", ".avi", ".m4v"]);

export interface ImportOptions {
  libraryDir: string;
  template: string;
  /** Подменяется в тестах; по умолчанию hardlink с fallback на копию. */
  linkFile?: (src: string, dest: string) => void;
}

export type ImportResult =
  | { ok: true; files: LibFile[] }
  | { ok: false; error: string };

export function hardlinkOrCopy(src: string, dest: string): void {
  try {
    linkSync(src, dest);
  } catch {
    copyFileSync(src, dest);
  }
}

function listVideoFiles(root: string): { path: string; size: number }[] {
  const st = statSync(root);
  if (st.isFile()) {
    return VIDEO_EXT.has(extname(root).toLowerCase())
      ? [{ path: root, size: st.size }]
      : [];
  }
  const out: { path: string; size: number }[] = [];
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!VIDEO_EXT.has(extname(entry.name).toLowerCase())) continue;
    const p = join(entry.parentPath, entry.name);
    out.push({ path: p, size: statSync(p).size });
  }
  return out;
}

/**
 * Раскладывает завершённую загрузку в библиотеку: сериалы — по SxxEyy
 * из имён файлов, фильмы — самый большой видеофайл. При успехе пишет
 * files, проставляет episodes.file_id и переводит download в imported.
 * При ошибке БД не трогает — вызывающий решает, что писать в error.
 */
export function importDownload(
  db: Db,
  download: Download,
  title: Title,
  contentPath: string,
  opts: ImportOptions,
): ImportResult {
  if (!existsSync(contentPath)) {
    return { ok: false, error: "Файлы загрузки не найдены на диске" };
  }
  const videos = listVideoFiles(contentPath);
  if (videos.length === 0) {
    return { ok: false, error: "В загрузке нет видеофайлов" };
  }
  const link = opts.linkFile ?? hardlinkOrCopy;
  const qKey = qualityKeyFor(download.qualitySource, download.qualityResolution);
  const vars = {
    show: title.titleOriginal || title.titleRu,
    year: title.year,
    quality: qKey ? qualityLabel(qKey) : "",
    vo: download.voiceoverStudio ?? "",
  };
  const imported: LibFile[] = [];

  if (title.type === "movie") {
    const best = [...videos].sort((a, b) => b.size - a.size)[0];
    const dest = join(
      opts.libraryDir,
      renderTemplate(opts.template, vars) + extname(best.path).toLowerCase(),
    );
    mkdirSync(dirname(dest), { recursive: true });
    link(best.path, dest);
    imported.push(
      addFile(db, {
        titleId: title.id,
        episodeId: null,
        path: dest,
        size: best.size,
        qualitySource: download.qualitySource,
        qualityResolution: download.qualityResolution,
        voiceoverStudio: download.voiceoverStudio,
        releaseGuid: download.releaseGuid,
      }),
    );
  } else {
    const byKey = new Map(
      listEpisodes(db, title.id).map((e) => [`${e.season}:${e.episode}`, e]),
    );
    for (const v of videos) {
      const tag = parseEpisodeTag(basename(v.path));
      if (!tag) continue;
      const ep = byKey.get(`${tag.season}:${tag.episode}`);
      if (!ep || ep.fileId != null) continue;
      const dest = join(
        opts.libraryDir,
        renderTemplate(opts.template, {
          ...vars,
          season: tag.season,
          episode: tag.episode,
        }) + extname(v.path).toLowerCase(),
      );
      mkdirSync(dirname(dest), { recursive: true });
      link(v.path, dest);
      imported.push(
        addFile(db, {
          titleId: title.id,
          episodeId: ep.id,
          path: dest,
          size: v.size,
          qualitySource: download.qualitySource,
          qualityResolution: download.qualityResolution,
          voiceoverStudio: download.voiceoverStudio,
          releaseGuid: download.releaseGuid,
        }),
      );
    }
    if (imported.length === 0) {
      return { ok: false, error: "Не удалось сопоставить файлы с сериями" };
    }
  }

  updateDownload(db, download.id, { status: "imported", progress: 1, error: null });
  return { ok: true, files: imported };
}
```

- [ ] **Step 4: Добавить export-путь**

В `packages/core/package.json` в `exports` добавить:

```json
    "./import": "./src/import.ts",
```

- [ ] **Step 5: Прогнать тесты и typecheck**

Run: `npm test -w @dublyarr/core && npm run typecheck`
Expected: PASS / exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/import.ts packages/core/package.json packages/core/test/import.test.ts
git commit -m "feat(core): импорт загрузок в библиотеку по шаблонам имён"
```

---

### Task 8: API — POST /api/downloads, DELETE /api/downloads/[id], проверка qBittorrent

**Files:**
- Create: `apps/web/app/api/downloads/route.ts` (пока только POST; GET добавит Task 9)
- Create: `apps/web/app/api/downloads/[id]/route.ts`
- Create: `apps/web/server/qbt.ts`
- Modify: `apps/web/app/api/settings/test/route.ts`

Тонкие роуты — без unit-тестов (валидация и логика в core, проверка typecheck + e2e позже).

- [ ] **Step 1: Хелпер клиента qBittorrent из настроек**

Создать `apps/web/server/qbt.ts`:

```ts
import { getSetting, type Db } from "@dublyarr/core/db";
import { QbtClient } from "@dublyarr/core/qbittorrent";

/** null — qBittorrent не настроен (нет URL). */
export function qbtFromSettings(db: Db): QbtClient | null {
  const url = getSetting(db, "qbit_url");
  if (!url) return null;
  return new QbtClient({
    url,
    username: getSetting(db, "qbit_username") ?? "",
    password: getSetting(db, "qbit_password") ?? "",
  });
}
```

- [ ] **Step 2: POST /api/downloads**

Создать `apps/web/app/api/downloads/route.ts`:

```ts
import { NextResponse } from "next/server";
import {
  createDownload,
  getSetting,
  getTitle,
  listEpisodes,
  updateDownload,
} from "@dublyarr/core/db";
import { QbtError } from "@dublyarr/core/qbittorrent";
import { getDb } from "@/server/db";
import { qbtFromSettings } from "@/server/qbt";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const titleId = Number(body.titleId);
  const link = typeof body.link === "string" ? body.link : "";
  const guid = typeof body.guid === "string" ? body.guid : "";
  const releaseTitle = typeof body.title === "string" ? body.title : "";
  const seasons = Array.isArray(body.seasons)
    ? (body.seasons.filter((n) => Number.isInteger(n)) as number[])
    : [];
  const voiceoverStudio =
    typeof body.voiceoverStudio === "string" && body.voiceoverStudio
      ? body.voiceoverStudio
      : null;
  const qualitySource =
    typeof body.qualitySource === "string" && body.qualitySource
      ? body.qualitySource
      : null;
  const qualityResolution =
    typeof body.qualityResolution === "string" && body.qualityResolution
      ? body.qualityResolution
      : null;

  if (!Number.isInteger(titleId) || titleId <= 0 || !link) {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
  const db = getDb();
  const title = getTitle(db, titleId);
  if (!title) {
    return NextResponse.json({ error: "Тайтл не найден" }, { status: 404 });
  }
  const qbt = qbtFromSettings(db);
  if (!qbt) {
    return NextResponse.json({ error: "qBittorrent не настроен" }, { status: 400 });
  }

  const episodesCovered =
    title.type === "tv" && seasons.length > 0
      ? listEpisodes(db, titleId)
          .filter((e) => seasons.includes(e.season))
          .map((e) => e.id)
      : [];

  let download = createDownload(db, {
    titleId,
    releaseGuid: guid,
    releaseTitle,
    episodesCovered,
    voiceoverStudio,
    qualitySource,
    qualityResolution,
  });

  try {
    await qbt.addTorrent({
      url: link,
      savePath: getSetting(db, "staging_dir") || undefined,
      category: "dublyarr",
      tags: download.tag,
    });
  } catch (e) {
    const msg = e instanceof QbtError ? e.message : "qBittorrent недоступен";
    updateDownload(db, download.id, { status: "failed", error: msg });
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // qBittorrent не возвращает hash при добавлении — ищем по тегу
  for (let i = 0; i < 5; i++) {
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
      break; // hash доберётся при следующем GET-рефреше
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  return NextResponse.json(download, { status: 201 });
}
```

- [ ] **Step 3: DELETE /api/downloads/[id]**

Создать `apps/web/app/api/downloads/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { deleteDownload, getDownload } from "@dublyarr/core/db";
import { getDb } from "@/server/db";
import { qbtFromSettings } from "@/server/qbt";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  }
  const db = getDb();
  const download = getDownload(db, numId);
  if (!download) return NextResponse.json({ ok: true });

  if (download.qbitHash && download.status !== "imported") {
    const qbt = qbtFromSettings(db);
    if (qbt) {
      try {
        await qbt.deleteTorrent(download.qbitHash, true);
      } catch {
        // qBittorrent недоступен — строку всё равно удаляем
      }
    }
  }
  deleteDownload(db, numId);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Кнопка «Проверить qBittorrent» в settings/test**

В `apps/web/app/api/settings/test/route.ts`:
- расширить тип: `{ service: "tmdb" | "jackett" | "qbit" }`;
- добавить импорт `import { qbtFromSettings } from "@/server/qbt";`
- в `try` перед `else` добавить ветку:

```ts
    } else if (service === "qbit") {
      const qbt = qbtFromSettings(db);
      if (!qbt) throw new Error("qBittorrent не настроен");
      await qbt.version();
```

(итоговая цепочка: `if (service === "tmdb") {...} else if (service === "qbit") {...} else {...}`).

- [ ] **Step 5: Проверить typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/downloads apps/web/server/qbt.ts apps/web/app/api/settings/test/route.ts
git commit -m "feat(web): API ручного grab в qBittorrent и проверка подключения"
```

---

### Task 9: API — GET /api/downloads (рефреш + автоимпорт), DELETE /api/files/[id]

**Files:**
- Modify: `apps/web/app/api/downloads/route.ts` (добавить GET)
- Create: `apps/web/app/api/files/[id]/route.ts`

- [ ] **Step 1: GET /api/downloads?titleId=N**

В `apps/web/app/api/downloads/route.ts` дополнить импорты:

```ts
import {
  createDownload,
  getSetting,
  getTitle,
  listDownloadsForTitle,
  listEpisodes,
  updateDownload,
  REFRESHABLE_STATUSES,
  type Download,
} from "@dublyarr/core/db";
import { importDownload } from "@dublyarr/core/import";
import {
  DEFAULT_NAMING_MOVIE,
  DEFAULT_NAMING_TV,
} from "@dublyarr/core/naming";
import { QbtError, qbtStateToStatus, type QbtClient } from "@dublyarr/core/qbittorrent";
```

И добавить в файл:

```ts
async function refreshOne(
  db: ReturnType<typeof getDb>,
  qbt: QbtClient,
  d: Download,
): Promise<void> {
  const torrent = (await qbt.listTorrents({ tag: d.tag }))[0];

  if (d.status === "queued") {
    if (!torrent) return; // ещё не появился в qBittorrent
    d = updateDownload(db, d.id, {
      qbitHash: torrent.hash,
      status: "downloading",
      progress: torrent.progress,
    })!;
  }

  if (d.status === "downloading") {
    if (!torrent) {
      updateDownload(db, d.id, {
        status: "failed",
        error: "Раздача пропала из qBittorrent",
      });
      return;
    }
    const next = qbtStateToStatus(torrent.state, torrent.progress);
    if (next === "failed") {
      updateDownload(db, d.id, {
        status: "failed",
        error: `qBittorrent: ${torrent.state}`,
      });
      return;
    }
    d = updateDownload(db, d.id, { status: next, progress: torrent.progress })!;
  }

  if (d.status === "completed") {
    if (!torrent?.contentPath) return;
    const title = getTitle(db, d.titleId);
    if (!title) return;
    const libraryDir = getSetting(
      db,
      title.type === "tv" ? "library_tv" : "library_movies",
    );
    if (!libraryDir) {
      updateDownload(db, d.id, {
        error: "Не настроена папка библиотеки (Настройки → Папки и имена)",
      });
      return;
    }
    const template =
      getSetting(db, title.type === "tv" ? "naming_tv" : "naming_movie") ||
      (title.type === "tv" ? DEFAULT_NAMING_TV : DEFAULT_NAMING_MOVIE);
    const result = importDownload(db, d, title, torrent.contentPath, {
      libraryDir,
      template,
    });
    if (!result.ok) updateDownload(db, d.id, { error: result.error });
  }
}

export async function GET(req: Request) {
  const titleId = Number(new URL(req.url).searchParams.get("titleId"));
  if (!Number.isInteger(titleId) || titleId <= 0) {
    return NextResponse.json({ error: "Некорректный titleId" }, { status: 400 });
  }
  const db = getDb();
  const qbt = qbtFromSettings(db);
  let qbtError: string | null = null;

  if (qbt) {
    const refreshable = listDownloadsForTitle(db, titleId).filter((d) =>
      REFRESHABLE_STATUSES.includes(d.status),
    );
    for (const d of refreshable) {
      try {
        await refreshOne(db, qbt, d);
      } catch (e) {
        qbtError = e instanceof QbtError ? e.message : "qBittorrent недоступен";
        break;
      }
    }
  }

  return NextResponse.json({
    downloads: listDownloadsForTitle(db, titleId),
    qbtError,
  });
}
```

Замечание: статус `completed` с заполненным `error` («Не настроена папка…», «Не удалось сопоставить…») — это «ждёт импорта»: следующий GET попробует импорт снова, когда пользователь поправит настройки.

- [ ] **Step 2: DELETE /api/files/[id]**

Создать `apps/web/app/api/files/[id]/route.ts`:

```ts
import { unlinkSync } from "node:fs";
import { NextResponse } from "next/server";
import { deleteFileRecord } from "@dublyarr/core/db";
import { getDb } from "@/server/db";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  }
  const row = deleteFileRecord(getDb(), numId);
  if (row) {
    try {
      unlinkSync(row.path);
    } catch {
      // файла уже нет на диске — запись всё равно удалена
    }
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Проверить typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/downloads/route.ts apps/web/app/api/files
git commit -m "feat(web): рефреш статусов загрузок с автоимпортом и удаление файлов"
```

---

### Task 10: Таблица раздач с кнопкой «Скачать»

**Files:**
- Modify: `apps/web/app/title/[type]/[id]/Availability.tsx`
- Create: `apps/web/app/title/[type]/[id]/DownloadButton.tsx`
- Modify: `apps/web/app/title/[type]/[id]/page.tsx` (передать `titleId`)
- Modify: `apps/web/app/title/[type]/[id]/title.module.css`

- [ ] **Step 1: DownloadButton (клиентский)**

Создать `apps/web/app/title/[type]/[id]/DownloadButton.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./tracking.module.css";

export interface GrabPayload {
  titleId: number;
  guid: string;
  link: string;
  title: string;
  voiceoverStudio: string | null;
  qualitySource: string | null;
  qualityResolution: string | null;
  seasons: number[];
}

export function DownloadButton({ payload }: { payload: GrabPayload }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function grab() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/downloads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Ошибка ${res.status}`);
        return;
      }
      router.refresh();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className={styles.grab}>
      <button
        type="button"
        className={styles.primary}
        disabled={busy}
        onClick={grab}
        data-testid="release-download"
      >
        {busy ? "Добавляю…" : "Скачать"}
      </button>
      {error && <span className={styles.error}>{error}</span>}
    </span>
  );
}
```

- [ ] **Step 2: Availability — раздачи после сводки**

Переписать `apps/web/app/title/[type]/[id]/Availability.tsx` (один поиск Jackett, две таблицы):

```tsx
import { getSetting } from "@dublyarr/core/db";
import { searchJackett, type JackettRelease } from "@dublyarr/core/jackett";
import {
  compressSeasons,
  parseRelease,
  summarizeStudioAvailability,
  type ParsedRelease,
} from "@dublyarr/core/parser";
import { getDb } from "@/server/db";
import { DownloadButton, type GrabPayload } from "./DownloadButton";
import styles from "./title.module.css";

function formatGb(size: number): string {
  return `${(size / 2 ** 30).toFixed(2)} ГБ`;
}

function grabPayload(
  titleId: number,
  r: ParsedRelease<JackettRelease>,
): GrabPayload {
  const studios = r.parsed.voiceovers.flatMap((v) => v.studios);
  return {
    titleId,
    guid: r.guid,
    link: r.link,
    title: r.title,
    voiceoverStudio: studios[0] ?? null,
    qualitySource: r.parsed.quality.source,
    qualityResolution: r.parsed.quality.resolution,
    seasons: r.parsed.seasons,
  };
}

export async function Availability({
  query,
  titleId,
}: {
  query: string;
  titleId: number | null;
}) {
  const db = getDb();
  const url = getSetting(db, "jackett_url");
  const apiKey = getSetting(db, "jackett_api_key");
  if (!url || !apiKey) {
    return (
      <p className={styles.muted}>
        Настройте Jackett в <a href="/settings?tab=integrations">настройках</a>, чтобы видеть озвучки.
      </p>
    );
  }

  let releases: ParsedRelease<JackettRelease>[];
  try {
    releases = (await searchJackett({ url, apiKey }, query)).map(parseRelease);
  } catch (e) {
    return (
      <p className={styles.muted}>
        Jackett недоступен: {e instanceof Error ? e.message : String(e)}
      </p>
    );
  }

  const rows = summarizeStudioAvailability(releases);
  if (rows.length === 0) return <p className={styles.muted}>Раздач не найдено.</p>;

  const top = releases
    .filter((r) => r.link)
    .sort((a, b) => b.seeders - a.seeders)
    .slice(0, 30);

  return (
    <>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Озвучка</th><th>Тип</th><th>Сезоны</th><th>Качество</th><th>Раздач</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.studio}-${r.kind}`}>
                <td data-label="Озвучка"><b>{r.studio}</b></td>
                <td data-label="Тип">{r.kind}</td>
                <td data-label="Сезоны">{compressSeasons(r.seasons)}</td>
                <td data-label="Качество">{r.qualities.join(" · ") || "—"}</td>
                <td data-label="Раздач">{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Раздачи</h2>
      {titleId == null && (
        <p className={styles.muted}>
          Добавьте тайтл в отслеживание, чтобы скачивать раздачи.
        </p>
      )}
      <div className={styles.tableWrap} data-testid="release-list">
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Название</th><th>Озвучки</th><th>Качество</th><th>Размер</th><th>Сиды</th>
              {titleId != null && <th />}
            </tr>
          </thead>
          <tbody>
            {top.map((r) => (
              <tr key={r.guid || r.link}>
                <td data-label="Название" className={styles.releaseTitle}>{r.title}</td>
                <td data-label="Озвучки">
                  {[...new Set(r.parsed.voiceovers.flatMap((v) => v.studios))].join(", ") || "—"}
                </td>
                <td data-label="Качество">
                  {[r.parsed.quality.source, r.parsed.quality.resolution]
                    .filter(Boolean)
                    .join(" ") || "—"}
                </td>
                <td data-label="Размер">{formatGb(r.size)}</td>
                <td data-label="Сиды">{r.seeders}</td>
                {titleId != null && (
                  <td data-label="">
                    <DownloadButton payload={grabPayload(titleId, r)} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Передать titleId из страницы**

В `apps/web/app/title/[type]/[id]/page.tsx` заменить вызов:

```tsx
        <Availability
          query={details.originalTitle || details.title}
          titleId={trackedTitle?.id ?? null}
        />
```

- [ ] **Step 4: Стили**

В `apps/web/app/title/[type]/[id]/title.module.css` добавить:

```css
.releaseTitle {
  max-width: 380px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

В `apps/web/app/title/[type]/[id]/tracking.module.css` добавить:

```css
.grab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
```

- [ ] **Step 5: Проверить typecheck и e2e тайтла**

Run: `npm run typecheck && npm run test:e2e -w @dublyarr/web -- title`
Expected: exit 0 / PASS (спека тайтла gated по TMDB_API_KEY — допустим skip без ключа).

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/title
git commit -m "feat(web): таблица раздач с кнопкой «Скачать» на странице тайтла"
```

---

### Task 11: Блок загрузок, список файлов, ✓ у серий

**Files:**
- Create: `apps/web/app/title/[type]/[id]/DownloadsBlock.tsx`
- Create: `apps/web/app/title/[type]/[id]/FilesList.tsx`
- Modify: `apps/web/app/title/[type]/[id]/EpisodeList.tsx`
- Modify: `apps/web/app/title/[type]/[id]/page.tsx`
- Modify: `apps/web/app/title/[type]/[id]/tracking.module.css`

- [ ] **Step 1: DownloadsBlock (клиентский, поллинг)**

Создать `apps/web/app/title/[type]/[id]/DownloadsBlock.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./tracking.module.css";

export interface DownloadView {
  id: number;
  releaseTitle: string;
  status: "queued" | "downloading" | "completed" | "failed" | "imported";
  progress: number;
  error: string | null;
}

const STATUS_RU: Record<DownloadView["status"], string> = {
  queued: "в очереди",
  downloading: "качается",
  completed: "скачано, импортирую…",
  failed: "ошибка",
  imported: "импортировано",
};

const ACTIVE = new Set(["queued", "downloading", "completed"]);

export function DownloadsBlock({
  titleId,
  initial,
}: {
  titleId: number;
  initial: DownloadView[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [qbtError, setQbtError] = useState<string | null>(null);
  const importedIds = useRef(new Set(initial.filter((d) => d.status === "imported").map((d) => d.id)));

  useEffect(() => {
    if (!rows.some((d) => ACTIVE.has(d.status))) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/downloads?titleId=${titleId}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          downloads: DownloadView[];
          qbtError: string | null;
        };
        setRows(data.downloads);
        setQbtError(data.qbtError);
        const newlyImported = data.downloads.some(
          (d) => d.status === "imported" && !importedIds.current.has(d.id),
        );
        for (const d of data.downloads) {
          if (d.status === "imported") importedIds.current.add(d.id);
        }
        if (newlyImported) router.refresh();
      } catch {
        setQbtError("Сеть недоступна");
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [rows, titleId, router]);

  async function remove(id: number) {
    if (!window.confirm("Удалить загрузку? Раздача будет удалена из qBittorrent.")) return;
    try {
      const res = await fetch(`/api/downloads/${id}`, { method: "DELETE" });
      if (res.ok) {
        setRows((prev) => prev.filter((d) => d.id !== id));
        router.refresh();
      }
    } catch {
      setQbtError("Сеть недоступна");
    }
  }

  if (rows.length === 0) return null;

  return (
    <section className={styles.block} data-testid="downloads-block">
      <h2>Загрузки</h2>
      {qbtError && <p className={styles.error}>{qbtError}</p>}
      <ul className={styles.downloadList}>
        {rows.map((d) => (
          <li key={d.id} className={styles.downloadRow}>
            <span className={styles.downloadTitle}>{d.releaseTitle || `Загрузка #${d.id}`}</span>
            <span>
              {STATUS_RU[d.status]}
              {d.status === "downloading" && ` ${Math.round(d.progress * 100)}%`}
            </span>
            {d.status === "downloading" && (
              <span className={styles.progressTrack}>
                <span
                  className={styles.progressFill}
                  style={{ width: `${Math.round(d.progress * 100)}%` }}
                />
              </span>
            )}
            {d.error && <span className={styles.error}>{d.error}</span>}
            <button type="button" className={styles.danger} onClick={() => remove(d.id)}>
              Удалить
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: FilesList (клиентский)**

Создать `apps/web/app/title/[type]/[id]/FilesList.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./tracking.module.css";

export interface FileView {
  id: number;
  path: string;
  size: number;
  quality: string;
  voiceover: string;
}

export function FilesList({ files }: { files: FileView[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function remove(id: number) {
    if (!window.confirm("Удалить файл с диска?")) return;
    setError(null);
    try {
      const res = await fetch(`/api/files/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setError(`Ошибка ${res.status}`);
        return;
      }
      router.refresh();
    } catch {
      setError("Сеть недоступна");
    }
  }

  if (files.length === 0) return null;

  return (
    <section className={styles.block} data-testid="files-list">
      <h2>Файлы</h2>
      {error && <p className={styles.error}>{error}</p>}
      <ul className={styles.downloadList}>
        {files.map((f) => (
          <li key={f.id} className={styles.downloadRow}>
            <span className={styles.downloadTitle}>{f.path}</span>
            <span>
              {(f.size / 2 ** 30).toFixed(2)} ГБ · {f.quality || "—"} · {f.voiceover || "—"}
            </span>
            <button type="button" className={styles.danger} onClick={() => remove(f.id)}>
              Удалить
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 3: ✓ у серий с файлом**

В `apps/web/app/title/[type]/[id]/EpisodeList.tsx`:
- в тип элемента `episodes` (и `EpisodeRow`, если тип общий) добавить поле `fileId: number | null`;
- в разметке строки серии сразу после названия/даты добавить:

```tsx
              {e.fileId != null && <span className={styles.have}>✓</span>}
```

- [ ] **Step 4: Вмонтировать в страницу**

В `apps/web/app/title/[type]/[id]/page.tsx`:

Импорты:

```tsx
import { getSetting, getTitleByTmdb, listDownloadsForTitle, listEpisodes, listFiles, listPresets } from "@dublyarr/core/db";
import { qualityKeyFor, qualityLabel } from "@dublyarr/core/quality";
import { DownloadsBlock } from "./DownloadsBlock";
import { FilesList } from "./FilesList";
```

После `episodeRows` добавить:

```tsx
  const downloadRows = trackedTitle
    ? listDownloadsForTitle(db, trackedTitle.id).map((d) => ({
        id: d.id,
        releaseTitle: d.releaseTitle,
        status: d.status,
        progress: d.progress,
        error: d.error,
      }))
    : [];
  const fileRows = trackedTitle
    ? listFiles(db, trackedTitle.id).map((f) => {
        const key = qualityKeyFor(f.qualitySource, f.qualityResolution);
        return {
          id: f.id,
          path: f.path,
          size: f.size,
          quality: key ? qualityLabel(key) : "",
          voiceover: f.voiceoverStudio ?? "",
        };
      })
    : [];
```

В `episodeRows` маппинг добавить `fileId: e.fileId,`.

В JSX после `<TrackingBlock …/>` добавить:

```tsx
      {trackedTitle && <DownloadsBlock titleId={trackedTitle.id} initial={downloadRows} />}
```

И в самом конце, после блока `EpisodeList`:

```tsx
      <FilesList files={fileRows} />
```

- [ ] **Step 5: Стили**

В `apps/web/app/title/[type]/[id]/tracking.module.css` добавить:

```css
.downloadList {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.downloadRow {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 14px;
}

.downloadTitle {
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.progressTrack {
  width: 140px;
  height: 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.12);
  overflow: hidden;
}

.progressFill {
  display: block;
  height: 100%;
  background: var(--accent);
}

.have {
  color: var(--ok);
  margin-left: 6px;
}
```

- [ ] **Step 6: Проверить typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/title
git commit -m "feat(web): блок загрузок с поллингом, список файлов и метки серий"
```

---

### Task 12: Настройки — поля qBittorrent и вкладка «Папки и имена»

**Files:**
- Modify: `apps/web/app/settings/SettingsForm.tsx`
- Create: `apps/web/app/settings/FoldersForm.tsx`
- Modify: `apps/web/app/settings/page.tsx`

- [ ] **Step 1: Поля qBittorrent в «Интеграциях»**

В `apps/web/app/settings/SettingsForm.tsx`:

Заменить тип и FIELDS:

```tsx
type Values = Record<
  | "tmdb_api_key"
  | "jackett_url"
  | "jackett_api_key"
  | "qbit_url"
  | "qbit_username"
  | "qbit_password",
  string | null
>;

const FIELDS = [
  { key: "tmdb_api_key", label: "TMDb API ключ", type: "password" },
  { key: "jackett_url", label: "Jackett URL", type: "text" },
  { key: "jackett_api_key", label: "Jackett API ключ", type: "password" },
  { key: "qbit_url", label: "qBittorrent URL", type: "text" },
  { key: "qbit_username", label: "qBittorrent логин", type: "text" },
  { key: "qbit_password", label: "qBittorrent пароль", type: "password" },
] as const;
```

Расширить `testConnection`: тип параметра `service: "tmdb" | "jackett" | "qbit"`, и в `actions` добавить кнопку:

```tsx
        <button onClick={() => testConnection("qbit")}>Проверить qBittorrent</button>
```

- [ ] **Step 2: FoldersForm**

Создать `apps/web/app/settings/FoldersForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import { DEFAULT_NAMING_MOVIE, DEFAULT_NAMING_TV } from "@dublyarr/core/naming";
import styles from "./settings.module.css";

type Values = Record<
  "library_movies" | "library_tv" | "staging_dir" | "naming_tv" | "naming_movie",
  string | null
>;

const FIELDS = [
  { key: "library_movies", label: "Папка фильмов", placeholder: "/media/movies" },
  { key: "library_tv", label: "Папка сериалов", placeholder: "/media/tv" },
  {
    key: "staging_dir",
    label: "Папка загрузок (staging)",
    placeholder: "пусто — папка qBittorrent по умолчанию",
  },
  { key: "naming_tv", label: "Шаблон имени серии", placeholder: DEFAULT_NAMING_TV },
  { key: "naming_movie", label: "Шаблон имени фильма", placeholder: DEFAULT_NAMING_MOVIE },
] as const;

export function FoldersForm({ initial }: { initial: Values }) {
  const [values, setValues] = useState<Values>(initial);
  const [status, setStatus] = useState<string | null>(null);

  async function save() {
    setStatus(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      setStatus(res.ok ? "Сохранено" : "Ошибка сохранения");
    } catch {
      setStatus("Сеть недоступна");
    }
  }

  return (
    <div className={styles.card} data-testid="folders-form">
      {FIELDS.map((f) => (
        <label key={f.key} className={styles.field}>
          <span>{f.label}</span>
          <input
            type="text"
            placeholder={f.placeholder}
            value={values[f.key] ?? ""}
            onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
          />
        </label>
      ))}
      <p className={styles.muted}>
        Токены шаблонов: {"{Show} {Year} {ss} {ee} {Quality} {VO}"}. Пустой шаблон —
        значение по умолчанию из подсказки.
      </p>
      <div className={styles.actions}>
        <button onClick={save}>Сохранить</button>
      </div>
      {status && <p className={styles.ok}>{status}</p>}
    </div>
  );
}
```

(Если в `settings.module.css` нет класса `.muted` — добавить: `.muted { color: var(--muted, #9a9a9a); font-size: 13px; }`.)

- [ ] **Step 3: Третья вкладка**

В `apps/web/app/settings/page.tsx`:

```tsx
import { FoldersForm } from "./FoldersForm";

const TABS = [
  { key: "quality", label: "Качество" },
  { key: "integrations", label: "Интеграции" },
  { key: "folders", label: "Папки и имена" },
] as const;
```

Вычисление active:

```tsx
  const active =
    tab === "integrations" ? "integrations" : tab === "folders" ? "folders" : "quality";
```

Рендер контента:

```tsx
      {active === "quality" ? (
        <PresetsEditor initial={listPresets(db)} />
      ) : active === "folders" ? (
        <FoldersForm initial={getAllSettings(db)} />
      ) : (
        <SettingsForm initial={getAllSettings(db)} />
      )}
```

- [ ] **Step 4: Проверить typecheck и e2e настроек**

Run: `npm run typecheck && npm run test:e2e -w @dublyarr/web -- settings presets`
Expected: exit 0 / PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/settings
git commit -m "feat(web): настройки qBittorrent и вкладка «Папки и имена»"
```

---

### Task 13: Бейджи «✓ / ⏳» на главной

**Files:**
- Modify: `apps/web/app/page.tsx`

- [ ] **Step 1: Реальный статус вместо заглушки ⏳**

В `apps/web/app/page.tsx`:

Импорт: добавить `titleFileStats` в импорт из `@dublyarr/core/db`.

После получения списка тайтлов добавить:

```tsx
  const stats = titleFileStats(db);

  function downloadBadge(t: { id: number; type: string }) {
    const st = stats.get(t.id);
    const hasFiles = (st?.files ?? 0) > 0;
    const done =
      t.type === "movie" ? hasFiles : hasFiles && (st?.missingWanted ?? 0) === 0;
    return done ? { text: "✓", color: "var(--ok)" } : { text: "⏳" };
  }
```

И заменить текущий `bottomRight={{ text: "⏳" }}` (в обеих секциях — Сериалы и Фильмы) на:

```tsx
              bottomRight={downloadBadge(t)}
```

- [ ] **Step 2: Проверить typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/page.tsx
git commit -m "feat(web): бейдж скачанности на карточках главной"
```

---

### Task 14: e2e и README

**Files:**
- Create: `apps/web/e2e/folders.spec.ts`
- Modify: `apps/web/e2e/settings.spec.ts` (проверка трёх вкладок — только если её нет)
- Modify: `README.md`

- [ ] **Step 1: e2e вкладки «Папки и имена»**

Создать `apps/web/e2e/folders.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("вкладка «Папки и имена»: сохранение переживает перезагрузку", async ({ page }) => {
  await page.goto("/settings?tab=folders");
  await expect(page.getByTestId("folders-form")).toBeVisible();

  await page.getByLabel("Папка фильмов").fill("/tmp/dublyarr-movies");
  await page.getByLabel("Папка сериалов").fill("/tmp/dublyarr-tv");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Сохранено")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Папка фильмов")).toHaveValue("/tmp/dublyarr-movies");
  await expect(page.getByLabel("Папка сериалов")).toHaveValue("/tmp/dublyarr-tv");
});

test("в настройках три вкладки и поля qBittorrent", async ({ page }) => {
  await page.goto("/settings?tab=integrations");
  const tabs = page.getByTestId("settings-tabs");
  await expect(tabs.getByText("Качество")).toBeVisible();
  await expect(tabs.getByText("Интеграции")).toBeVisible();
  await expect(tabs.getByText("Папки и имена")).toBeVisible();
  await expect(page.getByLabel("qBittorrent URL")).toBeVisible();
});
```

- [ ] **Step 2: Прогнать e2e**

Run: `npm run test:e2e -w @dublyarr/web`
Expected: все спеки PASS (tracking gated по TMDB_API_KEY из `.env`); ноль failed.

- [ ] **Step 3: README**

В `README.md` после секции «Что умеет (M2a)» добавить:

```markdown
## Что умеет (M2b)

- Таблица раздач на странице тайтла: озвучки, качество, размер, сиды, кнопка «Скачать».
- Ручной grab → qBittorrent (category `dublyarr`, опционально staging-папка) с отслеживанием прогресса.
- Автоимпорт завершённых загрузок в библиотеку: hardlink/копия по шаблону имён
  (`{Show}/Season {ss}/{Show} - S{ss}E{ee} - {Quality} {VO}`), маппинг серий по SxxEyy.
- Список файлов тайтла с удалением; метка ✓ у скачанных серий; бейдж ✓/⏳ на главной.
- Настройки: подключение qBittorrent (с проверкой), вкладка «Папки и имена»
  (папки библиотек, staging, шаблоны имён).
```

- [ ] **Step 4: Полная проверка**

Run: `npm test && npm run typecheck && npm run test:e2e -w @dublyarr/web`
Expected: все unit зелёные, typecheck чистый, e2e без failed.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/folders.spec.ts README.md
git commit -m "test(web): e2e вкладки «Папки и имена»; README M2b"
```

---

## Чего сознательно нет в M2b

- **Воркер/cron, авто-поиск, скоринг, авто-grab** — M3 (конвейер из спеки §7).
- **Кнопка «Искать сейчас»** — M3 (она запускает конвейер).
- **Календарь и страница «Активность»** — M3; пока статусы загрузок видны на странице тайтла.
- **history / blacklist** — M3.
- **Апгрейды качества с удалением старого файла** — M3 (флаг `upgrade_enabled` уже хранится).
- **Сидирование-политики, лимиты, ratio** — управляются самим qBittorrent.
- **Auth, Docker, CI-релизы** — M4.
- `downloads.episodes_covered` заполняется, но потребитель у него — воркер M3 (выбор «что ещё докачивать»); импорт ориентируется на фактические имена файлов.

## Заметки для ревьюеров

- Статусы обновляются **только при GET /api/downloads** (поллинг со страницы тайтла каждые 4 с, пока есть активные) — это сознательная модель до появления воркера в M3.
- `completed` + непустой `error` = «ждёт импорта» (например, не настроена библиотека); следующий GET повторит импорт. Терминальные статусы — `failed` и `imported`.
- Идентификация раздач в qBittorrent — по уникальному тегу `dublyarr-<uuid>` (torrents/add не возвращает hash).
- Перенос из M2a-бэклога, сделанный здесь: коэрсия malformed JSON через `req.json().catch(() => ({}))` в новых роутах.
