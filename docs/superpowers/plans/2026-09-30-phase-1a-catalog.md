# Фаза 1a «Каталог»: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** сериалы и аниме из TMDB в локальной базе: поиск и тренды, карточка сериала с сезонами и сериями, ежедневное обновление, прокси постеров, ключ TMDB в мастере и настройках.

**Architecture:** клиент TMDB (`src/lib/tmdb/*`) — чистый модуль с подменяемым `fetch`; маппинг ответов в строки БД отдельно (`map.ts`); каталог (`src/lib/catalog.ts`) синхронизирует сериал в `titles/seasons/episodes`. Воркер получает простой планировщик «раз в сутки» и задачу `tmdb.refresh-all`. Картинки идут через `/api/image/...` с дисковым кэшем. Экраны — серверные компоненты Next с server actions.

**Tech Stack:** как в фазе 0 + `undici` (ProxyAgent для прокси TMDB).

**Spec:** `docs/superpowers/specs/2026-09-30-phase-1a-catalog-design.md`; общее поведение — `docs/spec.md`; дизайн — `design/README.md`, `design/screens/Series.dc.html`, `MobileSeries.dc.html`.

## Global Constraints

- Все тексты интерфейса на русском; тёмная тема; цвета только из токенов `src/app/globals.css`.
- Цели нажатия ≥ 44 px; радиусы: кнопки 8–12, карточки 14–18.
- Ключ TMDB — только зашифрованным в `app_settings` (`setSecretSetting`), в логах — никогда (URL в логах через `redactUrl`).
- Фильмы не показываются нигде (решение владельца, до фазы 3).
- Доменные функции принимают `db` (и клиент TMDB) параметром; тесты — на `testDb()` и фиктивном `fetch`.
- `React 19` сбрасывает форму после action — формы возвращают введённые значения через `formValues` (см. фазу 0).
- Next 16: `params`/`searchParams` — Promise; `Date.now()` не вызывать в теле компонента (правило линтера) — выносить в функции.
- Env для тестов: `TMDB_BASE_URL` (по умолчанию `https://api.themoviedb.org/3`), `TMDB_IMAGE_BASE_URL` (по умолчанию `https://image.tmdb.org/t/p`).

## Review Focus

1. **Повторное открытие карточки, когда TMDB недоступен** — показывается сохранённое из базы + «TMDB не ответил, данные от <дата>», страница не падает. Тест в Task 4 (`openTitle` при ошибке клиента).
2. **Ручной тип «Аниме/Сериал» переживает ежедневное обновление** — `kind_manual` не перетирается. Тест в Task 4.
3. **Имя файла картинки из URL** (`../../secret.key`, `%2e%2e`, пустое) — 400, никакого чтения/записи вне кэша. Тест в Task 6.
4. **TMDB отвечает 429 при массовом обновлении** — одна пауза по `Retry-After` (≤ 5 с) и повтор; ошибка одного сериала не останавливает обновление остальных. Тесты в Task 2 и Task 5.
5. **Серии удалены или перенумерованы в TMDB** — при обновлении сезона лишние эпизоды удаляются, а не остаются дублями. Тест в Task 4.

---

## Структура файлов

```
src/lib/db/schema.ts                  + titles, seasons, episodes
drizzle/0001_*.sql                    миграция
src/lib/tmdb/types.ts                 типы ответов TMDB (только нужные поля)
src/lib/tmdb/client.ts                createTmdb(): auth v3/v4, язык, таймаут, 429, прокси, кэш поиска
src/lib/tmdb/map.ts                   ответы → строки БД, isAnime, altNames, status
src/lib/tmdb/index.ts                 getTmdbConfig/saveTmdbConfig/getTmdb(db)
src/lib/catalog.ts                    syncTitle, openTitle, setKind, запросы для экранов
src/lib/images.ts                     валидация, дисковый кэш картинок
src/worker/schedule.ts                scheduleDaily
src/worker/handlers.ts                обработчики задач воркера (tmdb.refresh-all)
src/app/api/image/[size]/[file]/route.ts
src/components/catalog/Poster.tsx     постер с цветной заглушкой
src/components/catalog/PosterCard.tsx карточка в сетке
src/app/setup/tmdb/{page.tsx,TmdbForm.tsx}
src/app/(app)/settings/sources/{page.tsx,TmdbCard.tsx,actions.ts}
src/app/(app)/discover/{page.tsx,SearchBox.tsx}
src/app/(app)/series/[tmdbId]/{page.tsx,actions.ts,KindSwitch.tsx}
tests/fixtures/tmdb/*.json
tests/e2e/tmdb-stub.mjs
```

---

### Task 1: Таблицы каталога и миграция

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: `drizzle/0001_*.sql` (генерируется)
- Test: `tests/unit/catalog-schema.test.ts`

**Interfaces:**
- Produces: `titles`, `seasons`, `episodes` (Drizzle), типы `Title = typeof titles.$inferSelect`, `Season`, `Episode`.

- [ ] **Step 1: Failing test**

```ts
// tests/unit/catalog-schema.test.ts
import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { titles, seasons, episodes } from '@/lib/db/schema';

test('каталог: сериал, сезон, серия; уникальность серии; каскадное удаление', () => {
  const db = testDb();
  const t = db.insert(titles).values({
    tmdbId: 1399, kind: 'series', nameRu: 'Игра престолов', nameOriginal: 'Game of Thrones', originalLanguage: 'en',
    status: 'ended', createdAt: 1, refreshedAt: 1,
  }).returning().get();
  expect(t.altNames).toEqual([]);
  expect(t.kindManual).toBe(false);
  db.insert(seasons).values({ titleId: t.id, number: 1, name: 'Сезон 1', episodeCount: 10 }).run();
  db.insert(episodes).values({ titleId: t.id, season: 1, number: 1, name: 'Зима близко', airDate: '2011-04-17' }).run();
  expect(() => db.insert(episodes).values({ titleId: t.id, season: 1, number: 1, name: 'дубль' }).run()).toThrow();
  db.delete(titles).run();
  expect(db.select().from(episodes).all()).toHaveLength(0);
  expect(db.select().from(seasons).all()).toHaveLength(0);
});
```

- [ ] **Step 2: Run** `pnpm vitest run tests/unit/catalog-schema.test.ts` — FAIL (нет экспорта `titles`).

- [ ] **Step 3: Implement** — добавить в `src/lib/db/schema.ts` (импорт `uniqueIndex` из `drizzle-orm/sqlite-core`):

```ts
const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();

export const titles = sqliteTable('titles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tmdbId: integer('tmdb_id').notNull().unique(),
  kind: text('kind', { enum: ['series', 'anime'] }).notNull(),
  kindManual: integer('kind_manual', { mode: 'boolean' }).notNull().default(false),
  nameRu: text('name_ru').notNull(),
  nameOriginal: text('name_original').notNull(),
  originalLanguage: text('original_language').notNull(),
  altNames: json<string[]>('alt_names').notNull().default([]),
  year: integer('year'),
  status: text('status', { enum: ['returning', 'ended', 'canceled', 'in_production', 'planned'] }).notNull(),
  overview: text('overview').notNull().default(''),
  genres: json<string[]>('genres').notNull().default([]),
  originCountries: json<string[]>('origin_countries').notNull().default([]),
  networks: json<string[]>('networks').notNull().default([]),
  posterPath: text('poster_path'),
  backdropPath: text('backdrop_path'),
  nextAirDate: text('next_air_date'),
  lastAirDate: text('last_air_date'),
  refreshedAt: ts('refreshed_at').notNull(),
  createdAt: ts('created_at').notNull(),
});

export const seasons = sqliteTable(
  'seasons',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    titleId: integer('title_id').notNull().references(() => titles.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    name: text('name').notNull(),
    airDate: text('air_date'),
    episodeCount: integer('episode_count').notNull().default(0),
    posterPath: text('poster_path'),
  },
  (t) => [uniqueIndex('seasons_title_number').on(t.titleId, t.number)],
);

export const episodes = sqliteTable(
  'episodes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    titleId: integer('title_id').notNull().references(() => titles.id, { onDelete: 'cascade' }),
    season: integer('season').notNull(),
    number: integer('number').notNull(),
    name: text('name').notNull(),
    airDate: text('air_date'),
    runtime: integer('runtime'),
  },
  (t) => [uniqueIndex('episodes_title_season_number').on(t.titleId, t.season, t.number)],
);

export type Title = typeof titles.$inferSelect;
export type Season = typeof seasons.$inferSelect;
export type Episode = typeof episodes.$inferSelect;
```

(`json` и `ts` — локальные хелперы; `ts` уже есть в файле.)

- [ ] **Step 4:** `pnpm db:generate` → `drizzle/0001_*.sql`.
- [ ] **Step 5: Run** `pnpm test` — PASS (все).
- [ ] **Step 6: Commit** `feat(catalog): таблицы titles/seasons/episodes`.

---

### Task 2: Клиент TMDB

**Files:**
- Create: `src/lib/tmdb/types.ts`, `src/lib/tmdb/client.ts`
- Test: `tests/unit/tmdb-client.test.ts`

**Interfaces:**
- Produces:
  - `types.ts`:
    ```ts
    export type TmdbTvDetails = {
      id: number; name: string; original_name: string; original_language: string; overview: string;
      first_air_date: string | null; last_air_date: string | null; status: string;
      genres: { id: number; name: string }[]; origin_country: string[]; networks: { name: string }[];
      poster_path: string | null; backdrop_path: string | null; number_of_seasons: number;
      next_episode_to_air: { air_date: string | null } | null;
      seasons: { season_number: number; name: string; air_date: string | null; episode_count: number; poster_path: string | null }[];
      alternative_titles?: { results: { iso_3166_1: string; title: string; type: string }[] };
    };
    export type TmdbSeason = {
      season_number: number;
      episodes: { episode_number: number; name: string; air_date: string | null; runtime: number | null }[];
    };
    export type TmdbTvListItem = {
      id: number; name: string; original_name: string; first_air_date?: string; poster_path: string | null;
      genre_ids: number[]; origin_country: string[];
    };
    export type TmdbPage<T> = { page: number; results: T[]; total_results: number };
    ```
  - `client.ts`:
    ```ts
    export type TmdbConfig = { apiKey: string; proxy?: string };
    export type TmdbErrorCode = 'auth' | 'rate' | 'network' | 'not_found' | 'http';
    export class TmdbError extends Error { constructor(message: string, readonly code: TmdbErrorCode) }
    export type TmdbOptions = { fetchImpl?: typeof fetch; baseUrl?: string; sleep?: (ms: number) => Promise<void>; now?: () => number };
    export type Tmdb = {
      configuration(): Promise<void>;
      details(id: number): Promise<TmdbTvDetails>;       // ru-RU, пустой overview/name дополняется из en-US
      season(id: number, n: number): Promise<TmdbSeason>; // ru-RU
      search(query: string): Promise<TmdbTvListItem[]>;   // кэш 1 ч
      trending(): Promise<TmdbTvListItem[]>;              // кэш 1 ч
    };
    export function createTmdb(cfg: TmdbConfig, opts?: TmdbOptions): Tmdb;
    export function clearTmdbCache(): void;
    ```
  Сообщения `TmdbError`: auth — «Неверный ключ TMDB»; rate — «TMDB ограничил запросы, попробуйте позже»; not_found — «Не найдено в TMDB»; network — «TMDB не отвечает: <причина>»; http — «TMDB ответил ошибкой <код>».

- [ ] **Step 1: Failing tests**

```ts
// tests/unit/tmdb-client.test.ts
import { beforeEach, expect, test } from 'vitest';
import { createTmdb, TmdbError, clearTmdbCache } from '@/lib/tmdb/client';

type Call = { url: URL; headers: Headers };
function fake(handler: (u: URL) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, headers: new Headers(init?.headers) });
    return handler(url);
  }) as typeof fetch;
  return { calls, fetchImpl };
}
const json = (b: unknown, init?: ResponseInit) => new Response(JSON.stringify(b), { ...init, headers: { 'content-type': 'application/json' } });
const base = 'http://tmdb.test/3';

beforeEach(() => clearTmdbCache());

test('ключ v3 — query api_key, токен v4 — Bearer; язык ru-RU', async () => {
  const v3 = fake(() => json({ page: 1, results: [], total_results: 0 }));
  await createTmdb({ apiKey: '0123456789abcdef0123456789abcdef' }, { fetchImpl: v3.fetchImpl, baseUrl: base }).search('дэдлок');
  expect(v3.calls[0].url.searchParams.get('api_key')).toBe('0123456789abcdef0123456789abcdef');
  expect(v3.calls[0].url.searchParams.get('language')).toBe('ru-RU');
  expect(v3.calls[0].url.pathname).toBe('/3/search/tv');
  const v4 = fake(() => json({ page: 1, results: [], total_results: 0 }));
  await createTmdb({ apiKey: 'eyJhbGciOiJIUzI1NiJ9.token' }, { fetchImpl: v4.fetchImpl, baseUrl: base }).search('x');
  expect(v4.calls[0].headers.get('authorization')).toBe('Bearer eyJhbGciOiJIUzI1NiJ9.token');
  expect(v4.calls[0].url.searchParams.has('api_key')).toBe(false);
});

test('ошибки: 401, 404, сеть', async () => {
  const mk = (h: () => Response | Promise<Response>) => createTmdb({ apiKey: 'k' }, { fetchImpl: fake(h).fetchImpl, baseUrl: base });
  await expect(mk(() => json({}, { status: 401 })).details(1)).rejects.toMatchObject({ code: 'auth', message: 'Неверный ключ TMDB' });
  await expect(mk(() => json({}, { status: 404 })).details(1)).rejects.toMatchObject({ code: 'not_found' });
  await expect(mk(() => { throw new TypeError('fetch failed'); }).details(1)).rejects.toMatchObject({ code: 'network' });
  await expect(mk(() => json({}, { status: 500 })).details(1)).rejects.toBeInstanceOf(TmdbError);
});

test('429: одна пауза по Retry-After (не больше 5 с) и повтор', async () => {
  let n = 0;
  const slept: number[] = [];
  const f = fake(() => (++n === 1 ? json({}, { status: 429, headers: { 'retry-after': '30' } }) : json({ page: 1, results: [{ id: 1 }], total_results: 1 })));
  const tmdb = createTmdb({ apiKey: 'k' }, { fetchImpl: f.fetchImpl, baseUrl: base, sleep: async (ms) => { slept.push(ms); } });
  expect(await tmdb.trending()).toHaveLength(1);
  expect(slept).toEqual([5000]);
  const always = fake(() => json({}, { status: 429, headers: { 'retry-after': '1' } }));
  const t2 = createTmdb({ apiKey: 'k' }, { fetchImpl: always.fetchImpl, baseUrl: base, sleep: async () => {} });
  await expect(t2.details(1)).rejects.toMatchObject({ code: 'rate' });
  expect(always.calls).toHaveLength(2);
});

test('пустое описание дополняется из en-US', async () => {
  const f = fake((u) =>
    json(u.searchParams.get('language') === 'ru-RU'
      ? { id: 1, name: 'Дэдлок', overview: '', seasons: [] }
      : { id: 1, name: 'Deadloch', overview: 'English overview', seasons: [] }),
  );
  const d = await createTmdb({ apiKey: 'k' }, { fetchImpl: f.fetchImpl, baseUrl: base }).details(1);
  expect(d.name).toBe('Дэдлок');
  expect(d.overview).toBe('English overview');
  expect(f.calls[0].url.searchParams.get('append_to_response')).toBe('alternative_titles,external_ids');
});

test('поиск и тренды кэшируются на час', async () => {
  let t = 0;
  const f = fake(() => json({ page: 1, results: [{ id: 5 }], total_results: 1 }));
  const tmdb = createTmdb({ apiKey: 'k' }, { fetchImpl: f.fetchImpl, baseUrl: base, now: () => t });
  await tmdb.search('A');
  await tmdb.search('a ');
  expect(f.calls).toHaveLength(1);
  t = 3_600_001;
  await tmdb.search('a');
  expect(f.calls).toHaveLength(2);
});
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**

```ts
// src/lib/tmdb/client.ts
import type { TmdbPage, TmdbSeason, TmdbTvDetails, TmdbTvListItem } from './types';

export type TmdbConfig = { apiKey: string; proxy?: string };
export type TmdbErrorCode = 'auth' | 'rate' | 'network' | 'not_found' | 'http';
export class TmdbError extends Error {
  constructor(message: string, readonly code: TmdbErrorCode) {
    super(message);
  }
}
export type TmdbOptions = { fetchImpl?: typeof fetch; baseUrl?: string; sleep?: (ms: number) => Promise<void>; now?: () => number };
export type Tmdb = {
  configuration(): Promise<void>;
  details(id: number): Promise<TmdbTvDetails>;
  season(id: number, n: number): Promise<TmdbSeason>;
  search(query: string): Promise<TmdbTvListItem[]>;
  trending(): Promise<TmdbTvListItem[]>;
};

const LIST_TTL = 3_600_000;
const listCache = new Map<string, { at: number; items: TmdbTvListItem[] }>();
export const clearTmdbCache = () => listCache.clear();

const isV3Key = (k: string) => /^[0-9a-f]{32}$/i.test(k);
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createTmdb(cfg: TmdbConfig, opts: TmdbOptions = {}): Tmdb {
  const baseUrl = (opts.baseUrl ?? process.env.TMDB_BASE_URL ?? 'https://api.themoviedb.org/3').replace(/\/+$/, '');
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;

  async function get<T>(path: string, params: Record<string, string> = {}, language = 'ru-RU'): Promise<T> {
    const url = new URL(baseUrl + path);
    for (const [k, v] of Object.entries({ ...params, language })) url.searchParams.set(k, v);
    const headers: Record<string, string> = { accept: 'application/json' };
    if (isV3Key(cfg.apiKey)) url.searchParams.set('api_key', cfg.apiKey);
    else headers.authorization = `Bearer ${cfg.apiKey}`;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await doFetch(url, { headers, signal: AbortSignal.timeout(10_000) });
      } catch (e) {
        throw new TmdbError(`TMDB не отвечает: ${reason(e)}`, 'network');
      }
      if (res.ok) return (await res.json()) as T;
      if (res.status === 429 && attempt === 0) {
        const retry = Number(res.headers.get('retry-after')) || 1;
        await sleep(Math.min(retry * 1000, 5000));
        continue;
      }
      if (res.status === 401) throw new TmdbError('Неверный ключ TMDB', 'auth');
      if (res.status === 404) throw new TmdbError('Не найдено в TMDB', 'not_found');
      if (res.status === 429) throw new TmdbError('TMDB ограничил запросы, попробуйте позже', 'rate');
      throw new TmdbError(`TMDB ответил ошибкой ${res.status}`, 'http');
    }
  }

  async function list(key: string, path: string, params: Record<string, string>) {
    const hit = listCache.get(key);
    if (hit && now() - hit.at < LIST_TTL) return hit.items;
    const page = await get<TmdbPage<TmdbTvListItem>>(path, params);
    listCache.set(key, { at: now(), items: page.results });
    return page.results;
  }

  return {
    async configuration() {
      await get('/configuration', {}, 'en-US');
    },
    async details(id) {
      const d = await get<TmdbTvDetails>(`/tv/${id}`, { append_to_response: 'alternative_titles,external_ids' });
      if (!d.overview || !d.name) {
        const en = await get<TmdbTvDetails>(`/tv/${id}`, {}, 'en-US');
        d.overview ||= en.overview;
        d.name ||= en.name;
      }
      return d;
    },
    season: (id, n) => get<TmdbSeason>(`/tv/${id}/season/${n}`),
    search: (q) => {
      const query = q.trim().toLowerCase();
      return list(`search:${query}`, '/search/tv', { query, include_adult: 'false' });
    },
    trending: () => list('trending', '/trending/tv/week', {}),
  };
}
```

Прокси подключается в `src/lib/tmdb/index.ts` (Task 3) через `fetchImpl`, клиент о нём не знает.

- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(tmdb): клиент TMDB`.

---

### Task 3: Маппинг, настройки TMDB, фикстуры

**Files:**
- Create: `src/lib/tmdb/map.ts`, `src/lib/tmdb/index.ts`, `tests/fixtures/tmdb/tv-1399.json`, `tests/fixtures/tmdb/tv-1399-season-1.json`, `tests/fixtures/tmdb/tv-1429.json`, `tests/fixtures/tmdb/trending.json`
- Test: `tests/unit/tmdb-map.test.ts`, `tests/unit/tmdb-config.test.ts`

**Interfaces:**
- Produces:
  - `map.ts`:
    ```ts
    export const ANIMATION_GENRE = 16;
    export function isAnime(genreIds: number[], countries: string[]): boolean;
    export function mapStatus(s: string): Title['status'];  // Returning Series→returning, Ended→ended, Canceled→canceled, In Production→in_production, Planned|Pilot→planned, иное→returning
    export type TitleFields = Omit<typeof titles.$inferInsert, 'id' | 'createdAt' | 'refreshedAt' | 'kindManual'>;
    export function mapDetails(d: TmdbTvDetails): TitleFields;
    export function mapSeasons(d: TmdbTvDetails): { number: number; name: string; airDate: string | null; episodeCount: number; posterPath: string | null }[];
    export function mapEpisodes(s: TmdbSeason): { season: number; number: number; name: string; airDate: string | null; runtime: number | null }[];
    ```
    `altNames`: уникальные (без учёта регистра и крайних пробелов) названия из `alternative_titles.results` стран `RU, US, GB, JP`, кроме совпадающих с `name` и `original_name`; порядок — как в ответе.
    `year` — `Number(first_air_date.slice(0,4))` или `null`; `nextAirDate` — `next_episode_to_air?.air_date ?? null`; `genres` — имена; `networks` — имена; `kind` — `isAnime(genres.map(id), origin_country) ? 'anime' : 'series'`.
    Пустые `air_date` (`''`) → `null`.
  - `index.ts`:
    ```ts
    export type TmdbSettings = { apiKey: string; proxy?: string };
    export function getTmdbSettings(db: Db): TmdbSettings | undefined;   // tryGetSecretSetting(db, 'tmdb')
    export function saveTmdbSettings(db: Db, s: TmdbSettings): void;      // setSecretSetting; пустой proxy не сохраняется
    export function tmdbFor(s: TmdbSettings): Tmdb;                       // createTmdb с fetch через ProxyAgent, если proxy
    export function getTmdb(db: Db): Tmdb | null;                          // null без ключа
    export function proxiedFetch(proxy?: string): typeof fetch;           // для картинок (Task 6)
    ```

Фикстуры — реальная форма ответа TMDB (поля из `TmdbTvDetails`/`TmdbSeason`), содержимое сокращено:
- `tv-1399.json` — «Игра престолов», `genres: [{id:10765,"name":"Sci-Fi & Fantasy"},{id:18,"name":"Драма"}]`, `origin_country:["US"]`, `status:"Ended"`,
  2 сезона (`season_number` 0 «Спецвыпуски» и 1 «Сезон 1», 10 серий), `alternative_titles.results` с RU «Игра тронов», US «GoT», FR «Le Trône de fer» (должен быть отброшен), `next_episode_to_air: null`, `overview: "…"`.
- `tv-1399-season-1.json` — 3 серии (1 «Зима близко» 2011-04-17, 2 «Королевский тракт» 2011-04-24, 3 «Лорд Сноу» `air_date: ""`).
- `tv-1429.json` — «Атака титанов», `name:"Атака титанов"`, `original_name:"進撃の巨人"`, `genres:[{id:16,"name":"мультфильм"}]`, `origin_country:["JP"]`, `status:"Ended"`,
  `alternative_titles.results`: JP «Shingeki no Kyojin» (type "Romaji"), US «Attack on Titan», RU «Атака титанов» (дубль `name` — отбросить).
- `trending.json` — `{page:1,results:[…3 элемента TmdbTvListItem, включая 1429 и 1399…],total_results:3}`.

- [ ] **Step 1: Failing tests**

```ts
// tests/unit/tmdb-map.test.ts
import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { isAnime, mapDetails, mapEpisodes, mapSeasons, mapStatus } from '@/lib/tmdb/map';
import type { TmdbSeason, TmdbTvDetails } from '@/lib/tmdb/types';

const fx = <T>(n: string) => JSON.parse(readFileSync(`tests/fixtures/tmdb/${n}.json`, 'utf8')) as T;

test('аниме: Анимация + Япония', () => {
  expect(isAnime([16], ['JP'])).toBe(true);
  expect(isAnime([16], ['US'])).toBe(false);
  expect(isAnime([18], ['JP'])).toBe(false);
});

test('статусы TMDB', () => {
  expect(['Returning Series', 'Ended', 'Canceled', 'In Production', 'Planned', 'Pilot', 'странное'].map(mapStatus))
    .toEqual(['returning', 'ended', 'canceled', 'in_production', 'planned', 'planned', 'returning']);
});

test('Игра престолов: поля и альтернативные названия', () => {
  const t = mapDetails(fx<TmdbTvDetails>('tv-1399'));
  expect(t).toMatchObject({ tmdbId: 1399, kind: 'series', nameRu: 'Игра престолов', nameOriginal: 'Game of Thrones', year: 2011, status: 'ended', nextAirDate: null });
  expect(t.altNames).toEqual(['Игра тронов', 'GoT']);
  expect(t.genres).toEqual(['Sci-Fi & Fantasy', 'Драма']);
});

test('Атака титанов: аниме, романдзи, без дубля русского названия', () => {
  const t = mapDetails(fx<TmdbTvDetails>('tv-1429'));
  expect(t.kind).toBe('anime');
  expect(t.altNames).toEqual(['Shingeki no Kyojin', 'Attack on Titan']);
});

test('сезоны и серии; пустая дата эфира → null', () => {
  expect(mapSeasons(fx<TmdbTvDetails>('tv-1399')).map((s) => s.number)).toEqual([0, 1]);
  const eps = mapEpisodes(fx<TmdbSeason>('tv-1399-season-1'));
  expect(eps[0]).toEqual({ season: 1, number: 1, name: 'Зима близко', airDate: '2011-04-17', runtime: 62 });
  expect(eps[2].airDate).toBeNull();
});
```

(Порядок `altNames` в тесте должен совпасть с порядком в фикстуре: RU «Игра тронов», затем US «GoT»; для 1429 — JP «Shingeki no Kyojin», затем US «Attack on Titan».)

```ts
// tests/unit/tmdb-config.test.ts
import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { getTmdb, getTmdbSettings, saveTmdbSettings } from '@/lib/tmdb';
import { appSettings } from '@/lib/db/schema';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');

test('ключ TMDB хранится зашифрованным; без ключа клиента нет', () => {
  const db = testDb();
  expect(getTmdb(db)).toBeNull();
  saveTmdbSettings(db, { apiKey: 'SECRET-TMDB-KEY', proxy: '' });
  expect(getTmdbSettings(db)).toEqual({ apiKey: 'SECRET-TMDB-KEY' });
  expect(db.select().from(appSettings).get()!.value).not.toContain('SECRET');
  expect(getTmdb(db)).not.toBeNull();
});
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** `map.ts`:

```ts
import type { Title, titles } from '../db/schema';
import type { TmdbSeason, TmdbTvDetails } from './types';

export const ANIMATION_GENRE = 16;
const ALT_COUNTRIES = new Set(['RU', 'US', 'GB', 'JP']);

export const isAnime = (genreIds: number[], countries: string[]) => genreIds.includes(ANIMATION_GENRE) && countries.includes('JP');

const STATUS: Record<string, Title['status']> = {
  'Returning Series': 'returning', Ended: 'ended', Canceled: 'canceled', 'In Production': 'in_production', Planned: 'planned', Pilot: 'planned',
};
export const mapStatus = (s: string): Title['status'] => STATUS[s] ?? 'returning';

const date = (s: string | null | undefined) => (s ? s : null);

export type TitleFields = Omit<typeof titles.$inferInsert, 'id' | 'createdAt' | 'refreshedAt' | 'kindManual'>;

export function mapDetails(d: TmdbTvDetails): TitleFields {
  const norm = (s: string) => s.trim().toLowerCase();
  const seen = new Set([norm(d.name), norm(d.original_name)]);
  const altNames: string[] = [];
  for (const a of d.alternative_titles?.results ?? []) {
    if (!ALT_COUNTRIES.has(a.iso_3166_1) || !a.title.trim() || seen.has(norm(a.title))) continue;
    seen.add(norm(a.title));
    altNames.push(a.title.trim());
  }
  return {
    tmdbId: d.id,
    kind: isAnime(d.genres.map((g) => g.id), d.origin_country) ? 'anime' : 'series',
    nameRu: d.name,
    nameOriginal: d.original_name,
    originalLanguage: d.original_language,
    altNames,
    year: d.first_air_date ? Number(d.first_air_date.slice(0, 4)) : null,
    status: mapStatus(d.status),
    overview: d.overview ?? '',
    genres: d.genres.map((g) => g.name),
    originCountries: d.origin_country,
    networks: d.networks.map((n) => n.name),
    posterPath: d.poster_path,
    backdropPath: d.backdrop_path,
    nextAirDate: date(d.next_episode_to_air?.air_date),
    lastAirDate: date(d.last_air_date),
  };
}

export const mapSeasons = (d: TmdbTvDetails) =>
  d.seasons.map((s) => ({ number: s.season_number, name: s.name, airDate: date(s.air_date), episodeCount: s.episode_count, posterPath: s.poster_path }));

export const mapEpisodes = (s: TmdbSeason) =>
  s.episodes.map((e) => ({ season: s.season_number, number: e.episode_number, name: e.name, airDate: date(e.air_date), runtime: e.runtime ?? null }));
```

`index.ts`:

```ts
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import type { Db } from '../db/client';
import { setSecretSetting, tryGetSecretSetting } from '../settings';
import { createTmdb, type Tmdb } from './client';

export type TmdbSettings = { apiKey: string; proxy?: string };

export const getTmdbSettings = (db: Db) => tryGetSecretSetting<TmdbSettings>(db, 'tmdb');

export function saveTmdbSettings(db: Db, s: TmdbSettings) {
  setSecretSetting(db, 'tmdb', s.proxy?.trim() ? { apiKey: s.apiKey.trim(), proxy: s.proxy.trim() } : { apiKey: s.apiKey.trim() });
}

const agents = new Map<string, ProxyAgent>();
export function proxiedFetch(proxy?: string): typeof fetch {
  if (!proxy) return fetch;
  let agent = agents.get(proxy);
  if (!agent) agents.set(proxy, (agent = new ProxyAgent(proxy)));
  const a = agent;
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    undiciFetch(String(input instanceof Request ? input.url : input), { ...(init as object), dispatcher: a })) as unknown as typeof fetch;
}

export const tmdbFor = (s: TmdbSettings): Tmdb => createTmdb(s, { fetchImpl: proxiedFetch(s.proxy) });

export function getTmdb(db: Db): Tmdb | null {
  const s = getTmdbSettings(db);
  return s ? tmdbFor(s) : null;
}
```

(`pnpm add undici`.)

- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(tmdb): маппинг ответов, настройки, фикстуры`.

---

### Task 4: Каталог — синхронизация сериала

**Files:**
- Create: `src/lib/catalog.ts`
- Test: `tests/unit/catalog.test.ts`, `tests/unit/fake-tmdb.ts`

**Interfaces:**
- Consumes: `Tmdb` (Task 2), `mapDetails/mapSeasons/mapEpisodes` (Task 3), таблицы (Task 1).
- Produces:
  ```ts
  export const STALE_MS = 12 * 3_600_000;
  export async function syncTitle(db: Db, tmdb: Tmdb, tmdbId: number, opts?: { allSeasons?: boolean; now?: number }): Promise<Title>;
  export function getTitleByTmdbId(db: Db, tmdbId: number): Title | undefined;
  export function listSeasons(db: Db, titleId: number): Season[];            // по number
  export function listEpisodes(db: Db, titleId: number, season: number): Episode[]; // по number
  export function setKind(db: Db, titleId: number, kind: Title['kind']): void;     // kindManual = true
  export type OpenResult = { title: Title; stale: false } | { title: Title; stale: true; error: string };
  export async function openTitle(db: Db, tmdb: Tmdb | null, tmdbId: number, now?: number): Promise<OpenResult>;
    // нет в базе: tmdb обязателен, syncTitle(allSeasons) — ошибки пробрасываются (TmdbError);
    // есть и refreshedAt старше STALE_MS: пробует syncTitle, при ошибке — { stale: true, error };
    // есть и свежий: без запросов.
  export function titlesDueForRefresh(db: Db, now: number): Title[];  // status не ended/canceled, или refreshedAt старше 30 дней
  export function upcomingTitles(db: Db, today: string, days?: number): Title[]; // returning, nextAirDate в [today, today+days], сортировка по дате
  ```
  Правило сезонов в `syncTitle`: новый сериал или `allSeasons` — все сезоны; иначе — сезоны, у которых `episode_count` изменился относительно базы или которых нет в базе, плюс последний сезон с `number > 0`.
  Для каждого загружаемого сезона: upsert серий + удаление серий этого сезона, которых нет в ответе. Сезоны, пропавшие из `details.seasons`, удаляются вместе с сериями.
  Всё, кроме сетевых запросов, — одной транзакцией (сначала все запросы, потом запись).

`tests/unit/fake-tmdb.ts`:
```ts
import type { Tmdb } from '@/lib/tmdb/client';
import type { TmdbSeason, TmdbTvDetails } from '@/lib/tmdb/types';
export function fakeTmdb(data: { details: Record<number, TmdbTvDetails>; seasons: Record<string, TmdbSeason> }) {
  const calls: string[] = [];
  const tmdb: Tmdb = {
    configuration: async () => {},
    details: async (id) => { calls.push(`details:${id}`); const d = data.details[id]; if (!d) throw new Error('404'); return structuredClone(d); },
    season: async (id, n) => { calls.push(`season:${id}:${n}`); return structuredClone(data.seasons[`${id}:${n}`] ?? { season_number: n, episodes: [] }); },
    search: async () => [],
    trending: async () => [],
  };
  return { tmdb, calls };
}
```

- [ ] **Step 1: Failing tests**

```ts
// tests/unit/catalog.test.ts
import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { testDb } from './helpers';
import { fakeTmdb } from './fake-tmdb';
import { syncTitle, openTitle, setKind, listEpisodes, listSeasons, titlesDueForRefresh, upcomingTitles, STALE_MS, getTitleByTmdbId } from '@/lib/catalog';
import { TmdbError, type Tmdb } from '@/lib/tmdb/client';
import type { TmdbSeason, TmdbTvDetails } from '@/lib/tmdb/types';

const fx = <T>(n: string) => JSON.parse(readFileSync(`tests/fixtures/tmdb/${n}.json`, 'utf8')) as T;
const got = () => fakeTmdb({ details: { 1399: fx<TmdbTvDetails>('tv-1399') }, seasons: { '1399:1': fx<TmdbSeason>('tv-1399-season-1') } });
const T0 = 1_800_000_000_000;

test('первая синхронизация: сериал, все сезоны, серии', async () => {
  const db = testDb();
  const { tmdb, calls } = got();
  const t = await syncTitle(db, tmdb, 1399, { now: T0 });
  expect(t.refreshedAt).toBe(T0);
  expect(calls).toEqual(['details:1399', 'season:1399:0', 'season:1399:1']);
  expect(listSeasons(db, t.id).map((s) => s.number)).toEqual([0, 1]);
  expect(listEpisodes(db, t.id, 1).map((e) => e.name)).toEqual(['Зима близко', 'Королевский тракт', 'Лорд Сноу']);
});

test('повторная синхронизация: только изменившиеся и последний сезон; удалённые серии исчезают', async () => {
  const db = testDb();
  const data = { details: { 1399: fx<TmdbTvDetails>('tv-1399') }, seasons: { '1399:1': fx<TmdbSeason>('tv-1399-season-1') } };
  await syncTitle(db, fakeTmdb(data).tmdb, 1399, { now: T0 });
  data.seasons['1399:1'].episodes = data.seasons['1399:1'].episodes.slice(0, 2);
  const again = fakeTmdb(data);
  const t = await syncTitle(db, again.tmdb, 1399, { now: T0 + 1 });
  expect(again.calls).toEqual(['details:1399', 'season:1399:1']);
  expect(listEpisodes(db, t.id, 1)).toHaveLength(2);
});

test('ручной тип переживает обновление', async () => {
  const db = testDb();
  const { tmdb } = got();
  const t = await syncTitle(db, tmdb, 1399, { now: T0 });
  setKind(db, t.id, 'anime');
  const after = await syncTitle(db, tmdb, 1399, { now: T0 + 1 });
  expect(after).toMatchObject({ kind: 'anime', kindManual: true });
});

test('openTitle: свежий — без запросов; устаревший при недоступном TMDB — из базы с пометкой', async () => {
  const db = testDb();
  const { tmdb, calls } = got();
  await openTitle(db, tmdb, 1399, T0);
  const n = calls.length;
  expect((await openTitle(db, tmdb, 1399, T0 + 1000)).stale).toBe(false);
  expect(calls.length).toBe(n);
  const broken: Tmdb = { ...tmdb, details: async () => { throw new TmdbError('TMDB не отвечает: timeout', 'network'); } };
  const r = await openTitle(db, broken, 1399, T0 + STALE_MS + 1);
  expect(r).toMatchObject({ stale: true, error: 'TMDB не отвечает: timeout' });
  expect(r.title.nameRu).toBe('Игра престолов');
  await expect(openTitle(db, broken, 1429, T0)).rejects.toBeInstanceOf(TmdbError);
  await expect(openTitle(db, null, 1429, T0)).rejects.toThrow('Добавьте ключ TMDB');
});

test('кого обновлять и что скоро выходит', async () => {
  const db = testDb();
  const d = fx<TmdbTvDetails>('tv-1399');
  const running = { ...d, id: 7, status: 'Returning Series', next_episode_to_air: { air_date: '2026-10-20' } };
  const { tmdb } = fakeTmdb({ details: { 1399: d, 7: running }, seasons: {} });
  await syncTitle(db, tmdb, 1399, { now: T0 });
  await syncTitle(db, tmdb, 7, { now: T0 });
  expect(titlesDueForRefresh(db, T0 + 1).map((t) => t.tmdbId)).toEqual([7]);
  expect(titlesDueForRefresh(db, T0 + 31 * 86_400_000).map((t) => t.tmdbId).sort()).toEqual([1399, 7]);
  expect(upcomingTitles(db, '2026-09-30').map((t) => t.tmdbId)).toEqual([7]);
  expect(upcomingTitles(db, '2026-09-30', 10)).toEqual([]);
  expect(getTitleByTmdbId(db, 7)?.status).toBe('returning');
});
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**

```ts
// src/lib/catalog.ts
import { and, asc, between, eq, lt, notInArray, or } from 'drizzle-orm';
import type { Db } from './db/client';
import { episodes, seasons, titles, type Episode, type Season, type Title } from './db/schema';
import type { Tmdb } from './tmdb/client';
import { mapDetails, mapEpisodes, mapSeasons } from './tmdb/map';
import type { TmdbSeason } from './tmdb/types';

export const STALE_MS = 12 * 3_600_000;
const MONTH = 30 * 86_400_000;

export const getTitleByTmdbId = (db: Db, tmdbId: number) => db.select().from(titles).where(eq(titles.tmdbId, tmdbId)).get();
export const listSeasons = (db: Db, titleId: number): Season[] =>
  db.select().from(seasons).where(eq(seasons.titleId, titleId)).orderBy(asc(seasons.number)).all();
export const listEpisodes = (db: Db, titleId: number, season: number): Episode[] =>
  db.select().from(episodes).where(and(eq(episodes.titleId, titleId), eq(episodes.season, season))).orderBy(asc(episodes.number)).all();

export function setKind(db: Db, titleId: number, kind: Title['kind']) {
  db.update(titles).set({ kind, kindManual: true }).where(eq(titles.id, titleId)).run();
}

export async function syncTitle(db: Db, tmdb: Tmdb, tmdbId: number, opts: { allSeasons?: boolean; now?: number } = {}): Promise<Title> {
  const now = opts.now ?? Date.now();
  const d = await tmdb.details(tmdbId);
  const fields = mapDetails(d);
  const newSeasons = mapSeasons(d);
  const existing = getTitleByTmdbId(db, tmdbId);
  const stored = existing ? new Map(listSeasons(db, existing.id).map((s) => [s.number, s.episodeCount])) : new Map<number, number>();
  const last = Math.max(0, ...newSeasons.map((s) => s.number));
  const toFetch = newSeasons
    .filter((s) => !existing || opts.allSeasons || stored.get(s.number) !== s.episodeCount || (s.number === last && last > 0))
    .map((s) => s.number);
  const fetched: TmdbSeason[] = [];
  for (const n of toFetch) fetched.push(await tmdb.season(tmdbId, n));

  return db.transaction((tx) => {
    const kind = existing?.kindManual ? existing.kind : fields.kind;
    const row = existing
      ? tx.update(titles).set({ ...fields, kind, refreshedAt: now }).where(eq(titles.id, existing.id)).returning().get()
      : tx.insert(titles).values({ ...fields, kind, refreshedAt: now, createdAt: now }).returning().get();
    const numbers = newSeasons.map((s) => s.number);
    tx.delete(seasons).where(and(eq(seasons.titleId, row.id), notInArray(seasons.number, numbers))).run();
    tx.delete(episodes).where(and(eq(episodes.titleId, row.id), notInArray(episodes.season, numbers))).run();
    for (const s of newSeasons) {
      tx.insert(seasons).values({ titleId: row.id, ...s })
        .onConflictDoUpdate({ target: [seasons.titleId, seasons.number], set: s }).run();
    }
    for (const s of fetched) {
      const eps = mapEpisodes(s);
      tx.delete(episodes)
        .where(and(eq(episodes.titleId, row.id), eq(episodes.season, s.season_number), notInArray(episodes.number, eps.map((e) => e.number))))
        .run();
      for (const e of eps) {
        tx.insert(episodes).values({ titleId: row.id, ...e })
          .onConflictDoUpdate({ target: [episodes.titleId, episodes.season, episodes.number], set: e }).run();
      }
    }
    return row;
  });
}

export type OpenResult = { title: Title; stale: false } | { title: Title; stale: true; error: string };

export async function openTitle(db: Db, tmdb: Tmdb | null, tmdbId: number, now = Date.now()): Promise<OpenResult> {
  const existing = getTitleByTmdbId(db, tmdbId);
  if (!existing) {
    if (!tmdb) throw new Error('Добавьте ключ TMDB в настройках');
    return { title: await syncTitle(db, tmdb, tmdbId, { allSeasons: true, now }), stale: false };
  }
  if (now - existing.refreshedAt < STALE_MS || !tmdb) return { title: existing, stale: false };
  try {
    return { title: await syncTitle(db, tmdb, tmdbId, { now }), stale: false };
  } catch (e) {
    return { title: existing, stale: true, error: e instanceof Error ? e.message : String(e) };
  }
}

export const titlesDueForRefresh = (db: Db, now: number) =>
  db.select().from(titles)
    .where(or(notInArray(titles.status, ['ended', 'canceled']), lt(titles.refreshedAt, now - MONTH)))
    .orderBy(asc(titles.refreshedAt)).all();

export function upcomingTitles(db: Db, today: string, days = 60): Title[] {
  const end = new Date(Date.parse(today) + days * 86_400_000).toISOString().slice(0, 10);
  return db.select().from(titles)
    .where(and(eq(titles.status, 'returning'), between(titles.nextAirDate, today, end)))
    .orderBy(asc(titles.nextAirDate)).all();
}
```

(Если `notInArray` с пустым массивом ведёт себя не как «удалить все» — для сериала без сезонов удалять сезоны/серии безусловной веткой.)

- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(catalog): синхронизация сериала из TMDB`.

---

### Task 5: Ежедневное обновление в воркере

**Files:**
- Create: `src/worker/schedule.ts`, `src/worker/handlers.ts`
- Modify: `src/worker/main.ts`
- Test: `tests/unit/schedule.test.ts`, `tests/unit/refresh-handler.test.ts`

**Interfaces:**
- Produces:
  - `scheduleDaily(db: Db, type: string, now?: number): boolean` — ставит задачу, если с прошлой постановки (`app_settings['schedule.<type>']`) прошло ≥ 24 ч и нет задачи этого типа в `queued/running`; возвращает, поставлена ли.
  - `refreshAll(db: Db, tmdb: Tmdb | null, now?: number): Promise<{ ok: number; failed: number }>` — по `titlesDueForRefresh`, по одному, ошибка сериала логируется (`log.warn({ tmdbId, err })`) и не останавливает остальных; без клиента — `{0,0}`.
  - `buildHandlers(db: Db): Record<string, Handler>` — `{ 'tmdb.refresh-all': () => refreshAll(db, getTmdb(db)).then(() => undefined) }`.

- [ ] **Step 1: Failing tests**

```ts
// tests/unit/schedule.test.ts
import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { scheduleDaily } from '@/worker/schedule';
import { jobs } from '@/lib/db/schema';

test('раз в сутки и без дублей в очереди', () => {
  const db = testDb();
  const t = 1_800_000_000_000;
  expect(scheduleDaily(db, 'tmdb.refresh-all', t)).toBe(true);
  expect(scheduleDaily(db, 'tmdb.refresh-all', t + 1000)).toBe(false);
  db.update(jobs).set({ status: 'done' }).run();
  expect(scheduleDaily(db, 'tmdb.refresh-all', t + 23 * 3_600_000)).toBe(false);
  expect(scheduleDaily(db, 'tmdb.refresh-all', t + 24 * 3_600_000)).toBe(true);
  expect(db.select().from(jobs).all()).toHaveLength(2);
});
```

```ts
// tests/unit/refresh-handler.test.ts
import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { testDb } from './helpers';
import { fakeTmdb } from './fake-tmdb';
import { syncTitle, getTitleByTmdbId } from '@/lib/catalog';
import { refreshAll } from '@/worker/handlers';
import type { TmdbTvDetails } from '@/lib/tmdb/types';

const fx = <T>(n: string) => JSON.parse(readFileSync(`tests/fixtures/tmdb/${n}.json`, 'utf8')) as T;

test('ошибка одного сериала не останавливает остальных', async () => {
  const db = testDb();
  const base = fx<TmdbTvDetails>('tv-1399');
  const a = { ...base, id: 1, status: 'Returning Series' };
  const b = { ...base, id: 2, status: 'Returning Series' };
  const { tmdb } = fakeTmdb({ details: { 1: a, 2: b }, seasons: {} });
  await syncTitle(db, tmdb, 1, { now: 1 });
  await syncTitle(db, tmdb, 2, { now: 1 });
  const flaky = fakeTmdb({ details: { 2: { ...b, name: 'Обновлён' } }, seasons: {} }); // id 1 → ошибка
  expect(await refreshAll(db, flaky.tmdb, 10)).toEqual({ ok: 1, failed: 1 });
  expect(getTitleByTmdbId(db, 2)?.nameRu).toBe('Обновлён');
  expect(await refreshAll(db, null, 10)).toEqual({ ok: 0, failed: 0 });
});
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**

```ts
// src/worker/schedule.ts
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../lib/db/client';
import { jobs } from '../lib/db/schema';
import { getSetting, setSetting } from '../lib/settings';
import { enqueue } from './jobs';

const DAY = 86_400_000;

export function scheduleDaily(db: Db, type: string, now = Date.now()): boolean {
  const last = getSetting<number>(db, `schedule.${type}`);
  if (last !== undefined && now - last < DAY) return false;
  const pending = db.select().from(jobs).where(and(eq(jobs.type, type), inArray(jobs.status, ['queued', 'running']))).get();
  if (pending) return false;
  enqueue(db, type, {}, now);
  setSetting(db, `schedule.${type}`, now);
  return true;
}
```

```ts
// src/worker/handlers.ts
import type { Db } from '../lib/db/client';
import type { Tmdb } from '../lib/tmdb/client';
import { getTmdb } from '../lib/tmdb';
import { syncTitle, titlesDueForRefresh } from '../lib/catalog';
import { log } from '../lib/log';
import type { Handler } from './jobs';

export async function refreshAll(db: Db, tmdb: Tmdb | null, now = Date.now()) {
  const res = { ok: 0, failed: 0 };
  if (!tmdb) return res;
  for (const t of titlesDueForRefresh(db, now)) {
    try {
      await syncTitle(db, tmdb, t.tmdbId, { now });
      res.ok++;
    } catch (e) {
      res.failed++;
      log.warn({ tmdbId: t.tmdbId, err: e instanceof Error ? e.message : String(e) }, 'tmdb refresh failed');
    }
  }
  return res;
}

export const buildHandlers = (db: Db): Record<string, Handler> => ({
  'tmdb.refresh-all': async () => {
    const r = await refreshAll(db, getTmdb(db));
    log.info(r, 'tmdb refresh done');
  },
});
```

`src/worker/main.ts`: заменить `const handlers = {}` на `const handlers = buildHandlers(db);` (после `getDb()`), в цикле перед `runOnce` — `scheduleDaily(db, 'tmdb.refresh-all');`.

- [ ] **Step 4: Run** — PASS; `pnpm build` — бандл воркера собирается (undici в бандле или external — добавить `'undici'` в `external` esbuild, он в dependencies).
- [ ] **Step 5: Commit** `feat(worker): ежедневное обновление каталога`.

---

### Task 6: Картинки — кэш и маршрут; компонент постера

**Files:**
- Create: `src/lib/images.ts`, `src/app/api/image/[size]/[file]/route.ts`, `src/components/catalog/Poster.tsx`
- Test: `tests/unit/images.test.ts`

**Interfaces:**
- Produces:
  - `images.ts`:
    ```ts
    export const IMAGE_SIZES = ['w185', 'w342', 'w780', 'w1280'] as const;
    export type ImageSize = (typeof IMAGE_SIZES)[number];
    export function isValidImageRequest(size: string, file: string): size is ImageSize; // file: /^[A-Za-z0-9_-]{1,64}\.(jpg|png)$/
    export async function loadImage(size: string, file: string, o: { cacheDir: string; baseUrl?: string; fetchImpl?: typeof fetch }):
      Promise<{ status: 200; body: Buffer; contentType: string } | { status: 400 | 404 }>;
    export const imageUrl = (size: ImageSize, path: string | null) => (path ? `/api/image/${size}${path}` : null); // path TMDB начинается с '/'
    export const POSTER_COLORS: string[]; // 18 цветов из design/screens/Login.dc.html (ghost)
    export const posterColor = (tmdbId: number) => POSTER_COLORS[tmdbId % POSTER_COLORS.length];
    ```
  - Маршрут: `GET /api/image/[size]/[file]` → без сеанса 401; `loadImage(size, file, { cacheDir: path.join(getConfig().dataDir, 'cache/images'), baseUrl: process.env.TMDB_IMAGE_BASE_URL, fetchImpl: proxiedFetch(getTmdbSettings(db)?.proxy) })`; 200 → `Cache-Control: public, max-age=31536000, immutable`.
  - `<Poster tmdbId name path size className rounded />` — клиентский: `<img>` с `imageUrl`; при `onError` или `path === null` — `div` цвета `posterColor(tmdbId)` с названием внизу (13 px, `text-text-2`, 2 строки). Соотношение 2:3 задаёт родитель.

- [ ] **Step 1: Failing test**

```ts
// tests/unit/images.test.ts
import { expect, test } from 'vitest';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isValidImageRequest, loadImage, imageUrl, posterColor } from '@/lib/images';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

test('валидация запроса', () => {
  expect(isValidImageRequest('w342', 'abc_DEF-1.jpg')).toBe(true);
  for (const [s, f] of [['w999', 'a.jpg'], ['w342', '../secret.key'], ['w342', '..%2Fx.jpg'], ['w342', ''], ['w342', 'a.gif'], ['w342', 'a/b.jpg']]) {
    expect(isValidImageRequest(s, f)).toBe(false);
  }
});

test('первый раз качает и кладёт в кэш, второй — с диска; ошибка — 404; мусор — 400', async () => {
  const cacheDir = mkdtempSync(path.join(tmpdir(), 'dy-img-'));
  let calls = 0;
  const ok = (async (u: RequestInfo | URL) => {
    calls++;
    expect(String(u)).toBe('http://img.test/t/p/w342/abc.png');
    return new Response(PNG, { headers: { 'content-type': 'image/png' } });
  }) as typeof fetch;
  const o = { cacheDir, baseUrl: 'http://img.test/t/p', fetchImpl: ok };
  const r1 = await loadImage('w342', 'abc.png', o);
  expect(r1).toMatchObject({ status: 200, contentType: 'image/png' });
  const r2 = await loadImage('w342', 'abc.png', { ...o, fetchImpl: (async () => { throw new Error('сеть не нужна'); }) as typeof fetch });
  expect(r2.status).toBe(200);
  expect(calls).toBe(1);
  expect(readdirSync(path.join(cacheDir, 'w342'))).toEqual(['abc.png']);
  const fail = (async () => new Response('', { status: 404 })) as typeof fetch;
  expect((await loadImage('w342', 'nope.jpg', { ...o, fetchImpl: fail })).status).toBe(404);
  expect((await loadImage('w342', '../x.jpg', o)).status).toBe(400);
});

test('url и цвет заглушки', () => {
  expect(imageUrl('w342', '/abc.jpg')).toBe('/api/image/w342/abc.jpg');
  expect(imageUrl('w342', null)).toBeNull();
  expect(posterColor(1399)).toBe(posterColor(1399 + 18));
});
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**

```ts
// src/lib/images.ts
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

export const IMAGE_SIZES = ['w185', 'w342', 'w780', 'w1280'] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];
const FILE = /^[A-Za-z0-9_-]{1,64}\.(jpg|png)$/;

export const isValidImageRequest = (size: string, file: string): size is ImageSize =>
  (IMAGE_SIZES as readonly string[]).includes(size) && FILE.test(file);

const typeOf = (file: string) => (file.endsWith('.png') ? 'image/png' : 'image/jpeg');

export async function loadImage(
  size: string,
  file: string,
  o: { cacheDir: string; baseUrl?: string; fetchImpl?: typeof fetch },
): Promise<{ status: 200; body: Buffer; contentType: string } | { status: 400 | 404 }> {
  if (!isValidImageRequest(size, file)) return { status: 400 };
  const dir = path.join(o.cacheDir, size);
  const target = path.join(dir, file);
  try {
    return { status: 200, body: await readFile(target), contentType: typeOf(file) };
  } catch {
    /* нет в кэше */
  }
  const base = (o.baseUrl ?? 'https://image.tmdb.org/t/p').replace(/\/+$/, '');
  try {
    const res = await (o.fetchImpl ?? fetch)(`${base}/${size}/${file}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { status: 404 };
    const body = Buffer.from(await res.arrayBuffer());
    await mkdir(dir, { recursive: true });
    const tmp = `${target}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, body);
    await rename(tmp, target);
    return { status: 200, body, contentType: typeOf(file) };
  } catch {
    return { status: 404 };
  }
}

export const imageUrl = (size: ImageSize, p: string | null) => (p ? `/api/image/${size}${p}` : null);

export const POSTER_COLORS = [
  '#22394A', '#2B3D2A', '#2A3656', '#3E3322', '#3A2B2A', '#2A3346', '#4A3122', '#4A2A22', '#4A2E40',
  '#233042', '#3A3A36', '#2C3548', '#2F3B2E', '#24454D', '#3B3526', '#4A4222', '#3A2626', '#2E2A26',
];
export const posterColor = (tmdbId: number) => POSTER_COLORS[tmdbId % POSTER_COLORS.length];
```

Маршрут:

```ts
// src/app/api/image/[size]/[file]/route.ts
import path from 'node:path';
import { getCurrentSession } from '@/lib/auth/current';
import { getConfig } from '@/lib/config';
import { getDb } from '@/lib/db/client';
import { loadImage } from '@/lib/images';
import { getTmdbSettings, proxiedFetch } from '@/lib/tmdb';

export async function GET(_req: Request, { params }: { params: Promise<{ size: string; file: string }> }) {
  if (!(await getCurrentSession())) return new Response(null, { status: 401 });
  const { size, file } = await params;
  const r = await loadImage(size, file, {
    cacheDir: path.join(getConfig().dataDir, 'cache', 'images'),
    baseUrl: process.env.TMDB_IMAGE_BASE_URL,
    fetchImpl: proxiedFetch(getTmdbSettings(getDb())?.proxy),
  });
  if (r.status !== 200) return new Response(null, { status: r.status });
  return new Response(new Uint8Array(r.body), { headers: { 'content-type': r.contentType, 'cache-control': 'public, max-age=31536000, immutable' } });
}
```

`AuthFrame.tsx` — заменить локальный массив `GHOST` на `POSTER_COLORS` из `@/lib/images`.

`Poster.tsx`:
```tsx
'use client';
import { useState } from 'react';
import { imageUrl, posterColor, type ImageSize } from '@/lib/images';

export function Poster({ tmdbId, name, path, size = 'w342', className = '' }: { tmdbId: number; name: string; path: string | null; size?: ImageSize; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = imageUrl(size, path);
  if (!src || failed)
    return (
      <div className={`flex items-end p-3 ${className}`} style={{ background: posterColor(tmdbId) }}>
        <span className="line-clamp-2 text-[13px] font-medium text-text-2">{name}</span>
      </div>
    );
  // eslint-disable-next-line @next/next/no-img-element -- картинки идут через свой прокси с кэшем
  return <img src={src} alt={name} loading="lazy" onError={() => setFailed(true)} className={`object-cover ${className}`} />;
}
```

- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(catalog): прокси и кэш картинок, постер`.

---

### Task 7: TMDB в мастере и в настройках

**Files:**
- Modify: `src/lib/setup.ts`, `tests/unit/setup.test.ts`, `src/app/setup/Steps.tsx`, `src/app/setup/actions.ts`, `src/app/setup/page.tsx` (редирект после аккаунта), `src/app/(app)/layout.tsx` (без изменений логики), `tests/e2e/auth.spec.ts`
- Create: `src/app/setup/tmdb/page.tsx`, `src/app/setup/tmdb/TmdbForm.tsx`, `src/app/(app)/settings/sources/page.tsx`, `src/app/(app)/settings/sources/TmdbCard.tsx`, `src/app/(app)/settings/sources/actions.ts`

**Interfaces:**
- Consumes: `getTmdbSettings`, `saveTmdbSettings`, `tmdbFor` (Task 3).
- Produces:
  - `SETUP_ORDER = ['account', 'tmdb', 'qbittorrent', 'sources', 'folders']`; `markStep(db, 'tmdb' | 'qbittorrent' | 'sources' | 'folders', …)`.
  - `checkTmdb(s: TmdbSettings): Promise<{ ok: true } | { ok: false; error: string }>` в `src/lib/tmdb/index.ts` (`tmdbFor(s).configuration()`, ошибка → `TmdbError.message`).
  - Server action `tmdbSetupAction(prev, form)` (intent `save|check|skip`, как у qBittorrent; пустой ключ при сохранённом — берётся сохранённый) → после сохранения `redirect('/setup/qbittorrent')`.
  - Server action `saveTmdbAction(prev, form)` для настроек (intent `save|check`), возвращает `{ ok: 'Сохранено · TMDB отвечает' } | { error }`.

- [ ] **Step 1: Обновить тест мастера (failing)** — в `tests/unit/setup.test.ts` в тесте «порядок шагов мастера»:

```ts
  await createUser(db, 'admin', 'пароль-длинный');
  expect(getSetupState(db).step).toBe('tmdb');
  markStep(db, 'tmdb', 'skipped');
  expect(getSetupState(db).step).toBe('qbittorrent');
```
и итоговый `completed: ['account', 'tmdb', 'qbittorrent', 'sources', 'folders']`. Добавить тест:

```ts
// tests/unit/tmdb-config.test.ts
test('проверка ключа TMDB', async () => {
  const { checkTmdb } = await import('@/lib/tmdb');
  process.env.TMDB_BASE_URL = 'http://127.0.0.1:9/3'; // закрытый порт
  const r = await checkTmdb({ apiKey: 'k' });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toMatch(/^TMDB не отвечает/);
  delete process.env.TMDB_BASE_URL;
});
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** `setup.ts` (цикл по `['tmdb','qbittorrent','sources','folders']`), `checkTmdb`, шаг `Steps.tsx` (добавить `{ id: 'tmdb', label: 'TMDB' }` вторым), `createAccountAction` → `redirect('/setup/tmdb')`.
  Страница `/setup/tmdb` — по образцу `/setup/qbittorrent`: заголовок «TMDB», текст «Отсюда Dublyarr берёт названия, сезоны, даты выхода серий и постеры. Ключ — в настройках аккаунта на themoviedb.org (API Key или API Read Access Token).», поля «Ключ API» (`PasswordField`, моно-шрифт не нужен), «Прокси (необязательно)» (`Field mono`, placeholder `http://192.168.1.10:3128`, hint «Если TMDB не открывается с NAS»), кнопки «Сохранить и дальше», «Проверить», «Пропустить». Ошибка/успех — `StepResult`.
  `/settings/sources` — страница раздела (заменяет общий `[section]` для `sources`): `SectionHeader title="Источники"`, карточка `TmdbCard` (те же поля + «Сохранить», «Проверить», статус «Ключ сохранён»/«Ключ не задан»), под ней `Placeholder`-карточка «Torznab-источники — в следующем обновлении» (текст без заголовка страницы: `<Card>` с `text-muted`).
- [ ] **Step 4: e2e** — в `tests/e2e/auth.spec.ts` после «Создать аккаунт»: `await expect(page).toHaveURL(/\/setup\/tmdb$/); await page.getByRole('button', { name: 'Пропустить' }).click();` перед шагом qBittorrent.
- [ ] **Step 5: Run** `pnpm test && pnpm typecheck && pnpm lint && pnpm e2e` — PASS.
- [ ] **Step 6: Commit** `feat(setup): шаг TMDB в мастере и в настройках`.

---

### Task 8: Экран «Поиск и тренды»

**Files:**
- Create: `src/app/(app)/discover/page.tsx` (заменяет заглушку), `src/app/(app)/discover/SearchBox.tsx`, `src/components/catalog/PosterCard.tsx`, `src/lib/discover.ts`
- Test: `tests/unit/discover.test.ts`

**Interfaces:**
- Consumes: `getTmdb`, `isAnime`, `upcomingTitles`, `Poster`.
- Produces:
  - `discover.ts`:
    ```ts
    export type Card = { tmdbId: number; name: string; year: number | null; posterPath: string | null; anime: boolean };
    export const toCard = (i: TmdbTvListItem): Card;   // year из first_air_date
    export type DiscoverData =
      | { mode: 'no-key' }
      | { mode: 'search'; query: string; cards: Card[]; error?: string }
      | { mode: 'home'; trending: Card[]; upcoming: (Card & { nextAirDate: string })[]; error?: string };
    export async function loadDiscover(db: Db, tmdb: Tmdb | null, q: string | undefined, today: string): Promise<DiscoverData>;
      // q.trim().length >= 2 → search; иначе home (trending + upcomingTitles); ошибка TMDB → error, карточки пустые (upcoming из базы остаются)
    ```
  - `PosterCard`: `Link` на `/series/{tmdbId}`, постер 2:3 `rounded-[14px] overflow-hidden`, под ним название (15 px, 600, 2 строки), строка «2011 · Аниме» (13 px `text-muted`, «Аниме» — `text-accent`).
  - `SearchBox` (клиент): поле 50 px как `Field`, иконка лупы слева, `defaultValue` из `q`, debounce 400 мс → `router.replace('/discover?q=…')` (пустое → `/discover`), крестик очистки.

- [ ] **Step 1: Failing test**

```ts
// tests/unit/discover.test.ts
import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { testDb } from './helpers';
import { loadDiscover, toCard } from '@/lib/discover';
import { TmdbError, type Tmdb } from '@/lib/tmdb/client';
import type { TmdbTvListItem } from '@/lib/tmdb/types';

const trending = JSON.parse(readFileSync('tests/fixtures/tmdb/trending.json', 'utf8')).results as TmdbTvListItem[];
const tmdb = (over: Partial<Tmdb> = {}): Tmdb => ({
  configuration: async () => {}, details: async () => { throw new Error(); }, season: async () => { throw new Error(); },
  search: async (q) => trending.filter((t) => t.name.toLowerCase().includes(q.toLowerCase())), trending: async () => trending, ...over,
});

test('карточка: год и аниме', () => {
  const aot = trending.find((t) => t.id === 1429)!;
  expect(toCard(aot)).toMatchObject({ tmdbId: 1429, anime: true });
});

test('режимы: без ключа, главная, поиск, ошибка TMDB', async () => {
  const db = testDb();
  expect(await loadDiscover(db, null, 'x', '2026-09-30')).toEqual({ mode: 'no-key' });
  const home = await loadDiscover(db, tmdb(), undefined, '2026-09-30');
  expect(home.mode === 'home' && home.trending.length).toBe(trending.length);
  const short = await loadDiscover(db, tmdb(), 'а', '2026-09-30');
  expect(short.mode).toBe('home');
  const s = await loadDiscover(db, tmdb(), 'атака', '2026-09-30');
  expect(s).toMatchObject({ mode: 'search', query: 'атака' });
  expect(s.mode === 'search' && s.cards.map((c) => c.tmdbId)).toEqual([1429]);
  const broken = await loadDiscover(db, tmdb({ search: async () => { throw new TmdbError('Неверный ключ TMDB', 'auth'); } }), 'атака', '2026-09-30');
  expect(broken).toEqual({ mode: 'search', query: 'атака', cards: [], error: 'Неверный ключ TMDB' });
});
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** `discover.ts`, затем `PosterCard`, `SearchBox`, страницу:
  - `PageTitle` «Поиск и тренды»; под ним `SearchBox`.
  - `no-key`: `Card` «Добавьте ключ TMDB — без него поиск не работает.» + ссылка-кнопка «Открыть настройки» → `/settings/sources`.
  - `search`: строка «Найдено: N» (`text-muted`), сетка `grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6 lg:gap-5`; пусто — «Ничего не нашлось. Попробуйте оригинальное название.».
  - `home`: блок «Скоро новые сезоны» (если есть: карточки + дата «с 20 окт» под названием) и «Популярное за неделю».
  - `error` — `<p role="alert" className="text-danger">`.
  - `today` вычислять в функции вне тела компонента (`const today = () => new Date().toISOString().slice(0, 10)`).
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint` — PASS.
- [ ] **Step 5: Скриншоты** desktop 1440 и mobile 390 (главная, поиск, без ключа) против дизайн-токенов; показать владельцу.
- [ ] **Step 6: Commit** `feat(discover): поиск и тренды`.

---

### Task 9: Карточка сериала

**Files:**
- Create: `src/app/(app)/series/[tmdbId]/page.tsx`, `src/app/(app)/series/[tmdbId]/actions.ts`, `src/app/(app)/series/[tmdbId]/KindSwitch.tsx`, `src/lib/dates.ts`
- Modify: `src/components/shell/nav.ts` (`/series/*` → активный «Библиотека»), `tests/unit/nav.test.ts`
- Test: `tests/unit/dates.test.ts`

**Interfaces:**
- Consumes: `openTitle`, `listSeasons`, `listEpisodes`, `setKind`, `syncTitle`, `getTmdb`, `Poster`, `imageUrl`.
- Produces:
  - `dates.ts`: `formatAirDate(date: string | null, today: string): string` — `null` → «—»; прошлое и сегодня → «8 сент» (ru, короткий месяц без точки; другой год — «8 сент 2011»); сегодня → «сегодня»; завтра → «завтра»; в пределах 7 дней → «через N дн»; дальше → «8 сент».
    `pickDefaultSeason(seasons: { number: number; airDate: string | null }[], today: string): number` — последний сезон с `number > 0` и `airDate <= today`; нет — первый с `number > 0`; нет — 0.
  - Actions: `refreshTitleAction(form)` (tmdbId → `syncTitle(..., { allSeasons: true })`, `revalidatePath`), `setKindAction(form)` (tmdbId, kind).
  - `activeNavId('/series/1399') === 'library'`.

- [ ] **Step 1: Failing tests**

```ts
// tests/unit/dates.test.ts
import { expect, test } from 'vitest';
import { formatAirDate, pickDefaultSeason } from '@/lib/dates';

test('дата эфира', () => {
  const today = '2026-09-30';
  expect(formatAirDate(null, today)).toBe('—');
  expect(formatAirDate('2026-09-08', today)).toBe('8 сент');
  expect(formatAirDate('2011-04-17', today)).toBe('17 апр 2011');
  expect(formatAirDate('2026-09-30', today)).toBe('сегодня');
  expect(formatAirDate('2026-10-01', today)).toBe('завтра');
  expect(formatAirDate('2026-10-06', today)).toBe('через 6 дн');
  expect(formatAirDate('2026-10-20', today)).toBe('20 окт');
});

test('сезон по умолчанию', () => {
  const today = '2026-09-30';
  expect(pickDefaultSeason([{ number: 0, airDate: '2010-01-01' }, { number: 1, airDate: '2024-01-01' }, { number: 2, airDate: '2026-09-01' }, { number: 3, airDate: '2027-01-01' }], today)).toBe(2);
  expect(pickDefaultSeason([{ number: 1, airDate: null }], today)).toBe(1);
  expect(pickDefaultSeason([{ number: 0, airDate: null }], today)).toBe(0);
});
```

В `tests/unit/nav.test.ts` добавить `expect(activeNavId('/series/1399')).toBe('library');`.

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** `dates.ts`:

```ts
const MONTHS = ['янв', 'февр', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сент', 'окт', 'нояб', 'дек'];
const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / DAY);

export function formatAirDate(date: string | null, today: string): string {
  if (!date) return '—';
  const diff = days(date, today);
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  if (diff > 1 && diff <= 7) return `через ${diff} дн`;
  const [y, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}${y !== Number(today.slice(0, 4)) ? ` ${y}` : ''}`;
}

export function pickDefaultSeason(seasons: { number: number; airDate: string | null }[], today: string): number {
  const regular = seasons.filter((s) => s.number > 0).sort((a, b) => a.number - b.number);
  const aired = regular.filter((s) => s.airDate && s.airDate <= today);
  return aired.at(-1)?.number ?? regular[0]?.number ?? 0;
}
```

`nav.ts`: в `activeNavId` — `if (seg === 'series') return 'library';`.

Страница `/series/[tmdbId]?season=N` (серверный компонент):
- `tmdbId` не число → `notFound()`.
- `openTitle(getDb(), getTmdb(getDb()), id)` в `try`; ошибка для отсутствующего в базе → экран с `PageTitle` «Не удалось загрузить из TMDB», текст ошибки и кнопка «Повторить» (ссылка на ту же страницу); `TmdbError` `not_found` → `notFound()`.
- Hero по `Series.dc.html`: блок высотой 360 px (мобайл — 220) с фоном `imageUrl('w1280', backdropPath)` (`object-cover`, затемнение `linear-gradient(to top, #121110 10%, rgba(18,17,16,0.4))`), без фона — цвет `posterColor`.
  Ссылка «‹ Поиск и тренды» (`/discover`) слева сверху. Постер 180×270 (мобайл 110×165) `rounded-[14px]`, справа: строка `nameOriginal · year · genres.join(', ') · N сезонов · статус` (`text-muted` 14 px; статус: returning «выходит», ended «завершён», canceled «закрыт», in_production «в производстве», planned «анонсирован»), `h1` `font-display` 40 px (мобайл 26) — `nameRu`.
  Кнопки: `Button` primary disabled «Подписаться» + подпись `text-faint` 13 px «Подписки — в следующем обновлении»; форма `refreshTitleAction` — кнопка secondary «Обновить из TMDB»; `KindSwitch` — `Segmented` «Сериал / Аниме» (клиент, onChange → вызов `setKindAction`).
- `stale` → строка `text-accent` «TMDB не ответил, данные от <дата refreshedAt ru>».
- Описание: `overview` (15 px, `text-text-2`, max-w 760).
- Вкладки сезонов: ссылки `?season=N` (как кнопки `Сезон N · M серий`, активная — `bg-text text-bg`, неактивная — `border border-line text-text-2`, высота 44), спецвыпуски (0) последней вкладкой «Спецвыпуски»; мобайл — горизонтальная прокрутка.
- Таблица серий (`Table`): «№» (моно, 60 px), «Серия» (название), «Эфир» (`formatAirDate`, 140 px); строки будущих серий — `text-faint`. Пустой сезон — «Серии ещё не объявлены».
- `today` — функция вне тела компонента.

- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint` — PASS.
- [ ] **Step 5: Скриншоты** desktop/mobile против `Series.dc.html`/`MobileSeries.dc.html` (hero, вкладки, таблица).
- [ ] **Step 6: Commit** `feat(series): карточка сериала`.

---

### Task 10: E2E с заглушкой TMDB, документация

**Files:**
- Create: `tests/e2e/tmdb-stub.mjs`, `tests/e2e/catalog.spec.ts`
- Modify: `playwright.config.ts`, `tests/e2e/auth.spec.ts`, `CLAUDE.md`, `README.md`, `esbuild.mjs` (external `undici`, если не сделано)

**Interfaces:**
- `tmdb-stub.mjs`: `node:http` на `127.0.0.1:3199`; маршруты: `/3/configuration` → `{}` (401, если `api_key=bad`), `/3/trending/tv/week` → `trending.json`, `/3/search/tv` → элементы `trending.json`, у которых `name` содержит `query` (без регистра), `/3/tv/{id}` → `tv-{id}.json`, `/3/tv/{id}/season/{n}` → `tv-{id}-season-{n}.json` или `{ season_number:n, episodes:[] }`; `/t/p/{size}/{file}` → 1×1 PNG; иначе 404.

- [ ] **Step 1: Конфиг** — `playwright.config.ts`: `webServer` — массив: сначала `{ command: 'node tests/e2e/tmdb-stub.mjs', url: 'http://127.0.0.1:3199/3/configuration?api_key=ok' }`, затем приложение с env `TMDB_BASE_URL: 'http://127.0.0.1:3199/3'`, `TMDB_IMAGE_BASE_URL: 'http://127.0.0.1:3199/t/p'`.
  Оба e2e делят одну базу: `auth.spec.ts` создаёт пользователя; `catalog.spec.ts` запускается после (`test.describe.configure({ mode: 'serial' })` не нужен — разные файлы, `workers: 1`, `fullyParallel: false`; порядок файлов — алфавитный, поэтому **переименовать** `auth.spec.ts` → `01-auth.spec.ts`, новый — `02-catalog.spec.ts`).
  `02-catalog.spec.ts` работает в новом браузерном контексте, поэтому входит с кодом; секрет берёт из файла `E2E_DIR/totp-secret`, который записывает 01 сразу после включения 2FA (`fs.writeFileSync(path.join(process.env.E2E_DIR!, 'totp-secret'), secret)`).
- [ ] **Step 2: Сценарий 02**

```ts
// tests/e2e/02-catalog.spec.ts
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { totpAt, currentStep } from '../../src/lib/auth/totp';

test('ключ TMDB в настройках → тренды → поиск → карточка → смена типа', async ({ page }) => {
  const secret = readFileSync(path.join(process.env.E2E_DIR!, 'totp-secret'), 'utf8');
  await page.goto('/login');
  await page.getByLabel('Логин').fill('admin');
  await page.getByLabel('Пароль', { exact: true }).fill('очень-длинный-пароль');
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500); // новое окно: коды из 01 не повторяются
  await page.getByLabel('Код из приложения').fill(totpAt(secret, currentStep(Date.now())));
  await expect(page.getByRole('heading', { name: 'Сегодня' })).toBeVisible();

  await page.goto('/discover');
  await expect(page.getByText('Добавьте ключ TMDB')).toBeVisible();
  await page.goto('/settings/sources');
  await page.getByLabel('Ключ API').fill('ok');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('TMDB отвечает')).toBeVisible();

  await page.goto('/discover');
  await expect(page.getByRole('heading', { name: 'Популярное за неделю' })).toBeVisible();
  await page.getByPlaceholder('Название сериала').fill('атака');
  await expect(page).toHaveURL(/q=%D0%B0%D1%82%D0%B0%D0%BA%D0%B0|q=атака/);
  await page.getByRole('link', { name: /Атака титанов/ }).click();
  await expect(page.getByRole('heading', { name: 'Атака титанов', level: 1 })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Аниме' })).toBeChecked();

  await page.goto('/series/1399');
  await expect(page.getByText('Зима близко')).toBeVisible();
  await page.getByText('Аниме', { exact: true }).click();
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Аниме' })).toBeChecked();
});
```

(Код TOTP: сценарий 01 уже использовал текущие шаги, поэтому перед вводом кода ждём начала нового 30-секундного окна и вводим код текущего шага — см. `waitForTimeout` в тесте.)

- [ ] **Step 3: Run** `pnpm e2e` — оба PASS.
- [ ] **Step 4: Документация** — `CLAUDE.md` «Решения»: добавить раздел «Фаза 1a» (TMDB-клиент и прокси, кэш картинок `${DATA_DIR}/cache/images`, `TMDB_BASE_URL`/`TMDB_IMAGE_BASE_URL` для тестов, фильмы — фаза 3). `README.md` — шаг TMDB в мастере, прокси.
- [ ] **Step 5: Финальная проверка** `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`.
- [ ] **Step 6: Commit** `test(e2e): каталог с заглушкой TMDB; документация`.
