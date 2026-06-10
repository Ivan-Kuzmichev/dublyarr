# Dublyarr M3b — апгрейды качества, Календарь, Активность Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Воркер докачивает лучшее качество и заменяет старый файл (апгрейды по `upgrade_enabled`); добавляются страницы «Календарь» (агенда серий по датам) и «Активность» (все загрузки + лента событий) с бейджем-счётчиком активных загрузок в навигации.

**Architecture:** Апгрейд встроен в `importDownload` как правило «заменять файл, только если новый строго выше качеством» (никакого флага в БД — унифицирует обычный импорт и апгрейд); pipeline учится выбирать апгрейд-кандидатов, когда ничего не отсутствует. Новые чистые db-запросы (`listActiveDownloads`, `countActiveDownloads`, `listCalendar`) и `pollAll` (рефреш всех загрузок) питают тонкие API-роуты и серверные страницы; клиентские поллеры обновляют прогресс и бейдж.

**Tech Stack:** Drizzle ORM + better-sqlite3, Next.js 15 (App Router, RSC + client components), Vitest, Playwright, CSS Modules (без Tailwind).

---

## Контекст для исполнителя

- Монорепо npm workspaces: `packages/core` (`@dublyarr/core`), `apps/web` (Next.js 15), `apps/worker`. Внутри core импорты с расширением `.js`.
- Качество: `@dublyarr/core/quality` — `qualityKeyFor(source, resolution): string|null`, `qualityRank(key): number` (выше = лучше, `-1` если ключ не в лестнице), `qualityLabel(key)`.
- `LibFile` (db/files.ts): `id, titleId, episodeId: number|null, path, size, qualitySource: string|null, qualityResolution: string|null, voiceoverStudio: string|null, releaseGuid: string|null`. `getFile(db, id)`, `listFiles(db, titleId)`, `addFile(db, input)` (проставляет `episodes.file_id`), `deleteFileRecord(db, id): LibFile|null` (отвязывает эпизоды, возвращает строку для unlink).
- `Episode`: `id, titleId, season, episode, airDate: string|null, nameRu, wanted: boolean, fileId: number|null`. `listEpisodes(db, titleId)`.
- `Title`: `id, type ("movie"|"tv"), titleRu, titleOriginal, year, voiceover, qualityPresetId, tracked: number`. `getTitle`, `listTrackedTitles`.
- `QualityPreset`: `{id, name, allowed: string[], preferred: string, upgradeEnabled: boolean}` через `getPreset(db, id)`.
- `Download` (db/downloads.ts): `id, titleId, releaseGuid, releaseTitle, qbitHash, tag, episodesCovered: number[], voiceoverStudio, qualitySource, qualityResolution, status, progress, error, createdAt`. `REFRESHABLE_STATUSES = ["queued","downloading","completed"]`. `listDownloadsForTitle`, `getDownload`, `updateDownload`, `createDownload`.
- `importDownload(db, download, title, contentPath, opts): ImportResult` (core/import.ts) — текущая версия в Задаче 1 расширяется.
- `refreshDownload`/`pollTitle` в `@dublyarr/core/poll`; `runTitle`/`selectCandidates`/`Candidate`/`RunDeps` в `@dublyarr/core/pipeline`; `runTick`/`runOneTitle` в `@dublyarr/core/tick`; `QbtClient` в `@dublyarr/core/qbittorrent` (метод `listTorrents`, `dlspeed` есть в `QbtTorrent`).
- `getDb()` — `apps/web/server/db.ts`; `qbtFromSettings(db)` — `apps/web/server/qbt.ts` (QbtClient|null).
- UI: `PosterCard` (components/PosterCard.tsx, props href/title/subtitle/posterUrl/badges); клиентский поллер-паттерн — `apps/web/app/title/[type]/[id]/DownloadsBlock.tsx` (setInterval 4000, fetch, router.refresh, prev-prop resync). Nav — `apps/web/components/Nav.tsx` (клиентский, usePathname).
- Команды: `npm test -w @dublyarr/core`, `npm run typecheck`, `npm run test:e2e -w @dublyarr/web`.

---

### Task 1: Апгрейд при импорте — замена файла, если новый строго лучше

**Files:**
- Modify: `packages/core/src/import.ts`
- Test: `packages/core/test/import-upgrade.test.ts`

Правило: для каждого видео, чей эпизод (или фильм) уже имеет файл, заменяем старый файл **только если** качество нового download строго выше (по `qualityRank`); иначе пропускаем (как раньше). При замене: добавляем новый файл (repoint эпизода), удаляем старую запись и unlink старого пути (если путь отличается от нового). `ImportResult.ok` получает поле `replaced: number`. Обычный импорт недостающего не меняется (равное/худшее качество → пропуск).

- [ ] **Step 1: Написать падающие тесты**

Создать `packages/core/test/import-upgrade.test.ts`:

```ts
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
  addFile,
  addTitle,
  createDownload,
  getFile,
  listEpisodes,
  listFiles,
  openDb,
  syncEpisodes,
} from "../src/db/index.js";
import { importDownload } from "../src/import.js";
import { DEFAULT_NAMING_MOVIE, DEFAULT_NAMING_TV } from "../src/naming.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-upg-"));
const { db, sqlite } = openDb(join(dir, "upg.db"));
const libraryDir = join(dir, "library");
afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

function dl(titleId: number, source: string, resolution: string, guid: string) {
  return createDownload(db, {
    titleId,
    releaseGuid: guid,
    releaseTitle: "rel",
    episodesCovered: [],
    voiceoverStudio: "Сыендук",
    qualitySource: source,
    qualityResolution: resolution,
  });
}

describe("апгрейд сериала", () => {
  const tv = addTitle(db, {
    tmdbId: 1, type: "tv", titleRu: "Сериал", titleOriginal: "Series", year: "2020",
    posterPath: null, overview: "", tmdbStatus: null,
    qualityPresetId: 1, voiceover: "Сыендук", monitorRule: "all",
  });
  syncEpisodes(db, tv.id, [{ season: 1, episode: 1, airDate: "2020-01-01", name: "" }], "all", "2020-06-01");

  test("новый файл строго лучше → старый удалён, эпизод перепривязан, replaced=1", () => {
    // существующий файл HDTV 1080p (низкое)
    const ep = listEpisodes(db, tv.id)[0];
    const oldDest = join(libraryDir, "old-s01e01.mkv");
    mkdirSync(libraryDir, { recursive: true });
    writeFileSync(oldDest, "old-low");
    const old = addFile(db, {
      titleId: tv.id, episodeId: ep.id, path: oldDest, size: 10,
      qualitySource: "HDTV", qualityResolution: "1080p", voiceoverStudio: "Сыендук", releaseGuid: "g-old",
    });
    expect(listEpisodes(db, tv.id)[0].fileId).toBe(old.id);

    // загрузка BluRay 1080p (выше HDTV)
    const content = join(dir, "staging-up");
    mkdirSync(content, { recursive: true });
    writeFileSync(join(content, "Series.S01E01.1080p.BluRay.mkv"), "new-better");
    const d = dl(tv.id, "BluRay", "1080p", "g-new");

    const result = importDownload(db, d, tv, content, { libraryDir, template: DEFAULT_NAMING_TV });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.replaced).toBe(1);

    // старого файла на диске нет, старой записи нет, эпизод указывает на новый
    expect(existsSync(oldDest)).toBe(false);
    expect(getFile(db, old.id)).toBeNull();
    const files = listFiles(db, tv.id);
    expect(files).toHaveLength(1);
    expect(listEpisodes(db, tv.id)[0].fileId).toBe(files[0].id);
    expect(files[0].qualitySource).toBe("BluRay");
  });

  test("новый файл не лучше → пропуск, replaced=0, старый цел", () => {
    const ep = listEpisodes(db, tv.id)[0];
    const before = ep.fileId;
    const content = join(dir, "staging-same");
    mkdirSync(content, { recursive: true });
    writeFileSync(join(content, "Series.S01E01.1080p.HDTV.mkv"), "same-low");
    const d = dl(tv.id, "HDTV", "1080p", "g-same");
    const result = importDownload(db, d, tv, content, { libraryDir, template: DEFAULT_NAMING_TV });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.replaced).toBe(0);
    expect(listEpisodes(db, tv.id)[0].fileId).toBe(before);
    expect(listFiles(db, tv.id)).toHaveLength(1);
  });
});

describe("апгрейд фильма", () => {
  const movie = addTitle(db, {
    tmdbId: 2, type: "movie", titleRu: "Фильм", titleOriginal: "Movie", year: "2020",
    posterPath: null, overview: "", tmdbStatus: null,
    qualityPresetId: 2, voiceover: "any", monitorRule: "all",
  });

  test("замена фильма на лучшее качество", () => {
    const oldDest = join(libraryDir, "movie-old.mkv");
    writeFileSync(oldDest, "m-old");
    const old = addFile(db, {
      titleId: movie.id, episodeId: null, path: oldDest, size: 5,
      qualitySource: "WEB-DL", qualityResolution: "1080p", voiceoverStudio: "HDrezka", releaseGuid: "m-old",
    });
    const content = join(dir, "staging-movie");
    mkdirSync(content, { recursive: true });
    writeFileSync(join(content, "Movie.2020.2160p.BDRemux.mkv"), "m-new-better-big");
    const d = dl(movie.id, "BDRemux", "2160p", "m-new");

    const result = importDownload(db, d, movie, content, { libraryDir, template: DEFAULT_NAMING_MOVIE });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.replaced).toBe(1);
    expect(existsSync(oldDest)).toBe(false);
    expect(getFile(db, old.id)).toBeNull();
    expect(listFiles(db, movie.id)).toHaveLength(1);
    expect(listFiles(db, movie.id)[0].qualityResolution).toBe("2160p");
  });

  test("фильм: новый не лучше → пропуск без дубля", () => {
    const content = join(dir, "staging-movie2");
    mkdirSync(content, { recursive: true });
    writeFileSync(join(content, "Movie.2020.1080p.WEB-DL.mkv"), "m-same");
    const d = dl(movie.id, "WEB-DL", "1080p", "m-same2");
    const result = importDownload(db, d, movie, content, { libraryDir, template: DEFAULT_NAMING_MOVIE });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.replaced).toBe(0);
    expect(listFiles(db, movie.id)).toHaveLength(1);
    expect(listFiles(db, movie.id)[0].qualityResolution).toBe("2160p");
  });
});
```

- [ ] **Step 2: Прогнать тесты — убедиться, что падают**

Run: `npm test -w @dublyarr/core -- import-upgrade`
Expected: FAIL (нет `replaced`; старый файл не заменяется).

- [ ] **Step 3: Переписать import.ts**

Заменить содержимое `packages/core/src/import.ts` на:

```ts
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { addFile, deleteFileRecord, getFile, listFiles, type LibFile } from "./db/files.js";
import type { Download } from "./db/downloads.js";
import { updateDownload } from "./db/downloads.js";
import type { Db } from "./db/index.js";
import { listEpisodes, type Title } from "./db/titles.js";
import { renderTemplate } from "./naming.js";
import { parseEpisodeTag } from "./parser.js";
import { qualityKeyFor, qualityLabel, qualityRank } from "./quality.js";

const VIDEO_EXT = new Set([".mkv", ".mp4", ".avi", ".m4v"]);

export interface ImportOptions {
  libraryDir: string;
  template: string;
  /** Подменяется в тестах; по умолчанию hardlink с fallback на копию. */
  linkFile?: (src: string, dest: string) => void;
}

export type ImportResult =
  | { ok: true; files: LibFile[]; replaced: number }
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

/** Ранг качества записи файла (или -1, если не распознан). */
function rankOf(source: string | null, resolution: string | null): number {
  const k = qualityKeyFor(source, resolution);
  return k ? qualityRank(k) : -1;
}

/** Удаляет старую запись файла и unlink с диска (если путь отличается от нового). */
function dropOldFile(db: Db, oldId: number, newDest: string): void {
  const removed = deleteFileRecord(db, oldId);
  if (removed && removed.path !== newDest) {
    try {
      unlinkSync(removed.path);
    } catch {
      // файла уже нет — запись всё равно удалена
    }
  }
}

/**
 * Раскладывает завершённую загрузку в библиотеку: сериалы — по SxxEyy из имён,
 * фильмы — самый большой видеофайл. Если у эпизода/фильма уже есть файл, новый
 * заменяет старый ТОЛЬКО при строго более высоком качестве (апгрейд): старый файл
 * удаляется с диска и из БД; иначе видео пропускается. Переводит download в imported.
 * Ранние ошибки (нет файлов/видео/не сопоставлено) БД не мутируют; повторный импорт
 * безопасен (равное/худшее качество не трогает существующие файлы).
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
  const newRank = qKey ? qualityRank(qKey) : -1;
  const vars = {
    show: title.titleOriginal || title.titleRu,
    year: title.year,
    quality: qKey ? qualityLabel(qKey) : "",
    vo: download.voiceoverStudio ?? "",
  };
  const imported: LibFile[] = [];
  let replaced = 0;

  function place(dest: string, srcPath: string, episodeId: number | null, size: number): void {
    mkdirSync(dirname(dest), { recursive: true });
    link(srcPath, dest);
    imported.push(
      addFile(db, {
        titleId: title.id,
        episodeId,
        path: dest,
        size,
        qualitySource: download.qualitySource,
        qualityResolution: download.qualityResolution,
        voiceoverStudio: download.voiceoverStudio,
        releaseGuid: download.releaseGuid,
      }),
    );
  }

  if (title.type === "movie") {
    const existing = listFiles(db, title.id);
    const bestExistingRank = existing.length
      ? Math.max(...existing.map((f) => rankOf(f.qualitySource, f.qualityResolution)))
      : -1;
    if (existing.length > 0 && newRank <= bestExistingRank) {
      // не лучше — ничего не меняем
      updateDownload(db, download.id, { status: "imported", progress: 1, error: null });
      return { ok: true, files: [], replaced: 0 };
    }
    const best = [...videos].sort((a, b) => b.size - a.size)[0];
    const rendered = renderTemplate(opts.template, vars);
    if (!rendered) return { ok: false, error: "Шаблон имени дал пустой путь" };
    const dest = join(opts.libraryDir, rendered + extname(best.path).toLowerCase());
    place(dest, best.path, null, best.size);
    for (const old of existing) {
      dropOldFile(db, old.id, dest);
      replaced += 1;
    }
  } else {
    const byKey = new Map(
      listEpisodes(db, title.id).map((e) => [`${e.season}:${e.episode}`, e]),
    );
    let matched = 0;
    for (const v of videos) {
      const tag = parseEpisodeTag(basename(v.path));
      if (!tag) continue;
      const key = `${tag.season}:${tag.episode}`;
      const ep = byKey.get(key);
      if (!ep) continue;
      matched += 1;

      let oldFileId: number | null = null;
      if (ep.fileId != null) {
        const oldFile = getFile(db, ep.fileId);
        const oldRank = oldFile ? rankOf(oldFile.qualitySource, oldFile.qualityResolution) : -1;
        if (newRank <= oldRank) continue; // не апгрейд — оставляем
        oldFileId = ep.fileId;
      }

      const rendered = renderTemplate(opts.template, {
        ...vars,
        season: tag.season,
        episode: tag.episode,
      });
      if (!rendered) return { ok: false, error: "Шаблон имени дал пустой путь" };
      const dest = join(opts.libraryDir, rendered + extname(v.path).toLowerCase());
      place(dest, v.path, ep.id, v.size); // addFile перепривязывает episodes.file_id на новый
      if (oldFileId != null) {
        dropOldFile(db, oldFileId, dest);
        replaced += 1;
      }
      byKey.delete(key); // следующий файл с той же меткой (PROPER и т.п.) не пройдёт
    }
    if (imported.length === 0 && matched === 0) {
      return { ok: false, error: "Не удалось сопоставить файлы с сериями" };
    }
    // imported пуст, но matched>0 — всё уже на месте/не лучше: успех без изменений
  }

  updateDownload(db, download.id, { status: "imported", progress: 1, error: null });
  return { ok: true, files: imported, replaced };
}
```

- [ ] **Step 4: Прогнать тесты (новые + существующие import.test.ts)**

Run: `npm test -w @dublyarr/core -- import`
Expected: PASS — и `import-upgrade.test.ts`, и старый `import.test.ts` (его проверки `result.ok`/`result.files` совместимы с добавленным `replaced`). Если старый тест «повторный импорт уже-импортированного → {ok:true, files:[]}» падает — он по-прежнему ожидает `files: []`; новый код возвращает `{ok:true, files:[], replaced:0}` для равного качества, что совместимо (тест проверяет `.files`/`.ok`, не строгое равенство всего объекта). Если тест использует `toEqual({ok:true, files:[]})` — обнови его на `toMatchObject({ ok: true, files: [] })` (это допустимая правка устаревшего ассерта под новый тип).

- [ ] **Step 5: Прогнать весь core + typecheck**

Run: `npm test -w @dublyarr/core && npm run typecheck`
Expected: PASS / exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/import.ts packages/core/test/import-upgrade.test.ts packages/core/test/import.test.ts
git commit -m "feat(core): апгрейд при импорте — замена файла на строго лучшее качество"
```

---

### Task 2: poll.ts — событие «upgrade» в истории при замене

**Files:**
- Modify: `packages/core/src/poll.ts`
- Test: `packages/core/test/poll-upgrade.test.ts`

`refreshDownload` использует `ImportResult.replaced`: при `replaced > 0` пишет history `kind="upgrade"`, иначе `kind="import"`.

- [ ] **Step 1: Написать падающий тест**

Создать `packages/core/test/poll-upgrade.test.ts`:

```ts
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test, vi } from "vitest";
import {
  addFile,
  addTitle,
  createDownload,
  listEpisodes,
  listHistory,
  openDb,
  setSetting,
  syncEpisodes,
  updateDownload,
} from "../src/db/index.js";
import { refreshDownload } from "../src/poll.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-pollup-"));
const { db, sqlite } = openDb(join(dir, "pu.db"));
const lib = join(dir, "lib");
afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

setSetting(db, "library_tv", lib);

const tv = addTitle(db, {
  tmdbId: 1, type: "tv", titleRu: "С", titleOriginal: "Series", year: "2020",
  posterPath: null, overview: "", tmdbStatus: null,
  qualityPresetId: 1, voiceover: "Сыендук", monitorRule: "all",
});
syncEpisodes(db, tv.id, [{ season: 1, episode: 1, airDate: "2020-01-01", name: "" }], "all", "2020-06-01");

test("замена файла при импорте → history kind=upgrade", async () => {
  const ep = listEpisodes(db, tv.id)[0];
  mkdirSync(lib, { recursive: true });
  const oldPath = join(lib, "old.mkv");
  writeFileSync(oldPath, "x");
  addFile(db, {
    titleId: tv.id, episodeId: ep.id, path: oldPath, size: 1,
    qualitySource: "HDTV", qualityResolution: "1080p", voiceoverStudio: "Сыендук", releaseGuid: "old",
  });

  const content = join(dir, "content");
  mkdirSync(content, { recursive: true });
  writeFileSync(join(content, "Series.S01E01.1080p.BluRay.mkv"), "better");

  const d = createDownload(db, {
    titleId: tv.id, releaseGuid: "new", releaseTitle: "Series S01E01 BluRay",
    episodesCovered: [ep.id], voiceoverStudio: "Сыендук",
    qualitySource: "BluRay", qualityResolution: "1080p",
  });
  updateDownload(db, d.id, { status: "completed", qbitHash: "H", progress: 1 });

  const qbt = {
    listTorrents: vi.fn().mockResolvedValue([
      { hash: "H", state: "uploading", progress: 1, contentPath: content },
    ]),
  } as never;

  await refreshDownload(db, qbt, { ...d, status: "completed", qbitHash: "H", progress: 1 });

  const kinds = listHistory(db, 20, 0).filter((h) => h.titleId === tv.id).map((h) => h.kind);
  expect(kinds).toContain("upgrade");
  expect(existsSync(oldPath)).toBe(false);
});
```

- [ ] **Step 2: Прогнать — убедиться, что падает**

Run: `npm test -w @dublyarr/core -- poll-upgrade`
Expected: FAIL (history пишется как `import`, не `upgrade`).

- [ ] **Step 3: Обновить poll.ts**

В `packages/core/src/poll.ts`, в блоке `if (d.status === "completed")`, заменить ветку успешного импорта:

```ts
      const result = importDownload(db, d, title, torrent.contentPath, { libraryDir, template });
      if (!result.ok) {
        updateDownload(db, d.id, { error: result.error });
      } else {
        addHistory(db, {
          titleId: title.id,
          kind: result.replaced > 0 ? "upgrade" : "import",
          message:
            result.replaced > 0
              ? `Апгрейд: ${d.releaseTitle || d.tag}`
              : `Импортировано: ${d.releaseTitle || d.tag}`,
        });
      }
```

- [ ] **Step 4: Прогнать тесты**

Run: `npm test -w @dublyarr/core && npm run typecheck`
Expected: PASS / exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/poll.ts packages/core/test/poll-upgrade.test.ts
git commit -m "feat(core): poll пишет событие upgrade при замене файла"
```

---

### Task 3: pipeline.ts — апгрейд-кандидаты и поиск лучшего

**Files:**
- Modify: `packages/core/src/pipeline.ts`
- Test: `packages/core/test/pipeline-upgrade.test.ts`

`Candidate.reason` расширяется до `"missing" | "upgrade"`; добавляется `upgradeFromRank: number` (минимальный ранг качества среди апгрейдируемых файлов — порог «строго лучше»). `selectCandidates`: если у тайтла нет недостающего, но пресет `upgradeEnabled` и есть файлы ниже `preferred` — апгрейд-кандидат. `runTitle`: для `reason==="upgrade"` фильтрует раздачи рангом `> upgradeFromRank` и пишет историю с пометкой апгрейда.

- [ ] **Step 1: Написать падающие тесты**

Создать `packages/core/test/pipeline-upgrade.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test, vi } from "vitest";
import {
  addFile,
  addTitle,
  createPreset,
  listHistory,
  openDb,
  syncEpisodes,
} from "../src/db/index.js";
import { parseRelease } from "../src/parser.js";
import type { JackettRelease } from "../src/jackett.js";
import { selectCandidates, runTitle } from "../src/pipeline.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-pipeup-"));
const { db, sqlite } = openDb(join(dir, "pu.db"));
afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

// пресет с upgrade_enabled, preferred = bluray-1080p
const preset = createPreset(db, {
  name: "UpgFullHD",
  allowed: ["hdtv-1080p", "webdl-1080p", "bluray-1080p"],
  preferred: "bluray-1080p",
  upgradeEnabled: true,
});
const presetId = preset.ok ? preset.preset.id : 0;
const TODAY = "2024-01-01";

function rawRel(over: Partial<JackettRelease> & { title: string }): JackettRelease {
  return {
    title: over.title, description: over.description ?? "", indexer: "RuTracker",
    trackerType: "public", guid: over.guid ?? over.title, comments: "", pubDate: "",
    size: 1_000_000, seeders: over.seeders ?? 10, peers: 0, grabs: 0,
    link: over.link ?? `magnet:${over.title}`,
  };
}

describe("selectCandidates: апгрейд", () => {
  test("фильм с файлом ниже preferred при upgradeEnabled → upgrade-кандидат", () => {
    const movie = addTitle(db, {
      tmdbId: 10, type: "movie", titleRu: "Ф", titleOriginal: "Mv", year: "2020",
      posterPath: null, overview: "", tmdbStatus: null,
      qualityPresetId: presetId, voiceover: "any", monitorRule: "all",
    });
    addFile(db, {
      titleId: movie.id, episodeId: null, path: "/lib/mv.mkv", size: 1,
      qualitySource: "HDTV", qualityResolution: "1080p", voiceoverStudio: null, releaseGuid: null,
    });
    const c = selectCandidates(db, TODAY).find((x) => x.title.id === movie.id);
    expect(c?.reason).toBe("upgrade");
  });

  test("фильм уже на preferred → не кандидат", () => {
    const movie = addTitle(db, {
      tmdbId: 11, type: "movie", titleRu: "Ф2", titleOriginal: "Mv2", year: "2020",
      posterPath: null, overview: "", tmdbStatus: null,
      qualityPresetId: presetId, voiceover: "any", monitorRule: "all",
    });
    addFile(db, {
      titleId: movie.id, episodeId: null, path: "/lib/mv2.mkv", size: 1,
      qualitySource: "BluRay", qualityResolution: "1080p", voiceoverStudio: null, releaseGuid: null,
    });
    expect(selectCandidates(db, TODAY).some((x) => x.title.id === movie.id)).toBe(false);
  });

  test("upgrade выключён в пресете → не кандидат", () => {
    const noUpg = createPreset(db, {
      name: "NoUpg", allowed: ["hdtv-1080p", "bluray-1080p"], preferred: "bluray-1080p", upgradeEnabled: false,
    });
    const pid = noUpg.ok ? noUpg.preset.id : 0;
    const movie = addTitle(db, {
      tmdbId: 12, type: "movie", titleRu: "Ф3", titleOriginal: "Mv3", year: "2020",
      posterPath: null, overview: "", tmdbStatus: null,
      qualityPresetId: pid, voiceover: "any", monitorRule: "all",
    });
    addFile(db, {
      titleId: movie.id, episodeId: null, path: "/lib/mv3.mkv", size: 1,
      qualitySource: "HDTV", qualityResolution: "1080p", voiceoverStudio: null, releaseGuid: null,
    });
    expect(selectCandidates(db, TODAY).some((x) => x.title.id === movie.id)).toBe(false);
  });
});

describe("runTitle: апгрейд", () => {
  test("грабит раздачу лучше текущей; равные/худшие отфильтрованы", async () => {
    const movie = addTitle(db, {
      tmdbId: 20, type: "movie", titleRu: "Ап", titleOriginal: "Up", year: "2020",
      posterPath: null, overview: "", tmdbStatus: null,
      qualityPresetId: presetId, voiceover: "any", monitorRule: "all",
    });
    addFile(db, {
      titleId: movie.id, episodeId: null, path: "/lib/up.mkv", size: 1,
      qualitySource: "WEB-DL", qualityResolution: "1080p", voiceoverStudio: null, releaseGuid: null,
    });
    const cand = selectCandidates(db, TODAY).find((x) => x.title.id === movie.id)!;
    expect(cand.reason).toBe("upgrade");

    const search = vi.fn().mockResolvedValue([
      rawRel({ title: "Up 2020 1080p BluRay", description: "VO (Сыендук)", guid: "better", seeders: 30 }),
      rawRel({ title: "Up 2020 1080p WEB-DL", description: "VO (Сыендук)", guid: "same", seeders: 99 }),
    ].map(parseRelease));
    const grab = vi.fn().mockResolvedValue(undefined);
    await runTitle(db, cand, { search, grab, minSeeders: 1, now: new Date() });

    expect(grab).toHaveBeenCalledTimes(1);
    expect(grab.mock.calls[0][0].guid).toBe("better"); // WEB-DL (равный) отфильтрован
    expect(listHistory(db, 50, 0).some((h) => h.titleId === movie.id && h.kind === "search")).toBe(true);
  });
});
```

- [ ] **Step 2: Прогнать — убедиться, что падают**

Run: `npm test -w @dublyarr/core -- pipeline-upgrade`
Expected: FAIL.

- [ ] **Step 3: Обновить pipeline.ts**

В `packages/core/src/pipeline.ts`:

(а) Добавить импорты — заменить строку импорта files и quality:

```ts
import { getFile, listFiles } from "./db/files.js";
import { qualityKeyFor, qualityRank } from "./quality.js";
```

(getPreset уже импортирован; getFile добавлен.)

(б) Заменить тип `Candidate`:

```ts
export interface Candidate {
  title: Title;
  reason: "missing" | "upgrade";
  /** Сезоны с целевыми эпизодами (для tv); для movie — []. */
  wantedSeasons: number[];
  /** Целевые эпизоды (недостающие или апгрейдируемые) — для episodesCovered. */
  wantedEpisodes: Episode[];
  /** Для upgrade: минимальный ранг среди апгрейдируемых файлов (порог «строго лучше»). 0 для missing. */
  upgradeFromRank: number;
}
```

(в) Добавить хелпер перед `selectCandidates`:

```ts
function rankOfFile(source: string | null, resolution: string | null): number {
  const k = qualityKeyFor(source, resolution);
  return k ? qualityRank(k) : -1;
}
```

(г) Заменить тело `selectCandidates` (внутри цикла по тайтлам — логику после рейт-лимита):

```ts
  for (const title of listTrackedTitles(db)) {
    const last = recentSearchAt(db, title.id);
    if (last) {
      const lastMs = new Date(last.replace(" ", "T") + (last.includes("Z") ? "" : "Z")).getTime();
      if (!Number.isNaN(lastMs) && now.getTime() - lastMs < rateMs) continue;
    }

    const preset = getPreset(db, title.qualityPresetId);

    if (title.type === "movie") {
      const fs = listFiles(db, title.id);
      if (fs.length === 0) {
        out.push({ title, reason: "missing", wantedSeasons: [], wantedEpisodes: [], upgradeFromRank: 0 });
        continue;
      }
      if (preset?.upgradeEnabled) {
        const prefRank = qualityRank(preset.preferred);
        const ranks = fs.map((f) => rankOfFile(f.qualitySource, f.qualityResolution));
        const minRank = Math.min(...ranks);
        if (minRank < prefRank) {
          out.push({ title, reason: "upgrade", wantedSeasons: [], wantedEpisodes: [], upgradeFromRank: minRank });
        }
      }
      continue;
    }

    const eps = listEpisodes(db, title.id);
    const wantedMissing = eps.filter((e) => e.wanted && e.fileId == null);
    if (wantedMissing.length > 0) {
      out.push({
        title,
        reason: "missing",
        wantedSeasons: [...new Set(wantedMissing.map((e) => e.season))].sort((a, b) => a - b),
        wantedEpisodes: wantedMissing,
        upgradeFromRank: 0,
      });
      continue;
    }

    if (preset?.upgradeEnabled) {
      const prefRank = qualityRank(preset.preferred);
      const upgradable = eps.filter((e) => {
        if (e.fileId == null) return false;
        const f = getFile(db, e.fileId);
        return f != null && rankOfFile(f.qualitySource, f.qualityResolution) < prefRank;
      });
      if (upgradable.length > 0) {
        const minRank = Math.min(
          ...upgradable.map((e) => {
            const f = getFile(db, e.fileId!)!;
            return rankOfFile(f.qualitySource, f.qualityResolution);
          }),
        );
        out.push({
          title,
          reason: "upgrade",
          wantedSeasons: [...new Set(upgradable.map((e) => e.season))].sort((a, b) => a - b),
          wantedEpisodes: upgradable,
          upgradeFromRank: minRank,
        });
      }
    }
  }
  return out;
```

(д) Полностью заменить функцию `runTitle` (от `export async function runTitle` до её закрывающей `}`) на версию с апгрейд-веткой:

```ts
export async function runTitle(db: Db, cand: Candidate, deps: RunDeps): Promise<void> {
  const { title } = cand;
  const isUpgrade = cand.reason === "upgrade";
  addHistory(db, {
    titleId: title.id,
    kind: "search",
    message: isUpgrade ? `Поиск апгрейда: ${title.titleOriginal}` : `Поиск: ${title.titleOriginal}`,
  });

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

  // Сериал: оставляем раздачи, покрывающие хотя бы один целевой сезон.
  if (title.type === "tv" && cand.wantedSeasons.length > 0) {
    const wanted = new Set(cand.wantedSeasons);
    releases = releases.filter(
      (r) => r.parsed.seasons.length === 0 || r.parsed.seasons.some((s) => wanted.has(s)),
    );
  }

  // Апгрейд: только раздачи строго лучше текущего минимума.
  if (isUpgrade) {
    releases = releases.filter((r) => {
      const k = qualityKeyFor(r.parsed.quality.source, r.parsed.quality.resolution);
      return k != null && qualityRank(k) > cand.upgradeFromRank;
    });
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
  addHistory(db, {
    titleId: title.id,
    kind: "grab",
    message: isUpgrade ? `Качаю апгрейд: ${best.title}` : `Скачиваю: ${best.title}`,
  });
}
```

- [ ] **Step 4: Прогнать тесты (вкл. существующий pipeline.test.ts)**

Run: `npm test -w @dublyarr/core -- pipeline`
Expected: PASS — и `pipeline-upgrade.test.ts`, и старый `pipeline.test.ts` (его кандидаты `reason==="missing"` теперь содержат `upgradeFromRank: 0` — старые ассерты на `reason`/`wantedSeasons` не ломаются).

- [ ] **Step 5: Весь core + typecheck**

Run: `npm test -w @dublyarr/core && npm run typecheck`
Expected: PASS / exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/pipeline.ts packages/core/test/pipeline-upgrade.test.ts
git commit -m "feat(core): апгрейд-кандидаты в конвейере и поиск лучшего качества"
```

---

### Task 4: listActiveDownloads/countActiveDownloads + pollAll

**Files:**
- Modify: `packages/core/src/db/downloads.ts`
- Modify: `packages/core/src/poll.ts`
- Test: `packages/core/test/downloads-active.test.ts`
- Test: `packages/core/test/poll-all.test.ts`

- [ ] **Step 1: Написать падающие тесты**

Создать `packages/core/test/downloads-active.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
  addTitle,
  countActiveDownloads,
  createDownload,
  listActiveDownloads,
  openDb,
  updateDownload,
} from "../src/db/index.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-active-"));
const { db, sqlite } = openDb(join(dir, "a.db"));
afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const t = addTitle(db, {
  tmdbId: 1, type: "movie", titleRu: "Ф", titleOriginal: "F", year: "2020",
  posterPath: null, overview: "", tmdbStatus: null,
  qualityPresetId: 1, voiceover: "any", monitorRule: "all",
});
function mk(guid: string) {
  return createDownload(db, {
    titleId: t.id, releaseGuid: guid, releaseTitle: guid, episodesCovered: [],
    voiceoverStudio: null, qualitySource: null, qualityResolution: null,
  });
}

describe("active downloads", () => {
  test("активные = queued/downloading/completed; imported/failed исключены", () => {
    const a = mk("a"); // queued
    const b = mk("b"); updateDownload(db, b.id, { status: "downloading" });
    const c = mk("c"); updateDownload(db, c.id, { status: "imported" });
    const d = mk("d"); updateDownload(db, d.id, { status: "failed" });

    const active = listActiveDownloads(db);
    const guids = active.map((x) => x.releaseGuid).sort();
    expect(guids).toEqual(["a", "b"]);
    expect(countActiveDownloads(db)).toBe(2);
  });

  test("новые сверху", () => {
    const rows = listActiveDownloads(db);
    expect(rows[0].id).toBeGreaterThan(rows[rows.length - 1].id);
  });
});
```

Создать `packages/core/test/poll-all.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test, vi } from "vitest";
import {
  addTitle,
  createDownload,
  getDownload,
  openDb,
} from "../src/db/index.js";
import { pollAll } from "../src/poll.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-pollall-"));
const { db, sqlite } = openDb(join(dir, "pa.db"));
afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const t1 = addTitle(db, {
  tmdbId: 1, type: "movie", titleRu: "A", titleOriginal: "A", year: "2020",
  posterPath: null, overview: "", tmdbStatus: null, qualityPresetId: 1, voiceover: "any", monitorRule: "all",
});
const t2 = addTitle(db, {
  tmdbId: 2, type: "movie", titleRu: "B", titleOriginal: "B", year: "2020",
  posterPath: null, overview: "", tmdbStatus: null, qualityPresetId: 1, voiceover: "any", monitorRule: "all",
});

test("pollAll продвигает queued→downloading по всем тайтлам", async () => {
  const d1 = createDownload(db, { titleId: t1.id, releaseGuid: "g1", releaseTitle: "g1", episodesCovered: [], voiceoverStudio: null, qualitySource: null, qualityResolution: null });
  const d2 = createDownload(db, { titleId: t2.id, releaseGuid: "g2", releaseTitle: "g2", episodesCovered: [], voiceoverStudio: null, qualitySource: null, qualityResolution: null });
  const qbt = {
    listTorrents: vi.fn(async ({ tag }: { tag: string }) => [
      { hash: `H-${tag}`, state: "downloading", progress: 0.2, contentPath: "" },
    ]),
  } as never;

  const { active, qbtError } = await pollAll(db, qbt, { now: new Date("2030-01-01T00:00:00Z") });
  expect(qbtError).toBeNull();
  expect(getDownload(db, d1.id)?.status).toBe("downloading");
  expect(getDownload(db, d2.id)?.status).toBe("downloading");
  expect(active.map((d) => d.id).sort()).toEqual([d1.id, d2.id].sort());
});
```

- [ ] **Step 2: Прогнать — FAIL**

Run: `npm test -w @dublyarr/core -- downloads-active poll-all`
Expected: FAIL.

- [ ] **Step 3: Реализовать listActiveDownloads/countActiveDownloads**

В `packages/core/src/db/downloads.ts`:
- в импорт из `drizzle-orm` добавить `inArray` и `sql`: строка станет `import { desc, eq, inArray, sql } from "drizzle-orm";`
- дописать в конец файла:

```ts
export function listActiveDownloads(db: Db): Download[] {
  return db
    .select()
    .from(downloads)
    .where(inArray(downloads.status, REFRESHABLE_STATUSES))
    .orderBy(desc(downloads.id))
    .all()
    .map(rowToDownload);
}

export function countActiveDownloads(db: Db): number {
  const row = db
    .select({ c: sql<number>`count(*)` })
    .from(downloads)
    .where(inArray(downloads.status, REFRESHABLE_STATUSES))
    .get();
  return row?.c ?? 0;
}
```

- [ ] **Step 4: Реализовать pollAll**

В `packages/core/src/poll.ts`:
- в импорт из `./db/downloads.js` добавить `listActiveDownloads`;
- дописать в конец файла:

```ts
/** Рефреш всех активных загрузок (по всем тайтлам); возвращает свежий список + ошибку qbt. */
export async function pollAll(
  db: Db,
  qbt: QbtClient,
  opts: PollOptions = {},
): Promise<{ active: Download[]; qbtError: string | null }> {
  let qbtError: string | null = null;
  for (const d of listActiveDownloads(db)) {
    try {
      await refreshDownload(db, qbt, d, opts);
    } catch (e) {
      qbtError = e instanceof QbtError ? e.message : "qBittorrent недоступен";
      break;
    }
  }
  return { active: listActiveDownloads(db), qbtError };
}
```

- [ ] **Step 5: Прогнать тесты**

Run: `npm test -w @dublyarr/core -- downloads-active poll-all && npm run typecheck`
Expected: PASS / exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/db/downloads.ts packages/core/src/poll.ts packages/core/test/downloads-active.test.ts packages/core/test/poll-all.test.ts
git commit -m "feat(core): listActiveDownloads/countActiveDownloads и pollAll"
```

---

### Task 5: db/calendar.ts — агенда серий по датам

**Files:**
- Create: `packages/core/src/db/calendar.ts`
- Modify: `packages/core/src/db/index.ts`
- Test: `packages/core/test/calendar.test.ts`

- [ ] **Step 1: Написать падающие тесты**

Создать `packages/core/test/calendar.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
  addFile,
  addTitle,
  listCalendar,
  listEpisodes,
  openDb,
  syncEpisodes,
} from "../src/db/index.js";

const dir = mkdtempSync(join(tmpdir(), "dublyarr-cal-"));
const { db, sqlite } = openDb(join(dir, "c.db"));
afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const tv = addTitle(db, {
  tmdbId: 1, type: "tv", titleRu: "Сериал", titleOriginal: "Series", year: "2020",
  posterPath: null, overview: "", tmdbStatus: null,
  qualityPresetId: 1, voiceover: "Сыендук", monitorRule: "all",
});
syncEpisodes(db, tv.id, [
  { season: 1, episode: 1, airDate: "2024-03-01", name: "Пилот" },
  { season: 1, episode: 2, airDate: "2024-03-08", name: "" },
  { season: 1, episode: 3, airDate: "2024-09-01", name: "" }, // вне окна
  { season: 1, episode: 4, airDate: null, name: "" },          // без даты — не в календаре
], "all", "2024-01-01");

describe("listCalendar", () => {
  test("серии трекаемого tv в диапазоне дат, отсортированы по airDate", () => {
    const rows = listCalendar(db, "2024-02-01", "2024-04-01");
    expect(rows.map((r) => `${r.season}x${r.episode}`)).toEqual(["1x1", "1x2"]);
    expect(rows[0]).toMatchObject({
      titleId: tv.id, titleRu: "Сериал", season: 1, episode: 1,
      nameRu: "Пилот", airDate: "2024-03-01", wanted: true, hasFile: false,
      voiceover: "Сыендук",
    });
  });

  test("hasFile=true когда у эпизода есть файл", () => {
    const ep = listEpisodes(db, tv.id).find((e) => e.episode === 1)!;
    addFile(db, {
      titleId: tv.id, episodeId: ep.id, path: "/lib/e1.mkv", size: 1,
      qualitySource: "WEB-DL", qualityResolution: "1080p", voiceoverStudio: "Сыендук", releaseGuid: null,
    });
    const row = listCalendar(db, "2024-02-01", "2024-04-01").find((r) => r.episode === 1)!;
    expect(row.hasFile).toBe(true);
  });

  test("нетрекаемый tv не попадает", () => {
    const tv2 = addTitle(db, {
      tmdbId: 2, type: "tv", titleRu: "Другой", titleOriginal: "Other", year: "2020",
      posterPath: null, overview: "", tmdbStatus: null,
      qualityPresetId: 1, voiceover: "any", monitorRule: "all",
    });
    syncEpisodes(db, tv2.id, [{ season: 1, episode: 1, airDate: "2024-03-15", name: "" }], "all", "2024-01-01");
    sqlite.prepare(`UPDATE titles SET tracked = 0 WHERE id = ?`).run(tv2.id);
    const rows = listCalendar(db, "2024-02-01", "2024-04-01");
    expect(rows.some((r) => r.titleId === tv2.id)).toBe(false);
  });
});
```

- [ ] **Step 2: Прогнать — FAIL**

Run: `npm test -w @dublyarr/core -- calendar`
Expected: FAIL.

- [ ] **Step 3: Реализовать calendar.ts**

Создать `packages/core/src/db/calendar.ts`:

```ts
import { and, asc, eq, gte, isNotNull, lte } from "drizzle-orm";
import type { Db } from "./index.js";
import { episodes, titles } from "./schema.js";

export interface CalendarEntry {
  titleId: number;
  titleRu: string;
  season: number;
  episode: number;
  nameRu: string;
  airDate: string;
  wanted: boolean;
  hasFile: boolean;
  voiceover: string;
}

/** Серии трекаемых сериалов с датой выхода в [from, to] (ISO YYYY-MM-DD), по возрастанию даты. */
export function listCalendar(db: Db, from: string, to: string): CalendarEntry[] {
  const rows = db
    .select({
      titleId: titles.id,
      titleRu: titles.titleRu,
      voiceover: titles.voiceover,
      season: episodes.season,
      episode: episodes.episode,
      nameRu: episodes.nameRu,
      airDate: episodes.airDate,
      wanted: episodes.wanted,
      fileId: episodes.fileId,
    })
    .from(episodes)
    .innerJoin(titles, eq(episodes.titleId, titles.id))
    .where(
      and(
        eq(titles.tracked, 1),
        eq(titles.type, "tv"),
        isNotNull(episodes.airDate),
        gte(episodes.airDate, from),
        lte(episodes.airDate, to),
      ),
    )
    .orderBy(asc(episodes.airDate), asc(episodes.season), asc(episodes.episode))
    .all();

  return rows.map((r) => ({
    titleId: r.titleId,
    titleRu: r.titleRu,
    season: r.season,
    episode: r.episode,
    nameRu: r.nameRu,
    airDate: r.airDate as string,
    wanted: r.wanted === 1,
    hasFile: r.fileId != null,
    voiceover: r.voiceover,
  }));
}
```

- [ ] **Step 4: Реэкспорт**

В `packages/core/src/db/index.ts` добавить `export * from "./calendar.js";`.

- [ ] **Step 5: Прогнать тесты**

Run: `npm test -w @dublyarr/core -- calendar && npm run typecheck`
Expected: PASS / exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/db/calendar.ts packages/core/src/db/index.ts packages/core/test/calendar.test.ts
git commit -m "feat(core): db-запрос календаря серий по датам"
```

---

### Task 6: API — /api/activity и /api/activity/count

**Files:**
- Create: `apps/web/app/api/activity/route.ts`
- Create: `apps/web/app/api/activity/count/route.ts`

Тонкие роуты. GET /api/activity: рефреш всех активных (pollAll) + лента истории + имена тайтлов. GET /api/activity/count: только число активных из БД (без qbt) — для бейджа навигации.

- [ ] **Step 1: /api/activity**

Создать `apps/web/app/api/activity/route.ts`:

```ts
import { NextResponse } from "next/server";
import {
  getTitle,
  listActiveDownloads,
  listHistory,
  type Download,
} from "@dublyarr/core/db";
import { pollAll } from "@dublyarr/core/poll";
import { getDb } from "@/server/db";
import { qbtFromSettings } from "@/server/qbt";

function withTitle(db: ReturnType<typeof getDb>, d: Download) {
  return { ...d, titleRu: getTitle(db, d.titleId)?.titleRu ?? "—" };
}

export async function GET() {
  const db = getDb();
  const qbt = qbtFromSettings(db);
  let qbtError: string | null = null;
  let active: Download[];
  if (qbt) {
    const res = await pollAll(db, qbt);
    active = res.active;
    qbtError = res.qbtError;
  } else {
    active = listActiveDownloads(db);
  }
  return NextResponse.json({
    active: active.map((d) => withTitle(db, d)),
    history: listHistory(db, 50, 0),
    qbtError,
  });
}
```

- [ ] **Step 2: /api/activity/count**

Создать `apps/web/app/api/activity/count/route.ts`:

```ts
import { NextResponse } from "next/server";
import { countActiveDownloads } from "@dublyarr/core/db";
import { getDb } from "@/server/db";

export async function GET() {
  return NextResponse.json({ count: countActiveDownloads(getDb()) });
}
```

- [ ] **Step 3: Проверить typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/activity
git commit -m "feat(web): API активности (pollAll + история) и счётчик активных"
```

---

### Task 7: Страница «Активность»

**Files:**
- Modify: `apps/web/app/activity/page.tsx`
- Create: `apps/web/app/activity/ActivityView.tsx`
- Create: `apps/web/app/activity/activity.module.css`

- [ ] **Step 1: ActivityView (клиентский поллер)**

Создать `apps/web/app/activity/ActivityView.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./activity.module.css";

export interface ActiveDownload {
  id: number;
  titleRu: string;
  releaseTitle: string;
  status: "queued" | "downloading" | "completed" | "failed" | "imported";
  progress: number;
  error: string | null;
}

export interface HistoryRow {
  id: number;
  kind: string;
  message: string;
  createdAt: string;
}

const STATUS_RU: Record<ActiveDownload["status"], string> = {
  queued: "в очереди",
  downloading: "качается",
  completed: "скачано, импорт…",
  failed: "ошибка",
  imported: "импортировано",
};

const KIND_RU: Record<string, string> = {
  search: "поиск",
  grab: "забрал",
  import: "импорт",
  upgrade: "апгрейд",
  fail: "ошибка",
  not_found: "не найдено",
};

export function ActivityView({
  initialActive,
  initialHistory,
}: {
  initialActive: ActiveDownload[];
  initialHistory: HistoryRow[];
}) {
  const [active, setActive] = useState(initialActive);
  const [history, setHistory] = useState(initialHistory);
  const [qbtError, setQbtError] = useState<string | null>(null);
  const hasActive = useRef(initialActive.length > 0);
  hasActive.current = active.length > 0;

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const res = await fetch("/api/activity");
        if (!res.ok) return;
        const data = (await res.json()) as {
          active: ActiveDownload[];
          history: HistoryRow[];
          qbtError: string | null;
        };
        setActive(data.active);
        setHistory(data.history);
        setQbtError(data.qbtError);
      } catch {
        setQbtError("Сеть недоступна");
      }
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      <h1>Активность</h1>
      {qbtError && <p className={styles.error}>{qbtError}</p>}

      <h2>Загрузки</h2>
      {active.length === 0 ? (
        <p className={styles.muted}>Активных загрузок нет.</p>
      ) : (
        <ul className={styles.list} data-testid="active-list">
          {active.map((d) => (
            <li key={d.id} className={styles.row}>
              <span className={styles.title}>{d.titleRu}</span>
              <span className={styles.rel}>{d.releaseTitle}</span>
              <span>
                {STATUS_RU[d.status]}
                {d.status === "downloading" && ` ${Math.round(d.progress * 100)}%`}
              </span>
              {d.status === "downloading" && (
                <span className={styles.track}>
                  <span className={styles.fill} style={{ width: `${Math.round(d.progress * 100)}%` }} />
                </span>
              )}
              {d.error && <span className={styles.error}>{d.error}</span>}
            </li>
          ))}
        </ul>
      )}

      <h2>История</h2>
      {history.length === 0 ? (
        <p className={styles.muted}>Пока пусто.</p>
      ) : (
        <ul className={styles.list} data-testid="history-list">
          {history.map((h) => (
            <li key={h.id} className={styles.histRow}>
              <span className={styles.kind}>{KIND_RU[h.kind] ?? h.kind}</span>
              <span>{h.message}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
```

- [ ] **Step 2: Серверная страница**

Заменить `apps/web/app/activity/page.tsx` на:

```tsx
import { getTitle, listActiveDownloads, listHistory } from "@dublyarr/core/db";
import { getDb } from "@/server/db";
import { ActivityView } from "./ActivityView";

export const dynamic = "force-dynamic";

export default function ActivityPage() {
  const db = getDb();
  const active = listActiveDownloads(db).map((d) => ({
    id: d.id,
    titleRu: getTitle(db, d.titleId)?.titleRu ?? "—",
    releaseTitle: d.releaseTitle,
    status: d.status,
    progress: d.progress,
    error: d.error,
  }));
  const history = listHistory(db, 50, 0).map((h) => ({
    id: h.id,
    kind: h.kind,
    message: h.message,
    createdAt: h.createdAt,
  }));
  return <ActivityView initialActive={active} initialHistory={history} />;
}
```

- [ ] **Step 3: Стили**

Создать `apps/web/app/activity/activity.module.css`:

```css
.list {
  list-style: none;
  margin: 0 0 18px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.row,
.histRow {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 14px;
}

.title { font-weight: bold; }

.rel,
.title {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rel { color: var(--text-muted); }

.kind {
  min-width: 88px;
  color: var(--accent);
  font-size: 12px;
}

.track {
  width: 140px;
  height: 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.12);
  overflow: hidden;
}

.fill { display: block; height: 100%; background: var(--accent); }

.muted { color: var(--text-muted); }
.error { color: #e05c5c; font-size: 13px; }
```

- [ ] **Step 4: Проверить typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/activity
git commit -m "feat(web): страница «Активность» с поллингом загрузок и историей"
```

---

### Task 8: Страница «Календарь»

**Files:**
- Modify: `apps/web/app/calendar/page.tsx`
- Create: `apps/web/app/calendar/calendar.module.css`

- [ ] **Step 1: Серверная страница**

Заменить `apps/web/app/calendar/page.tsx` на:

```tsx
import { listCalendar, type CalendarEntry } from "@dublyarr/core/db";
import { getDb } from "@/server/db";
import styles from "./calendar.module.css";

export const dynamic = "force-dynamic";

function isoOffset(base: Date, days: number): string {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function statusOf(e: CalendarEntry, today: string): { text: string; cls: string } {
  if (e.hasFile) return { text: "✓ скачано", cls: "ok" };
  if (e.airDate > today) return { text: "выйдет в эфир", cls: "future" };
  if (e.wanted) return { text: `ждём раздачу${e.voiceover !== "any" ? ` в ${e.voiceover}` : ""}`, cls: "wait" };
  return { text: "вышла", cls: "muted" };
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export default function CalendarPage() {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const from = isoOffset(new Date(), -30);
  const to = isoOffset(new Date(), 90);
  const entries = listCalendar(db, from, to);

  const byDate = new Map<string, CalendarEntry[]>();
  for (const e of entries) {
    if (!byDate.has(e.airDate)) byDate.set(e.airDate, []);
    byDate.get(e.airDate)!.push(e);
  }

  return (
    <>
      <h1>Календарь</h1>
      {entries.length === 0 ? (
        <p className={styles.muted}>Нет серий с датами выхода в ближайшие 3 месяца.</p>
      ) : (
        <div data-testid="calendar">
          {[...byDate.entries()].map(([date, eps]) => (
            <section key={date} className={styles.day}>
              <h2 className={styles.date}>
                {formatDate(date)}
                {date === today && <span className={styles.todayBadge}>сегодня</span>}
              </h2>
              <ul className={styles.list}>
                {eps.map((e) => {
                  const st = statusOf(e, today);
                  return (
                    <li key={`${e.titleId}-${e.season}-${e.episode}`} className={styles.row}>
                      <span className={styles.title}>{e.titleRu}</span>
                      <span className={styles.code}>
                        S{String(e.season).padStart(2, "0")}E{String(e.episode).padStart(2, "0")}
                      </span>
                      {e.nameRu && <span className={styles.epName}>{e.nameRu}</span>}
                      <span className={styles[st.cls]}>{st.text}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Стили**

Создать `apps/web/app/calendar/calendar.module.css`:

```css
.day { margin: 0 0 18px; }

.date {
  font-size: 15px;
  margin: 0 0 8px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.todayBadge {
  font-size: 11px;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 4px;
  padding: 1px 6px;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 14px;
}

.title { font-weight: bold; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.code { color: var(--text-muted); font-variant-numeric: tabular-nums; }
.epName { color: var(--text-muted); max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.ok { color: var(--ok); font-size: 13px; }
.wait { color: #d99; font-size: 13px; }
.future { color: var(--text-muted); font-size: 13px; }
.muted { color: var(--text-muted); }
```

- [ ] **Step 3: Проверить typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/calendar
git commit -m "feat(web): страница «Календарь» — агенда серий по датам"
```

---

### Task 9: Бейдж-счётчик активных загрузок в навигации

**Files:**
- Modify: `apps/web/components/Nav.tsx`
- Modify: `apps/web/components/Nav.module.css`

- [ ] **Step 1: Счётчик в Nav**

В `apps/web/components/Nav.tsx`:
- добавить импорт `useEffect, useState`: строка станет `import { useEffect, useState } from "react";` (рядом с существующим импортом `usePathname`);
- внутри компонента `Nav`, после `const pathname = usePathname();` добавить:

```tsx
  const [activeCount, setActiveCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/activity/count");
        if (!res.ok) return;
        const data = (await res.json()) as { count: number };
        if (alive) setActiveCount(data.count);
      } catch {
        // молча — бейдж не критичен
      }
    };
    void load();
    const timer = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
```

- в массиве `items` у элемента Активности нет признака; добавить рендер бейджа. В обоих местах рендера ссылок (верхняя навигация и таб-бар) для элемента с `i.href === "/activity"` добавить бейдж, когда `activeCount > 0`. Конкретно: в верхней навигации внутри `<Link ...>{i.label}</Link>` заменить на:

```tsx
            <Link key={i.href} href={i.href}
              className={isActive(i.href) ? styles.active : ""}>
              {i.label}
              {i.href === "/activity" && activeCount > 0 && (
                <span className={styles.badge} data-testid="activity-badge">{activeCount}</span>
              )}
            </Link>
```

и в таб-баре аналогично — после `<span className={styles.tabLabel}>{i.label}</span>` добавить:

```tsx
            {i.href === "/activity" && activeCount > 0 && (
              <span className={styles.badge} data-testid="activity-badge-mobile">{activeCount}</span>
            )}
```

- [ ] **Step 2: Стили бейджа**

В `apps/web/components/Nav.module.css` добавить в конец:

```css
.badge {
  display: inline-block;
  margin-left: 6px;
  min-width: 16px;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--accent);
  color: #fff;
  font-size: 10px;
  font-weight: bold;
  text-align: center;
  line-height: 16px;
}
```

- [ ] **Step 3: Проверить typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/Nav.tsx apps/web/components/Nav.module.css
git commit -m "feat(web): бейдж-счётчик активных загрузок в навигации"
```

---

### Task 10: e2e и README

**Files:**
- Create: `apps/web/e2e/calendar-activity.spec.ts`
- Modify: `README.md`

- [ ] **Step 1: e2e**

Создать `apps/web/e2e/calendar-activity.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("страница «Активность» открывается с заголовком и секциями", async ({ page }) => {
  await page.goto("/activity");
  await expect(page.getByRole("heading", { name: "Активность", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Загрузки" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "История" })).toBeVisible();
});

test("страница «Календарь» открывается", async ({ page }) => {
  await page.goto("/calendar");
  await expect(page.getByRole("heading", { name: "Календарь", level: 1 })).toBeVisible();
});

test("навигация ведёт на Активность и Календарь", async ({ page }) => {
  await page.goto("/");
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.getByTestId("top-nav").getByRole("link", { name: "Календарь" }).click();
  await expect(page).toHaveURL(/\/calendar$/);
});
```

- [ ] **Step 2: Прогнать e2e**

Run: `npm run test:e2e -w @dublyarr/web`
Expected: все спеки PASS, 0 failed. Если упадёт существующая спека из-за изменений Nav (бейдж) — это регрессия, разобраться. Бейдж рендерится только при `activeCount > 0`; в чистой e2e-БД активных нет, так что бейджа не будет и существующие nav-тесты не затронуты.

- [ ] **Step 3: README**

В `README.md` после секции «## Что умеет (M3a)» добавить:

```markdown
## Что умеет (M3b)

- Апгрейды качества: при `upgrade_enabled` воркер докачивает раздачу выше качеством
  и заменяет старый файл (удаляет с диска), событие «апгрейд» в истории.
- Страница «Календарь» — серии отслеживаемых сериалов по датам выхода со статусом
  (✓ скачано · ждём раздачу в {студия} · выйдет в эфир).
- Страница «Активность» — активные загрузки с прогрессом (поллинг) и лента событий
  (поиск/забрал/импорт/апгрейд/ошибка/не найдено).
- Бейдж-счётчик активных загрузок в навигации.
```

- [ ] **Step 4: Полная проверка**

Run: `npm test && npm run typecheck && npm run test:e2e -w @dublyarr/web`
Expected: все unit зелёные, typecheck чист, e2e без failed.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/calendar-activity.spec.ts README.md
git commit -m "test(web): e2e Календаря и Активности; README M3b"
```

---

## Чего сознательно нет в M3b (→ далее)

- **Даты цифрового релиза фильмов в Календаре** — TMDb отдаёт их отдельным запросом (`release_dates`), у нас не хранятся; Календарь покрывает серии сериалов (где есть `air_date`). Фильмы в календаре — позже (нужны хранение даты релиза + TMDb-синк).
- **Ежедневный TMDb-синк эпизодов** (новые серии появляются автоматически) — отдельная фича воркера; сейчас эпизоды синкаются при добавлении тайтла.
- **Редактируемые алиасы студий / маппинг трекер→студия** (вкладка «Озвучки») — остаются захардкоженными.
- **Уведомления (Telegram и т.п.), статистика** — M5+ по спеке.
- **Auth, Docker-образ с двумя процессами, GitHub Actions/релизы** — M4.

## Заметки для ревьюеров

- Апгрейд реализован БЕЗ флага в БД: `importDownload` заменяет файл только при строго более высоком `qualityRank`. Это унифицирует обычный импорт (равное/худшее → пропуск, идемпотентно) и апгрейд (строго лучше → замена). `ImportResult.replaced` считает замены; poll по нему пишет `kind=upgrade` vs `import`.
- При замене новый файл кладётся ДО удаления старого; `dropOldFile` не unlink'ает, если путь нового совпадает со старым (шаблон без `{Quality}` → одинаковый путь): файл уже перезаписан hardlink/copy, удалять нечего.
- selectCandidates: апгрейд рассматривается только когда нет недостающего (missing-приоритет), один кандидат на тайтл. Рейт-лимит (раз/час по history.search) распространяется и на апгрейды.
- `/api/activity` делает реальный pollAll (рефреш всех активных по qBittorrent) — вызывается со страницы Активности раз в 4 с. `/api/activity/count` — только БД, без сети, для бейджа навигации (поллинг раз в 15 с) — намеренно лёгкий.
- Календарь — серверный рендер с `force-dynamic`; окно −30…+90 дней от сегодня; группировка по дате на сервере.
- Перенос из M3a-бэклога частично закрыт: poll-side `upgrade`/`import` события теперь пишутся в history (видны в Активности). `fail`/`not_found` пишет конвейер (pipeline) — они тоже в ленте.
