# Сканирование медиатеки — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** По кнопке в «Хранилище» найти в медиатеке видео, которых нет в Dublyarr, распознать через TMDB, показать окно и по подтверждению взять в Dublyarr и разложить по шаблону.

**Architecture:**
- Две задачи воркера: `media.scan` (обход, группировка, распознавание → `app_settings['mediaScan']`) и `media.adopt` (каталог, подписка, перенос, `episode_files`).
- Чистая часть — группировка и разбор имён (`src/lib/media-scan/group.ts`) — тестируется без диска и сети. Распознавание (`recognize.ts`) получает поиск TMDB параметром, перенос (`adopt.ts`) — `fs`, `runner` и набор раздающихся путей.
- «Только файлы» — `subscriptions.files_only`: `wantedEpisodes` для такой подписки пуст, поэтому её не трогают автопоиск, паки, «Ждём» и календарь.

**Tech Stack:** Next.js 16 (App Router, server actions), TypeScript, Drizzle + SQLite, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-16-media-scan-design.md`

## Global Constraints

- Все тексты интерфейса на русском.
- Удаление файлов — только оригинал после успешной пересборки, только по «Добавить» с отмеченной пересборкой, и только если файл не раздаётся.
- Чужой файл не перезаписывается. Если по новому пути что-то лежит — позиция пропускается: «Уже есть: …».
- Пути — только внутри `paths.media` и `paths.movies` (если задан). Иначе — отказ.
- qBittorrent не настроен или недоступен — все файлы считаются раздающимися (жёсткая ссылка).
- Права: сканирование и добавление — `storage` (или админ). Подписка «С подпиской» требует ещё `subscribe`.
- Доменная логика — в `src/lib/*`, `db` параметром; server actions возвращают введённые значения.
- Версия — 2.7.0.

## Review Focus

1. Файл уже лежит по целевому пути (повторный запуск после частичного сбоя) → «Уже есть», без перезаписи и без второй записи в `episode_files`. Тест — в Task 4.
2. Два файла одной позиции распознаны как одна и та же серия (дубль 720p и 1080p) → первый по размеру берётся, второй — «Дубль серии S01E03» в отчёте. Тест — в Task 2.
3. Имя на корейском или японском без латиницы (`참교육/Season 01/참교육 - S01E01 …`) → поиск TMDB по этому имени, сезон/серия по `S01E01`. Тест — в Task 2 (группировка) и Task 3 (запрос к TMDB).
4. Видеофайл в корне без года и номеров (`Happy.Gilmore.1996.BDREMUX.mkv`) → фильм с годом 1996; `Обсессия.2025.UHD…` → фильм 2025. Тест — в Task 2.
5. qBittorrent выключен посреди добавления → файлы этой позиции — жёсткие ссылки, позиция не падает. Тест — в Task 4.

---

## Файлы

- Create: `drizzle/0030_files_only.sql` (+ `meta`) — `subscriptions.files_only`.
- Modify: `src/lib/db/schema.ts` — поле `filesOnly`; `episodeFiles.method` += `'move'`.
- Modify: `src/lib/subscriptions.ts` — `wantedEpisodes` пуст при `filesOnly`; `setFilesOnly`.
- Modify: `src/lib/seasons-watch.ts` — `extendSeasons` не трогает `filesOnly`.
- Create: `src/lib/media-scan/group.ts` — обход дерева (список путей) → позиции с разобранными файлами (чистое).
- Create: `src/lib/media-scan/recognize.ts` — позиция → кандидат TMDB и уверенность (поиск — параметром).
- Create: `src/lib/media-scan/scan.ts` — `runMediaScan(db, deps)`: обход диска, исключение известных файлов, распознавание, запись результата.
- Create: `src/lib/media-scan/adopt.ts` — `adoptItems(db, deps, choices)`: каталог, подписка, перенос, отчёт.
- Create: `src/lib/media-scan/state.ts` — чтение и запись `app_settings['mediaScan']`, типы.
- Modify: `src/worker/handlers.ts` — задачи `media.scan`, `media.adopt`.
- Create: `src/app/(app)/storage/MediaScanCard.tsx`, `MediaScanDialog.tsx`; Modify: `src/app/(app)/storage/actions.ts`, `page.tsx`.
- Modify: `src/app/(app)/library/*` — пометка «только файлы»; страница сериала — «Включить подписку».
- Modify: `src/lib/api/read.ts`, `src/lib/api/write.ts` — `media/scan`, `media/adopt`.
- Tests: `tests/unit/files-only.test.ts`, `media-scan-group.test.ts`, `media-scan-recognize.test.ts`, `media-scan-scan.test.ts`, `media-scan-adopt.test.ts`, `guards.test.ts`, `api-router.test.ts`; `tests/e2e/15-media-scan.spec.ts`.

---

### Task 1: «Только файлы» — подписка, которая ничего не качает

**Files:**
- Create: `drizzle/0030_files_only.sql`
- Modify: `src/lib/db/schema.ts`, `src/lib/subscriptions.ts`, `src/lib/seasons-watch.ts`
- Test: `tests/unit/files-only.test.ts`

**Interfaces:**
- Produces: `subscriptions.filesOnly: boolean` (по умолчанию `false`); `setFilesOnly(db, titleId, on: boolean): void`; `wantedEpisodes(sub, eps, today)` → `[]` при `sub.filesOnly`; `episodeFiles.method` допускает `'move'`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/files-only.test.ts
import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { subscribe, wantedEpisodes, setFilesOnly, getSubscription } from '@/lib/subscriptions';
import { extendSeasons } from '@/lib/seasons-watch';
import { getDefaultProfile } from '@/lib/profile';
import { seasons, subscriptions, titles } from '@/lib/db/schema';

const eps = [{ season: 1, number: 1, airDate: '2026-01-01' }, { season: 1, number: 2, airDate: '2026-01-08' }];

test('«только файлы»: нужных серий нет — автопоиск, паки, «Ждём» и календарь её не трогают; новые сезоны не подписываются', () => {
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 5, kind: 'series', nameRu: 'Силос', nameOriginal: 'Silo', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  const s = subscribe(db, t.id, { ...getDefaultProfile(db, 'series'), mode: 'all', autoNextSeason: true }, 1);
  expect(wantedEpisodes(s, eps, '2026-10-16').length).toBe(2);
  setFilesOnly(db, t.id, true);
  const off = getSubscription(db, t.id)!;
  expect(off.filesOnly).toBe(true);
  expect(wantedEpisodes(off, eps, '2026-10-16')).toEqual([]);
  db.insert(seasons).values([{ titleId: t.id, number: 1, name: 'S1', episodeCount: 2 }, { titleId: t.id, number: 2, name: 'S2', episodeCount: 8 }]).run();
  db.update(subscriptions).set({ maxSeason: 1 }).run();
  expect(extendSeasons(db, t.id, 2)).toBe('none');
  setFilesOnly(db, t.id, false);
  expect(wantedEpisodes(getSubscription(db, t.id)!, eps, '2026-10-16').length).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/files-only.test.ts`
Expected: FAIL — `setFilesOnly` не экспортируется.

- [ ] **Step 3: Implement**

Схема (`src/lib/db/schema.ts`, таблица `subscriptions`):

```ts
    // «Только файлы» (2.7): сериал в библиотеке ради учёта и хранения — ничего не качаем, новые сезоны не подписываем
    filesOnly: integer('files_only', { mode: 'boolean' }).notNull().default(false),
```

`episodeFiles.method`: `text('method', { enum: ['hardlink', 'copy', 'move'] })`.

Миграция: `pnpm drizzle-kit generate --name files_only` (проверить, что SQL — `ALTER TABLE subscriptions ADD files_only integer DEFAULT false NOT NULL;`).

`src/lib/subscriptions.ts`:

```ts
export function wantedEpisodes(sub: Pick<Subscription, 'subscribedAt' | 'profile'> & { maxSeason?: number | null; filesOnly?: boolean }, eps: Ep[], today: string) {
  if (sub.filesOnly) return [];
  // …как было
}

/** «Только файлы» ↔ обычная подписка («Включить подписку» на странице сериала). */
export function setFilesOnly(db: Db, titleId: number, on: boolean, now = Date.now()) {
  db.update(subscriptions).set({ filesOnly: on, updatedAt: now }).where(eq(subscriptions.titleId, titleId)).run();
}
```

`src/lib/seasons-watch.ts`, `extendSeasons`: `if (!sub || sub.filesOnly || sub.maxSeason === null …) return 'none';`

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/unit/files-only.test.ts && pnpm test`
Expected: PASS; весь набор зелёный.

- [ ] **Step 5: Commit**

```bash
git add drizzle src/lib/db/schema.ts src/lib/subscriptions.ts src/lib/seasons-watch.ts tests/unit/files-only.test.ts
git commit -m "feat(library): подписка «только файлы» — не качает, не подписывает новые сезоны"
```

---

### Task 2: Группировка и разбор имён (чистое)

**Files:**
- Create: `src/lib/media-scan/group.ts`
- Test: `tests/unit/media-scan-group.test.ts`

**Interfaces:**
- Consumes: `isVideo` (`src/lib/episode-file.ts`), `episodeFromFilename(file, season)`, `parseRelease(title, attrs, tracker, studios)` (`src/lib/parse/dubs.ts`).
- Produces:

```ts
export type ScanFile = { rel: string; size: number };   // путь от корня, размер
export type ScanEpisode = { rel: string; size: number; season: number; number: number; sidecars: string[] };
export type ScanItem = {
  key: string;                    // rel папки верхнего уровня или файла в корне
  root: 'media' | 'movies';
  kind: 'series' | 'movie';
  names: string[];                // названия для поиска TMDB (по убыванию надёжности)
  year: number | null;
  episodes: ScanEpisode[];        // сериал; для фильма — один элемент с season 0, number 0
  unknown: { rel: string; why: string }[];  // видео без номера, дубли
  size: number;
};
export function groupFiles(files: ScanFile[], root: 'media' | 'movies'): { items: ScanItem[]; skipped: { key: string; why: string }[] };
```

- [ ] **Step 1: Write the failing test** — по реальным именам из медиатеки владельца:

```ts
// tests/unit/media-scan-group.test.ts
import { expect, test } from 'vitest';
import { groupFiles } from '@/lib/media-scan/group';

const f = (rel: string, size = 1e9) => ({ rel, size });

test('сериал в своей структуре: Season NN, номер из имени файла', () => {
  const { items } = groupFiles([f('BEEF/Season 01/BEEF - S01E01 - WEB-DL 2160p TVShows.mkv'), f('BEEF/Season 01/BEEF - S01E02 - WEB-DL 2160p TVShows.mkv')], 'media');
  expect(items).toEqual([expect.objectContaining({ key: 'BEEF', kind: 'series', names: ['BEEF'] })]);
  expect(items[0].episodes.map((e) => [e.season, e.number])).toEqual([[1, 1], [1, 2]]);
});

test('раздача как скачалась: имя из заголовка, сопутствующие .srt — к своей серии, .nfo/.jpg — не видео', () => {
  const { items } = groupFiles(
    [
      f('Task.S01.WEB-DLRip.LF/Task.S01E01.WEB-DLRip.RGzsRutracker.avi'),
      f('Task.S01.WEB-DLRip.LF/Task.S01E01.WEB-DLRip.RGzsRutracker.forced.rus.srt', 900),
      f('Task.S01.WEB-DLRip.LF/Task.S01E02.WEB-DLRip.RGzsRutracker.avi'),
      f('Black.Bird.S01.1080p.ATVP.WEB-DL.DDP5.1.H.264-EniaHD/Black.Bird.S01E01.Pilot.1080p.ATVP.WEB-DL.DDP5.1.H.264-EniaHD.mkv'),
      f('Black.Bird.S01.1080p.ATVP.WEB-DL.DDP5.1.H.264-EniaHD/Черная птица-poster.archos.jpg', 3e4),
    ],
    'media',
  );
  const task = items.find((i) => i.key === 'Task.S01.WEB-DLRip.LF')!;
  expect(task.names[0]).toBe('Task');
  expect(task.episodes[0]).toMatchObject({ season: 1, number: 1, sidecars: ['Task.S01.WEB-DLRip.LF/Task.S01E01.WEB-DLRip.RGzsRutracker.forced.rus.srt'] });
  expect(items.find((i) => i.key.startsWith('Black.Bird'))!.names[0]).toBe('Black Bird');
});

test('фильмы файлом в корне и папкой «Название (Год)»', () => {
  const { items } = groupFiles([f('Happy.Gilmore.1996.BDREMUX.mkv', 1.7e10), f('Обсессия.2025.UHD.Blu-Ray.Remux.2160p.[by arxivariys].mkv'), f('어쩔수가없다 (2025)/어쩔수가없다 (2025) - WEB-DL 2160p DEEP.mkv')], 'media');
  expect(items.map((i) => [i.key, i.kind, i.names[0], i.year])).toEqual([
    ['Happy.Gilmore.1996.BDREMUX.mkv', 'movie', 'Happy Gilmore', 1996],
    ['Обсессия.2025.UHD.Blu-Ray.Remux.2160p.[by arxivariys].mkv', 'movie', 'Обсессия', 2025],
    ['어쩔수가없다 (2025)', 'movie', '어쩔수가없다', 2025],
  ]);
});

test('название без латиницы и несколько сезонов', () => {
  const { items } = groupFiles([f('참교육/Season 01/참교육 - S01E01 - WEB-DL 1080p RuDub.mkv'), f('Family Guy/Season 23/Family Guy - S23E14 - WEB-DL 1080p OMSKBIRD.mkv'), f('Family Guy/Season 24/Family Guy - S24E01 - WEB-DL 1080p OMSKBIRD.mkv')], 'media');
  expect(items.find((i) => i.key === '참교육')!.names[0]).toBe('참교육');
  expect(items.find((i) => i.key === 'Family Guy')!.episodes.map((e) => `${e.season}x${e.number}`)).toEqual(['23x14', '24x1']);
});

test('дубль серии — больший файл берётся, меньший — в «unknown»; видео без номера — тоже', () => {
  const { items } = groupFiles([f('Silo/Season 03/Silo - S03E01 - WEB-DL 1080p LostFilm.mkv', 4e9), f('Silo/Season 03/Silo.S03E01.720p.mkv', 1e9), f('Silo/extras/behind the scenes.mkv', 3e8)], 'media');
  const silo = items[0];
  expect(silo.episodes).toHaveLength(1);
  expect(silo.episodes[0].rel).toContain('1080p');
  expect(silo.unknown.map((u) => u.why)).toEqual(['Дубль серии S03E01', 'Нет номера серии']);
});

test('папка без видео — пропуск с причиной', () => {
  expect(groupFiles([f('Docs/readme.nfo', 10)], 'media').skipped).toEqual([{ key: 'Docs', why: 'Нет видео' }]);
});
```

- [ ] **Step 2: Run** — `pnpm vitest run tests/unit/media-scan-group.test.ts` → FAIL (нет модуля).

- [ ] **Step 3: Implement** `src/lib/media-scan/group.ts`:

```ts
import path from 'node:path';
import { isVideo, episodeFromFilename } from '../episode-file';
import { parseRelease } from '../parse/dubs';

// Медиатека → позиции: папка верхнего уровня или видео в корне. Номер серии — из имени файла, сезон — из имени или «Season NN».

export type ScanFile = { rel: string; size: number };
export type ScanEpisode = { rel: string; size: number; season: number; number: number; sidecars: string[] };
export type ScanItem = { key: string; root: 'media' | 'movies'; kind: 'series' | 'movie'; names: string[]; year: number | null; episodes: ScanEpisode[]; unknown: { rel: string; why: string }[]; size: number };

const SIDECAR = /\.(srt|ass|ssa|sub|idx|mka)$/i;
const SEASON_DIR = /^(?:season|сезон)\s*(\d{1,2})$/i;
const NONE = { id: '', name: '' };
const stem = (rel: string) => path.basename(rel, path.extname(rel));
/** Названия и год: «A.B.2025.UHD…» → «A B», 2025; «Название (2025)» → «Название», 2025. */
function nameOf(raw: string): { names: string[]; year: number | null } {
  const p = parseRelease(raw, {}, NONE, []);
  const names = p.names.length ? p.names : [raw.replace(/[._]+/g, ' ').trim()];
  return { names, year: p.year };
}

export function groupFiles(files: ScanFile[], root: 'media' | 'movies'): { items: ScanItem[]; skipped: { key: string; why: string }[] } {
  const byKey = new Map<string, ScanFile[]>();
  for (const f of files) {
    const key = f.rel.split('/')[0];
    byKey.set(key, [...(byKey.get(key) ?? []), f]);
  }
  const items: ScanItem[] = [];
  const skipped: { key: string; why: string }[] = [];
  for (const [key, list] of byKey) {
    const videos = list.filter((f) => isVideo(f.rel));
    if (!videos.length) {
      skipped.push({ key, why: 'Нет видео' });
      continue;
    }
    const folder = list.length > 1 || key !== list[0].rel;
    const head = nameOf(folder ? key : stem(key));
    const seasonOf = (rel: string) => {
      const dir = rel.split('/').slice(1, -1).map((d) => SEASON_DIR.exec(d)?.[1]).find(Boolean);
      return dir ? Number(dir) : (parseRelease(stem(rel), {}, NONE, []).seasons[0] ?? parseRelease(key, {}, NONE, []).seasons[0] ?? null);
    };
    const numbered = videos.map((v) => {
      const season = seasonOf(v.rel);
      return { v, season, number: season !== null ? episodeFromFilename(path.basename(v.rel), season) : null };
    });
    const series = numbered.some((n) => n.season !== null && n.number !== null);
    const sidecarsOf = (rel: string) => list.filter((s) => SIDECAR.test(s.rel) && path.dirname(s.rel) === path.dirname(rel) && path.basename(s.rel).startsWith(stem(rel))).map((s) => s.rel);
    const item: ScanItem = { key, root, kind: series ? 'series' : 'movie', names: head.names, year: head.year, episodes: [], unknown: [], size: videos.reduce((n, v) => n + v.size, 0) };
    if (!series) {
      const main = [...videos].sort((a, b) => b.size - a.size)[0];
      item.episodes.push({ rel: main.rel, size: main.size, season: 0, number: 0, sidecars: sidecarsOf(main.rel) });
      for (const v of videos) if (v !== main) item.unknown.push({ rel: v.rel, why: 'Не основной файл фильма' });
    } else {
      const seen = new Map<string, ScanEpisode>();
      for (const n of [...numbered].sort((a, b) => b.v.size - a.v.size)) {
        if (n.season === null || n.number === null) {
          item.unknown.push({ rel: n.v.rel, why: 'Нет номера серии' });
          continue;
        }
        const code = `S${String(n.season).padStart(2, '0')}E${String(n.number).padStart(2, '0')}`;
        if (seen.has(code)) item.unknown.push({ rel: n.v.rel, why: `Дубль серии ${code}` });
        else seen.set(code, { rel: n.v.rel, size: n.v.size, season: n.season, number: n.number, sidecars: sidecarsOf(n.v.rel) });
      }
      item.episodes = [...seen.values()].sort((a, b) => a.season - b.season || a.number - b.number);
      item.unknown.sort((a, b) => (a.why < b.why ? -1 : 1));
    }
    items.push(item);
  }
  return { items, skipped };
}
```

Порядок `unknown` в тесте «дубль»: сначала «Дубль серии…», потом «Нет номера серии» — сортировка по `why` даёт ровно это («Д» < «Н»).

- [ ] **Step 4: Run** — тест PASS. Если `parseRelease` для какого-то имени из фикстур даёт другое `names[0]`, сначала поправить разбор в `nameOf`. Ожидания теста — это то, что увидит пользователь.

- [ ] **Step 5: Commit** — `git add src/lib/media-scan/group.ts tests/unit/media-scan-group.test.ts && git commit -m "feat(media-scan): группировка медиатеки и разбор имён"`

---

### Task 3: Распознавание через TMDB

**Files:**
- Create: `src/lib/media-scan/recognize.ts`
- Test: `tests/unit/media-scan-recognize.test.ts`

**Interfaces:**
- Consumes: `ScanItem` (Task 2); `dice` и `MATCH_AT` из `src/lib/match.ts`; `normalizeTitle` из `src/lib/parse/normalize.ts`.
- Produces:

```ts
export type Candidate = { tmdbId: number; type: 'tv' | 'movie'; name: string; original: string; year: number | null; posterPath: string | null; score: number };
export type Search = (query: string, type: 'tv' | 'movie') => Promise<Candidate[]>; // score не заполнен (0)
export async function recognize(item: ScanItem, search: Search): Promise<{ best: Candidate | null; sure: boolean }>;
export function tmdbSearch(tmdb: Tmdb): Search; // через tmdb.search / tmdb.searchMulti
```

- [ ] **Step 1: Failing test**

```ts
// tests/unit/media-scan-recognize.test.ts
import { expect, test } from 'vitest';
import { recognize, type Candidate } from '@/lib/media-scan/recognize';
import type { ScanItem } from '@/lib/media-scan/group';

const item = (o: Partial<ScanItem>): ScanItem => ({ key: 'x', root: 'media', kind: 'series', names: ['Silo'], year: null, episodes: [], unknown: [], size: 0, ...o });
const cand = (o: Partial<Candidate>): Candidate => ({ tmdbId: 1, type: 'tv', name: 'Укрытие', original: 'Silo', year: 2023, posterPath: null, score: 0, ...o });

test('лучший кандидат по названию и году; уверенно — от 0,8', async () => {
  const asked: string[] = [];
  const search = async (q: string, type: 'tv' | 'movie') => (asked.push(`${type}:${q}`), [cand({ tmdbId: 9, original: 'Silos' }), cand({ tmdbId: 125988 })]);
  const r = await recognize(item({ names: ['Silo'] }), search);
  expect(asked).toEqual(['tv:Silo']);
  expect(r).toMatchObject({ best: { tmdbId: 125988 }, sure: true });
});

test('год не совпал — не уверенно; фильм ищется как фильм; ничего — null', async () => {
  const r = await recognize(item({ kind: 'movie', names: ['Happy Gilmore'], year: 1996 }), async (_q, type) => (type === 'movie' ? [cand({ type: 'movie', name: 'Счастливчик Гилмор', original: 'Happy Gilmore', year: 2025 })] : []));
  expect(r.sure).toBe(false);
  expect(await recognize(item({ names: ['Nothing'] }), async () => [])).toEqual({ best: null, sure: false });
});

test('название без латиницы — запрос как есть', async () => {
  const asked: string[] = [];
  await recognize(item({ names: ['참교육'] }), async (q) => (asked.push(q), []));
  expect(asked).toEqual(['참교육']);
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```ts
import { dice, MATCH_AT } from '../match';
import { normalizeTitle } from '../parse/normalize';
import type { Tmdb } from '../tmdb';
import type { ScanItem } from './group';

export type Candidate = { tmdbId: number; type: 'tv' | 'movie'; name: string; original: string; year: number | null; posterPath: string | null; score: number };
export type Search = (query: string, type: 'tv' | 'movie') => Promise<Candidate[]>;

/** Счёт: 0,75 — лучшее сходство названия (ru/оригинал), 0,25 — год (точно 1, ±1 — 0,5, нет года — 0,5). */
function score(item: ScanItem, c: Candidate): number {
  const names = item.names.map(normalizeTitle);
  const sim = Math.max(...[c.name, c.original].map((n) => Math.max(...names.map((x) => dice(x, normalizeTitle(n))))));
  const year = item.year === null || c.year === null ? 0.5 : item.year === c.year ? 1 : Math.abs(item.year - c.year) === 1 ? 0.5 : 0;
  return 0.75 * sim + 0.25 * year;
}

export async function recognize(item: ScanItem, search: Search): Promise<{ best: Candidate | null; sure: boolean }> {
  const type = item.kind === 'movie' ? 'movie' : 'tv';
  for (const q of item.names.slice(0, 2)) {
    const found = (await search(q, type)).map((c) => ({ ...c, score: score(item, c) })).sort((a, b) => b.score - a.score);
    if (found.length) return { best: found[0], sure: found[0].score >= MATCH_AT };
  }
  return { best: null, sure: false };
}

export function tmdbSearch(tmdb: Tmdb): Search {
  return async (q, type) => {
    const y = (d?: string) => (d ? Number(d.slice(0, 4)) || null : null);
    if (type === 'tv') return (await tmdb.search(q)).map((i) => ({ tmdbId: i.id, type, name: i.name, original: i.original_name, year: y(i.first_air_date), posterPath: i.poster_path, score: 0 }));
    return (await tmdb.searchMulti(q)).filter((i) => i.media_type === 'movie').map((i) => ({ tmdbId: i.id, type, name: i.title ?? '', original: i.original_title ?? '', year: y(i.release_date), posterPath: i.poster_path ?? null, score: 0 }));
  };
}
```

В первом тесте `asked` = только `tv:Silo`: после первого непустого ответа поиск заканчивается.

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(media-scan): распознавание через TMDB"`

---

### Task 4: Перенос одной позиции (`adopt.ts`)

**Files:**
- Create: `src/lib/media-scan/adopt.ts`
- Test: `tests/unit/media-scan-adopt.test.ts`

**Interfaces:**
- Consumes: `renderTemplate`, `DEFAULT_TEMPLATE` (`library-path.ts`), `DEFAULT_MOVIE_TEMPLATE` (`movie-files.ts`), `processEpisode` и `TMP_DIR` (`media/process.ts`), `resolutionOf`, `hdrOf`, `parseProbe` (`media/probe.ts`), `describePlan` (`media/tracks.ts`), `pruneUp` (`empty-dirs.ts`), `INTRO_FIELDS_RESET` и `resetIntroMarks` (так же, как `downloads.ts` → вынести экспорт, если не экспортируются), `subscribe`, `setFilesOnly`, `getSubscription`, `getDefaultProfile`, `getMovieDefault`, `openTitle`, `openMovie`.
- Produces:

```ts
export type AdoptChoice = { key: string; root: 'media' | 'movies'; tmdbId: number; type: 'tv' | 'movie'; filesOnly: boolean; process: boolean; episodes: { rel: string; season: number; number: number; sidecars: string[] }[] };
export type AdoptDeps = { tmdb: Tmdb | null; runner: Runner; paths: Paths; seeding: Set<string> /* абсолютные пути файлов живых торрентов */; now: number; userCanSubscribe: boolean };
export type AdoptLine = { key: string; title: string; added: number; skipped: { rel: string; why: string }[]; left: number; error?: string };
export async function adoptItem(db: Db, deps: AdoptDeps, c: AdoptChoice): Promise<AdoptLine>;
export async function seedingPaths(qbit: Qbit | null, paths: Paths): Promise<Set<string> | null>; // null — qBittorrent недоступен
```

- [ ] **Step 1: Failing tests** (временная папка, заглушка runner без ffprobe — путь «link»):

```ts
// tests/unit/media-scan-adopt.test.ts
import { expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { testDb } from './helpers';
import { adoptItem, type AdoptDeps } from '@/lib/media-scan/adopt';
import { episodeFiles, seasons, titles, episodes, subscriptions } from '@/lib/db/schema';
import type { Runner } from '@/lib/media/runner';

const noTools: Runner = { available: async () => ({ ffprobe: false, mkvmerge: false }) } as unknown as Runner;
function setup() {
  const db = testDb();
  const media = mkdtempSync(path.join(tmpdir(), 'dy-adopt-'));
  const put = (rel: string, body = 'video') => (mkdirSync(path.dirname(path.join(media, rel)), { recursive: true }), writeFileSync(path.join(media, rel), body), path.join(media, rel));
  const t = db.insert(titles).values({ tmdbId: 125988, tmdbType: 'tv', kind: 'series', nameRu: 'Укрытие', nameOriginal: 'Silo', year: 2023, originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: Date.now() }).returning().get();
  db.insert(seasons).values({ titleId: t.id, number: 3, name: 'S3', episodeCount: 10 }).run();
  db.insert(episodes).values([1, 2].map((n) => ({ titleId: t.id, season: 3, number: n, name: `E${n}`, airDate: '2026-07-01' }))).run();
  const deps = (o: Partial<AdoptDeps> = {}): AdoptDeps => ({ tmdb: null, runner: noTools, paths: { downloads: media, media }, seeding: new Set(), now: 5, userCanSubscribe: true, ...o });
  return { db, media, put, t, deps };
}
const choice = (o = {}) => ({ key: 'Silo', root: 'media' as const, tmdbId: 125988, type: 'tv' as const, filesOnly: true, process: false, episodes: [{ rel: 'Silo/Season 03/Silo - S03E01 - WEB-DL 1080p LostFilm.mkv', season: 3, number: 1, sidecars: [] }], ...o });

test('не раздаётся — перемещение по шаблону, запись в episode_files, «только файлы», старая папка ушла', async () => {
  const { db, media, put, deps } = setup();
  put('Silo/Season 03/Silo - S03E01 - WEB-DL 1080p LostFilm.mkv');
  put('Silo/@eaDir/x.jpg');
  const r = await adoptItem(db, deps(), choice());
  expect(r).toMatchObject({ added: 1, skipped: [], left: 0 });
  const row = db.select().from(episodeFiles).get()!;
  expect(row).toMatchObject({ season: 3, number: 1, method: 'move', downloadId: null });
  expect(existsSync(path.join(media, row.path))).toBe(true);
  expect(row.path).toBe('Укрытие (2023)/Season 03/Укрытие S03E01 [LostFilm].mkv');
  expect(existsSync(path.join(media, 'Silo'))).toBe(false);
  expect(db.select().from(subscriptions).get()).toMatchObject({ filesOnly: true });
});

test('раздаётся — жёсткая ссылка (inode тот же), оригинал на месте; .srt — рядом с новым именем', async () => {
  const { db, media, put, deps } = setup();
  const src = put('Silo/Season 03/Silo - S03E01 - WEB-DL 1080p LostFilm.mkv');
  put('Silo/Season 03/Silo - S03E01 - WEB-DL 1080p LostFilm.forced.rus.srt', 'sub');
  const r = await adoptItem(db, deps({ seeding: new Set([src]) }), choice({ episodes: [{ ...choice().episodes[0], sidecars: ['Silo/Season 03/Silo - S03E01 - WEB-DL 1080p LostFilm.forced.rus.srt'] }] }));
  const row = db.select().from(episodeFiles).get()!;
  expect(row.method).toBe('hardlink');
  expect(statSync(path.join(media, row.path)).ino).toBe(statSync(src).ino);
  expect(existsSync(src)).toBe(true);
  expect(readFileSync(path.join(media, 'Укрытие (2023)/Season 03/Укрытие S03E01 [LostFilm].forced.rus.srt'), 'utf8')).toBe('sub');
  expect(r.left).toBe(2); // видео и .srt остались для раздачи
});

test('по целевому пути уже лежит файл — «Уже есть», ничего не перезаписано', async () => {
  const { db, media, put, deps } = setup();
  put('Silo/Season 03/Silo - S03E01 - WEB-DL 1080p LostFilm.mkv', 'new');
  put('Укрытие (2023)/Season 03/Укрытие S03E01 [LostFilm].mkv', 'mine');
  const r = await adoptItem(db, deps(), choice());
  expect(r.skipped).toEqual([{ rel: 'Silo/Season 03/Silo - S03E01 - WEB-DL 1080p LostFilm.mkv', why: 'Уже есть: Укрытие (2023)/Season 03/Укрытие S03E01 [LostFilm].mkv' }]);
  expect(readFileSync(path.join(media, 'Укрытие (2023)/Season 03/Укрытие S03E01 [LostFilm].mkv'), 'utf8')).toBe('mine');
  expect(db.select().from(episodeFiles).all()).toEqual([]);
});

test('путь вне медиатеки — отказ позиции', async () => {
  const { db, deps } = setup();
  const r = await adoptItem(db, deps(), choice({ episodes: [{ rel: '../etc/passwd', season: 3, number: 1, sidecars: [] }] }));
  expect(r.error).toBe('Путь вне медиатеки');
});

test('qBittorrent недоступен (seeding = null) — жёсткие ссылки, позиция не падает', async () => {
  const { db, put, deps } = setup();
  const src = put('Silo/Season 03/Silo - S03E01 - WEB-DL 1080p LostFilm.mkv');
  await adoptItem(db, { ...deps(), seeding: null as unknown as Set<string> }, choice());
  expect(db.select().from(episodeFiles).get()!.method).toBe('hardlink');
  expect(existsSync(src)).toBe(true);
});

test('с подпиской — обычная подписка (filesOnly false)', async () => {
  const { db, put, deps } = setup();
  put('Silo/Season 03/Silo - S03E01 - WEB-DL 1080p LostFilm.mkv');
  await adoptItem(db, deps(), choice({ filesOnly: false }));
  expect(db.select().from(subscriptions).get()).toMatchObject({ filesOnly: false });
});
```

Тип `AdoptDeps.seeding`: `Set<string> | null` (`null` — qBittorrent недоступен).

- [ ] **Step 2: Run** → FAIL (нет модуля).

- [ ] **Step 3: Implement** `src/lib/media-scan/adopt.ts`. Ключевые части:

```ts
import { link, mkdir, rename, rm, stat, copyFile } from 'node:fs/promises';
import path from 'node:path';
// …импорты из Interfaces

const inside = (root: string, rel: string) => {
  const abs = path.resolve(root, rel);
  return abs.startsWith(`${path.resolve(root)}${path.sep}`) ? abs : null;
};
const exists = (p: string) => stat(p).then(() => true, () => false);

/** Перенести один файл: раздаётся — ссылка (EXDEV — копия), иначе — перемещение. */
async function place(src: string, dst: string, seeding: boolean): Promise<'hardlink' | 'copy' | 'move'> {
  await mkdir(path.dirname(dst), { recursive: true });
  if (!seeding) return rename(src, dst).then(() => 'move' as const);
  try {
    await link(src, dst);
    return 'hardlink';
  } catch (e) {
    if (['EXDEV', 'EPERM', 'ENOTSUP', 'EMLINK'].includes((e as NodeJS.ErrnoException).code ?? '')) {
      await copyFile(src, dst);
      return 'copy';
    }
    throw e;
  }
}

export async function adoptItem(db: Db, deps: AdoptDeps, c: AdoptChoice): Promise<AdoptLine> {
  const root = c.root === 'movies' ? (deps.paths.movies ?? deps.paths.media) : deps.paths.media;
  const line: AdoptLine = { key: c.key, title: c.key, added: 0, skipped: [], left: 0 };
  if (c.episodes.some((e) => !inside(root, e.rel) || e.sidecars.some((s) => !inside(root, s)))) return { ...line, error: 'Путь вне медиатеки' };
  try {
    const title = c.type === 'movie' ? (await openMovie(db, deps.tmdb, c.tmdbId, deps.now)).title : (await openTitle(db, deps.tmdb, c.tmdbId, deps.now)).title;
    line.title = title.nameRu;
    if (!getSubscription(db, title.id)) {
      const profile = title.kind === 'movie' ? getMovieDefault(db) : getDefaultProfile(db, title.kind);
      subscribe(db, title.id, profile, deps.now);
      setFilesOnly(db, title.id, c.filesOnly || !deps.userCanSubscribe, deps.now);
    }
    const template = title.kind === 'movie' ? deps.paths.movieTemplate || DEFAULT_MOVIE_TEMPLATE : deps.paths.template || DEFAULT_TEMPLATE;
    for (const e of c.episodes) {
      const src = inside(root, e.rel)!;
      const seed = deps.seeding === null || deps.seeding.has(src);
      // разбор студии из имени — подпись в шаблоне; ffprobe — разрешение; пересборка — processEpisode, как при импорте
      const proc = c.process ? await processEpisode({ /* как importEpisode: runner, settings, wanted [], backups [], originalLang, studios, external: sidecars, runtime */ ... }) : { kind: 'link' as const, probe: null };
      const quality = proc.probe ? resolutionOf(proc.probe) : (parseRelease(path.basename(e.rel), {}, NONE, studioRefs).resolution ?? null);
      const studio = studioLabelOf(db, e.rel); // подпись студии по словарю из имени файла, '' если нет
      const rel = renderTemplate(template, { name: title.nameRu, original: title.nameOriginal, year: title.year, season: e.season, episode: e.number, studio, quality: quality ? `${quality}p` : '' }, proc.kind === 'remux' ? '.mkv' : path.extname(e.rel));
      const dst = inside(root, rel)!;
      if (await exists(dst)) {
        line.skipped.push({ rel: e.rel, why: `Уже есть: ${rel}` });
        if (proc.kind === 'remux') await rm(proc.tmp, { force: true });
        continue;
      }
      const method = proc.kind === 'remux' ? (await rename(proc.tmp, dst), 'copy' as const) : await place(src, dst, seed);
      if (proc.kind === 'remux' && !seed) await rm(src, { force: true }); // оригинал после проверенной пересборки (Global Constraints)
      for (const s of e.sidecars) {
        const tail = path.basename(s).slice(path.basename(e.rel, path.extname(e.rel)).length); // «.forced.rus.srt»
        const sd = path.join(path.dirname(dst), path.basename(rel, path.extname(rel)) + tail);
        if (!(await exists(sd))) await place(inside(root, s)!, sd, seed);
      }
      const size = (await stat(dst)).size;
      db.insert(episodeFiles).values({ titleId: title.id, season: e.season, number: e.number, path: rel, size, downloadId: null, studioLabel: studio || null, resolution: quality, method: method === 'move' ? 'move' : method, importedAt: deps.now, dubPosition: null, processed: proc.kind === 'remux', hdr: proc.probe ? hdrOf(proc.probe) : false, duration: proc.probe?.duration ? Math.round(proc.probe.duration) : null, tracks: proc.kind === 'remux' ? describePlan(proc.probe, proc.plan, () => undefined) : null, ...INTRO_FIELDS_RESET }).run();
      resetIntroMarks(db, title.id, e.season);
      line.added++;
    }
    // что осталось в старой папке (раздаётся, .nfo, обложки) — счёт для отчёта; пустое и служебное — убрать
    const dirs = new Set(c.episodes.map((e) => path.dirname(inside(root, e.rel)!)));
    for (const d of dirs) await pruneUp(d, root);
    line.left = await countFiles(path.join(root, c.key.split('/')[0]));
  } catch (e) {
    line.error = e instanceof Error ? e.message : String(e);
  }
  return line;
}
```

Вспомогательные функции:
- `countFiles(dir)` — рекурсивно файлы, кроме `isJunk`; нет папки — 0.
- `studioLabelOf(db, rel)` — `parseRelease(basename)`, первая `dub` с `studioId` → имя студии из словаря. Иначе `''`. В тестах `LostFilm` из засева словаря.
- `seedingPaths(qbit, paths)` — `qbit.list()`, для каждого торрента `qbit.files(hash)`; путь — `toLocalPath(save_path/name, paths.qbitDownloads ?? paths.downloads, paths.downloads)`. Ошибка или `null` клиента → `null`.

`INTRO_FIELDS_RESET` и `resetIntroMarks`: если они не экспортируются из своих модулей (`downloads.ts` или `intros/*`), добавить экспорт, без изменения поведения.

Пересборка (`c.process`): параметры как в `processingContext` и `importEpisode` из `downloads.ts`:
- `settings: getProcessing(db)`;
- `studios` из словаря;
- `wanted: []`, `backups: []` — без профиля оставляются все русские озвучки по `planTracks`;
- `runtime` из `episodes`;
- `external` — `findExternal` по `sidecars`;
- `targetDir: root`.

`WrongEpisodeError` → `line.skipped.push({ rel, why: 'Не та серия: …' })`.

- [ ] **Step 4: Run** → все тесты Task 4 PASS. Затем `pnpm test`.
- [ ] **Step 5: Commit** — `git commit -m "feat(media-scan): перенос позиции — ссылка/перемещение/пересборка, защита от перезаписи"`

---

### Task 5: Задачи воркера и состояние

**Files:**
- Create: `src/lib/media-scan/state.ts`, `src/lib/media-scan/scan.ts`
- Modify: `src/worker/handlers.ts`, `src/lib/heartbeat.ts` (подписи задач), `src/lib/notify-events.ts` (сводка)
- Test: `tests/unit/media-scan-scan.test.ts`

**Interfaces:**
- Consumes: `groupFiles` (Task 2), `recognize` и `tmdbSearch` (Task 3), `adoptItem` и `seedingPaths` (Task 4), `isJunk` (`empty-dirs.ts`), `OLD_DIR` (`old-copies.ts`), `TMP_DIR`.
- Produces:

```ts
// state.ts
export type ScanEntry = ScanItem & { candidate: Candidate | null; sure: boolean; have: string[] /* «S03E01», у которых уже есть файл в Dublyarr */ };
export type MediaScanState = { status: 'idle' | 'scanning' | 'adopting'; progress?: { done: number; total: number }; scannedAt?: number; items: ScanEntry[]; skipped: { key: string; why: string }[]; last?: { at: number; lines: AdoptLine[] } };
export const getScanState: (db: Db) => MediaScanState;
export const setScanState: (db: Db, s: MediaScanState) => void;
// scan.ts
export async function runMediaScan(db: Db, deps: { tmdb: Tmdb | null; paths: Paths; search?: Search }): Promise<MediaScanState>;
export async function runAdopt(db: Db, deps: Omit<AdoptDeps, 'seeding'> & { qbit: Qbit | null }, choices: AdoptChoice[]): Promise<AdoptLine[]>;
```

- [ ] **Step 1: Failing test** (диск — временная папка, поиск — заглушка):

```ts
// tests/unit/media-scan-scan.test.ts
import { expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { testDb } from './helpers';
import { runMediaScan } from '@/lib/media-scan/scan';
import { getScanState } from '@/lib/media-scan/state';
import { episodeFiles, titles } from '@/lib/db/schema';

test('обход: файлы Dublyarr, .dublyarr-old, служебное — мимо; новые серии сериала из библиотеки — в его позицию; результат сохраняется', async () => {
  const db = testDb();
  const media = mkdtempSync(path.join(tmpdir(), 'dy-scan-'));
  const put = (rel: string) => (mkdirSync(path.dirname(path.join(media, rel)), { recursive: true }), writeFileSync(path.join(media, rel), 'v'));
  put('Silo/Season 03/Silo - S03E01 - WEB-DL 1080p LostFilm.mkv');
  put('Фонари (2026)/Season 01/Фонари S01E01 [LostFilm 1080p].mkv');
  put('Фонари (2026)/Season 01/Фонари S01E09 [LostFilm 1080p].mkv'); // новая, не в базе
  put('.dublyarr-old/A (2020)/Season 01/A S01E01.mkv');
  put('@eaDir/x.mkv');
  const t = db.insert(titles).values({ tmdbId: 95350, tmdbType: 'tv', kind: 'series', nameRu: 'Фонари', nameOriginal: 'Lanterns', year: 2026, originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  db.insert(episodeFiles).values({ titleId: t.id, season: 1, number: 1, path: 'Фонари (2026)/Season 01/Фонари S01E01 [LostFilm 1080p].mkv', size: 1, method: 'hardlink', importedAt: 1 }).run();
  const search = async () => [{ tmdbId: 125988, type: 'tv' as const, name: 'Укрытие', original: 'Silo', year: 2023, posterPath: null, score: 0 }];
  const s = await runMediaScan(db, { tmdb: null, paths: { downloads: media, media }, search });
  expect(s.items.map((i) => [i.key, i.candidate?.tmdbId, i.episodes.length])).toEqual([
    ['Silo', 125988, 1],
    ['Фонари (2026)', 95350, 1],
  ]);
  expect(s.items[1]).toMatchObject({ sure: true, have: [] });
  expect(getScanState(db).items).toHaveLength(2);
});
```

Позиция с папкой Dublyarr: если ключ совпадает с папкой сериала из библиотеки — префикс пути `episode_files` этого сериала до первого `/` — кандидат берётся из `titles` (`sure: true`), без поиска.

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**
  - `scan.ts`: `walk(root)` — рекурсивно, пропуская `isJunk`, `OLD_DIR`, `TMP_DIR` (и любые имена с точкой в начале на верхнем уровне).
  - Известные пути — `episode_files.path` (+ `old_copies.path`); такие файлы исключаются до `groupFiles`.
  - Для каждой позиции: `have` — коды серий, которые уже есть у кандидата в `episode_files`.
  - Пока идёт обход, прогресс пишется через `setScanState` (`status: 'scanning'`).
  - `handlers.ts`:

```ts
  'media.scan': async () => {
    const paths = getSetting<Paths>(db, 'paths');
    if (paths) await runMediaScan(db, { tmdb: getTmdb(db), paths });
  },
  'media.adopt': async (payload) => {
    const paths = getSetting<Paths>(db, 'paths');
    const p = payload as { choices: AdoptChoice[]; canSubscribe: boolean };
    if (paths) await runAdopt(db, { tmdb: getTmdb(db), runner: systemRunner, paths, now: Date.now(), userCanSubscribe: p.canSubscribe, qbit: getQbit(db) }, p.choices);
  },
```

  - `runAdopt`: `seedingPaths` один раз, затем `adoptItem` по очереди с прогрессом. В конце — `state.last` и одна сводка Telegram `notify(db, { key: \`adopt:${now}\`, kind: 'imported', text: \`📥 Взято в Dublyarr: ${добавлено} файлов (${позиций} позиций)\` })` (как сводка «скачано»).
  - `heartbeat.ts`: `'media.scan': 'сканирование медиатеки', 'media.adopt': 'перенос в медиатеку'`.
- [ ] **Step 4: Run** → PASS; `pnpm test`.
- [ ] **Step 5: Commit** — `git commit -m "feat(media-scan): задачи воркера media.scan / media.adopt, состояние"`

---

### Task 6: Интерфейс — блок «Медиатека» и окно

**Files:**
- Create: `src/app/(app)/storage/MediaScanCard.tsx`, `src/app/(app)/storage/MediaScanDialog.tsx`
- Modify: `src/app/(app)/storage/actions.ts`, `src/app/(app)/storage/page.tsx`
- Test: `tests/unit/guards.test.ts`

**Interfaces:**
- Consumes: `getScanState`, `MediaScanState`, `AdoptChoice` (Task 5), `enqueue` (`worker/jobs`), `guard`, `can`, `tmdbSearch` (Task 3), `ui/Modal`, `posterUrl` (`image-url.ts`).
- Produces (actions):

```ts
export async function startMediaScanAction(): Promise<{ ok?: string; error?: string }>;            // guard('storage') → enqueue('media.scan')
export async function mediaScanStateAction(): Promise<MediaScanState | null>;                       // guard('storage')
export async function adoptMediaAction(choices: AdoptChoice[]): Promise<{ ok?: string; error?: string }>; // guard('storage'); canSubscribe = can(user,'subscribe') → enqueue('media.adopt', { choices, canSubscribe })
export async function searchCandidatesAction(q: string, type: 'tv' | 'movie'): Promise<Candidate[]>;   // guard('storage')
```

- [ ] **Step 1: Failing test** — в `tests/unit/guards.test.ts` рядом с другими действиями «Хранилища» (пользователь без `storage`):

```ts
    const scan = await import('@/app/(app)/storage/actions');
    expect(await scan.startMediaScanAction()).toMatchObject(DENIED);
    expect(await scan.adoptMediaAction([])).toMatchObject(DENIED);
    expect(await scan.mediaScanStateAction()).toBeNull();
    expect(await scan.searchCandidatesAction('Silo', 'tv')).toEqual([]);
```

- [ ] **Step 2: Run** → FAIL (нет функций).
- [ ] **Step 3: Implement**

Блок (`MediaScanCard`, клиентский):
- заголовок «Медиатека», кнопка «Сканировать» (`startMediaScanAction`);
- строка состояния: «Сканирую… 6 из 21» / «Добавляю… 3 из 9» / «Найдено N · <когда>» с кнопкой «Открыть»;
- итог `last`: «Добавлено 8 · пропущено 1 · ошибка 1», а пропуски и ошибки — списком под катом «Подробнее»;
- опрос `mediaScanStateAction` раз в 2 с, пока `status !== 'idle'` (как `useFound`).

Окно (`MediaScanDialog`) — `ui/Modal` со списком `items`. В строке:
- постер `candidate.posterPath`, «название · год · тип»;
- `key` моноширинным шрифтом, файлов и размер;
- серии по сезонам («Season 03: 1–10»), `have` — «уже есть: S03E01», `unknown` — серой строкой;
- «Это не он» → поле поиска (`searchCandidatesAction`) и список кандидатов;
- сегмент «С подпиской / Только файлы» — только для сериала; при отсутствии права `subscribe` — только «Только файлы»;
- чекбокс «Пересобрать как при импорте»;
- пример пути — первая серия по шаблону (`renderTemplate` на клиенте — функция чистая);
- чекбокс «Добавить» — `sure && candidate`.

Под списком:
- раздел «Не распознано» — `skipped` и позиции без кандидата;
- итог: «Добавить N · X ГБ». Если отмечена пересборка — «оригиналы после пересборки удаляются (кроме раздающихся)»;
- кнопка «Добавить» → `adoptMediaAction(выбранное)`: из каждой позиции серии без `have`.

`page.tsx`: `<MediaScanCard initial={getScanState(db)} canSubscribe={can(user, 'subscribe')} />` — первым блоком в `<aside>`, видимым при праве `storage`.

- [ ] **Step 4: Run** — `pnpm vitest run tests/unit/guards.test.ts && pnpm typecheck && pnpm lint` → зелёные.
- [ ] **Step 5: Commit** — `git commit -m "feat(storage): блок «Медиатека» и окно добавления"`

---

### Task 7: «Только файлы» в библиотеке и на странице сериала; API

**Files:**
- Modify: `src/lib/subscriptions.ts` (`LibraryItem.filesOnly`), `src/app/(app)/library/*` (пометка), страница сериала (`src/app/(app)/series/[tmdbId]/…` — кнопка), её actions
- Modify: `src/lib/api/read.ts`, `src/lib/api/write.ts`
- Test: `tests/unit/files-only.test.ts` (дополнить), `tests/unit/api-router.test.ts`, `tests/unit/guards.test.ts`

**Interfaces:**
- Produces:
  - `LibraryItem.filesOnly: boolean`;
  - action `enableSubscriptionAction(form)` (guard `subscribe`) → `setFilesOnly(db, titleId, false)`;
  - API:
    - `GET media/scan` → `MediaScanState`;
    - `POST media/scan` → `{ ok }`;
    - `POST media/adopt` `{ choices: AdoptChoice[] }` → `{ ok }`.

- [ ] **Step 1: Failing tests**:
  - `libraryItems` возвращает `filesOnly: true` для такой подписки;
  - `api-router`: `GET /media/scan` → 200 с `status: 'idle'`, `POST /media/adopt` с пустым `choices` → 400 «Нет позиций»;
  - `guards`: `enableSubscriptionAction` без `subscribe` → `DENIED`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**:
  - в `libraryItems` добавить `filesOnly: sub.filesOnly` (выбирать `subscriptions.filesOnly`);
  - карточка библиотеки — бейдж «только файлы» (стиль «оригинал» — серая рамка, `design/README.md`);
  - страница сериала — при `filesOnly` кнопка «Включить подписку» вместо «Изменить подписку»;
  - API — как остальные: `write.ts` зовёт те же функции, что actions (`enqueue`).
- [ ] **Step 4: Run** → PASS; `pnpm test`.
- [ ] **Step 5: Commit** — `git commit -m "feat(library): «только файлы» — пометка и «Включить подписку»; API media/scan, media/adopt"`

---

### Task 8: e2e, документация, версия

**Files:**
- Create: `tests/e2e/15-media-scan.spec.ts`
- Modify: `tests/e2e/tmdb-stub.mjs` (поиск «Silo» и фильм «Happy Gilmore», если их нет), `CLAUDE.md`, `docs/spec.md` (§8), `package.json` (2.7.0)

- [ ] **Step 1: e2e** (после 14 сценариев, на той же базе; медиатека — `$E2E_DIR/media` из 05):

```ts
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { loginWithCode } from './helpers';

test('медиатека: чужая папка и фильм → «Сканировать» → окно → «Добавить» → по шаблону, «только файлы» в библиотеке', async ({ page }) => {
  test.setTimeout(120_000);
  const media = path.join(process.env.E2E_DIR!, 'media');
  mkdirSync(path.join(media, 'Silo/Season 03'), { recursive: true });
  writeFileSync(path.join(media, 'Silo/Season 03/Silo - S03E01 - WEB-DL 1080p LostFilm.mkv'), 'v');
  await loginWithCode(page);
  await page.goto('/storage');
  await page.getByRole('button', { name: 'Сканировать' }).click();
  await expect(page.getByRole('button', { name: 'Открыть' })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Открыть' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Silo', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: /^Добавить/ }).click();
  await expect(page.getByText(/^Добавлено 1/)).toBeVisible({ timeout: 60_000 });
  expect(existsSync(path.join(media, 'Silo'))).toBe(false);
  await page.goto('/library');
  await expect(page.getByText('только файлы')).toBeVisible();
});
```

(Имя сериала в окне — как отдаёт заглушка TMDB для «Silo». Если заглушки нет — добавить её в `tmdb-stub.mjs` вместе с `tests/fixtures/tmdb/`.)

- [ ] **Step 2: Run** — `pnpm e2e` → 15 из 15.
- [ ] **Step 3: Документация**:
  - `CLAUDE.md` — раздел «Решения (2.7 — сканирование медиатеки)»: модули, задачи, `files_only`, правила переноса и удаления;
  - `docs/spec.md` §8 — строка про сканирование.
- [ ] **Step 4: Версия** — `package.json` → `2.7.0`; `pnpm test && pnpm lint && pnpm typecheck`.
- [ ] **Step 5: Commit** — `git commit -m "test(e2e): сканирование медиатеки; документы; версия 2.7.0"`
