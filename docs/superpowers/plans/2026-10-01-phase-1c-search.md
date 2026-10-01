# Фаза 1c «Поиск и разбор»: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** найти раздачи подписки во всех Torznab-источниках, разобрать заголовки (сезоны/серии, качество, озвучки), оценить «тот ли сериал» и выбрать лучшую раздачу
с причинами отказа для остальных; экраны «Ручной поиск» и «Настройки → Источники».

**Architecture:** чистые модули без БД — `src/lib/parse/*` (заголовок → `ParsedRelease`), `src/lib/match.ts`, `src/lib/evaluate.ts`; ввод-вывод —
`src/lib/torznab.ts` (клиент), `src/lib/search.ts` (опрос источников, дедупликация, запись `releases`), `src/lib/trackers.ts`. UI — серверные страницы + server actions.

**Tech Stack:** как раньше + `fast-xml-parser`.

**Spec:** `docs/superpowers/specs/2026-10-01-phase-1c-search-design.md`; `docs/spec.md` §2–3; макеты `design/screens/Activity.dc.html` (ручной поиск), `Settings.dc.html` (раздел «Источники»).

## Global Constraints

- Русский интерфейс, токены, цели ≥ 44 px, всё как в 1a/1b.
- Ключи источников и ссылки на .torrent — только зашифрованными (`encrypt`); в логи — только `redactUrl`.
- Все server actions — `requireSession()` и проверка id.
- Варианты написания студий сравниваются **целыми токенами**, не подстрокой.
- Ожидание позиции профиля — от даты эфира серии (решение владельца).
- Laya нет: место под неё — `finalCheck` (возвращает «да»).

## Review Focus

1. **Заголовок без сезона/серий, обрезанный «…» или на несколько сезонов** (`S1-2E1-19`) — разбор не падает; для цели-серии такой релиз получает понятный вердикт. Тесты в Task 4 и Task 8.
2. **Студия с коротким вариантом в чужом слове** («LF» в «WOLF», «JAM» в «JAMES») — не распознаётся. Тест в Task 5.
3. **Один источник висит/падает** — поиск по остальным завершается в пределах таймаута, ошибка видна в статусе. Тест в Task 7.
4. **Одна раздача через два источника и одна раздача в двух качествах** — первая склеивается (основной источник), вторые остаются разными. Тест в Task 7.
5. **Ожидание открывается в день «эфир + N»** (граница включительно) и дата в вердикте «Рано: ждём … до …» — правильная. Тест в Task 8.

---

### Task 1: Ожидание — от даты эфира (правка 1b)

**Files:** Modify `src/lib/profile-core.ts`, `src/components/subscribe/ProfileEditor.tsx`, `src/app/(app)/series/[tmdbId]/SubscriptionPanel.tsx`; Test `tests/unit/profile.test.ts`, `tests/unit/dub-order.test.ts`

- `validateProfile`: ожидания не убывают сверху вниз → иначе «Ожидание не может быть меньше, чем у позиции выше».
- `toggleDub`: новой позиции перед «Любой» — ожидание не меньше, чем у предыдущей (`max(DEFAULT_WAIT, prev.waitDays)`).
- Подписи: редактор — «через N дн» (вместо «ждать»), блок подписки — «если нет — через N дн после эфира», `describeProfile` — «HDrezka Studio (через 2 дн)».

- [ ] **Step 1: Failing tests** — в `profile.test.ts`:
```ts
test('ожидания не убывают сверху вниз', () => {
  expect(validateProfile({ ...base, dubs: [{ kind: 'studio', studioId: 1, waitDays: 0 }, { kind: 'studio', studioId: 2, waitDays: 5 }, { kind: 'any', waitDays: 2 }] }, known))
    .toEqual({ ok: false, error: 'Ожидание не может быть меньше, чем у позиции выше' });
});
```
обновить ожидание `describeProfile` → `'LostFilm → HDrezka Studio (через 2 дн) → Студия удалена (через 3 дн) → Любая (через 5 дн)'`;
в `dub-order.test.ts`: `toggleDub([{lf,0},{hd,7},any(5)], studio3)` → `studio3.waitDays === 7` и у «Любой» ожидание поднимается до 7 (не меньше предыдущей).
- [ ] **Step 2–4:** RED → реализация → GREEN. **Step 5: Commit** `fix(subs): ожидание озвучки — от даты эфира`.

---

### Task 2: Таблицы `trackers`, `releases`, `release_rules`

**Files:** Modify `src/lib/db/schema.ts`; Create `drizzle/0003_*.sql`, `src/lib/parse/types.ts` (тип `ParsedRelease` из спецификации), `src/lib/match-types.ts` (`MatchResult = { score: number; level: 'match'|'doubt'|'reject'; reasons: string[]; rule?: 'match'|'reject' }`);
Test `tests/unit/search-schema.test.ts`

```ts
export const trackers = sqliteTable('trackers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceId: integer('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  indexerId: text('indexer_id').notNull(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['series', 'anime', 'both', 'unknown'] }).notNull().default('unknown'),
  role: text('role', { enum: ['primary', 'backup'] }).notNull(),
  lastOkAt: ts('last_ok_at'), lastError: text('last_error'), lastErrorAt: ts('last_error_at'),
}, (t) => [uniqueIndex('trackers_source_indexer').on(t.sourceId, t.indexerId)]);

export const releases = sqliteTable('releases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  titleId: integer('title_id').notNull().references(() => titles.id, { onDelete: 'cascade' }),
  sourceId: integer('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  trackerId: integer('tracker_id').references(() => trackers.id, { onDelete: 'set null' }),
  trackerName: text('tracker_name').notNull(),
  title: text('title').notNull(),
  attrs: json<Record<string, string | string[]>>('attrs').notNull().default({}),
  size: integer('size').notNull(),
  seeders: integer('seeders'), peers: integer('peers'),
  infohash: text('infohash'),
  downloadEnc: text('download_enc'), magnet: text('magnet'), detailsUrl: text('details_url'),
  publishedAt: ts('published_at'), firstSeenAt: ts('first_seen_at').notNull(), lastSeenAt: ts('last_seen_at').notNull(),
  parsed: json<ParsedRelease>('parsed').notNull(),
  match: json<MatchResult>('match').notNull(),
}, (t) => [
  uniqueIndex('releases_title_infohash').on(t.titleId, t.infohash),
  uniqueIndex('releases_title_tracker_name_size').on(t.titleId, t.trackerName, t.title, t.size),
]);

export const releaseRules = sqliteTable('release_rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  titleId: integer('title_id').notNull().references(() => titles.id, { onDelete: 'cascade' }),
  trackerName: text('tracker_name'),            // null — любой трекер
  pattern: text('pattern').notNull(),           // нормализованная основа заголовка
  verdict: text('verdict', { enum: ['match', 'reject'] }).notNull(),
  createdAt: ts('created_at').notNull(),
}, (t) => [uniqueIndex('release_rules_unique').on(t.titleId, t.trackerName, t.pattern)]);
```
(Уникальность по `infohash` с `NULL` в SQLite не мешает: NULL не равны.)

- [ ] **Step 1:** тест — вставка трекера, релиза; дубль `(title, infohash)` бросает; два релиза без infohash с разным размером — ок; удаление сериала удаляет релизы и правила.
- [ ] **Step 2–4:** RED → таблицы + `pnpm db:generate` → GREEN. **Step 5: Commit** `feat(search): таблицы трекеров, релизов и правил`.

---

### Task 3: Клиент Torznab

**Files:** Create `src/lib/torznab.ts`, `tests/fixtures/torznab/{search-jackett.xml,indexers-jackett.xml,error-100.xml}`; Test `tests/unit/torznab-client.test.ts`
(`pnpm add fast-xml-parser`). Существующий `src/lib/integrations/torznab.ts` (`checkTorznab`) переходит на этот клиент.

**Interfaces — Produces:**
```ts
export type TorznabItem = {
  title: string; guid: string; link: string | null; magnet: string | null; details: string | null;
  publishedAt: number | null; size: number; seeders: number | null; peers: number | null; infohash: string | null;
  indexerId: string | null; indexerName: string | null; categories: number[]; attrs: Record<string, string | string[]>;
};
export type TorznabIndexer = { id: string; name: string; categories: number[] };
export class TorznabError extends Error { constructor(message: string, readonly code: 'auth' | 'network' | 'timeout' | 'bad' | 'http') }
export function torznabUrl(base: string, params: Record<string, string>): string;  // учитывает существующий '?'
export async function torznabSearch(src: { url: string; apiKey: string; timeoutMs: number }, q: string, cats: number[], fetchImpl?: typeof fetch): Promise<TorznabItem[]>;
export async function torznabIndexers(src: …, fetchImpl?): Promise<TorznabIndexer[] | null>;   // null — источник не поддерживает t=indexers
export async function torznabCaps(src: …, fetchImpl?): Promise<{ categories: number }>;
```
Индексатор: `jackettindexer@id` + текст; иначе `torznab:attr name="indexer"` / `prowlarrindexer`. `size` — `size` или `enclosure@length`; `infohash` — нижний регистр.
Ошибки: `<error code="100">` → `TorznabError('Неверный API-ключ','auth')`; иной `<error>` → `('Источник ответил ошибкой: {description}','bad')`; не RSS → `('Ответ не похож на Torznab','bad')`; HTTP не 2xx → `('HTTP {код}','http')`; abort → `('Нет ответа за N с','timeout')`.

Фикстура `search-jackett.xml` — RSS из 4 `item` по формату Jackett (`jackettindexer id="rutracker">RuTracker.org`, `kinozal`, `lostfilm`, второй `rutracker` без infohash),
заголовки — строки корпуса «Игры престолов»-аналогов: `Game of Thrones / S1E1-10 of 10 [2011, BDRip 1080p] Dub + MVO (LostFilm, AlexFilm) + Original`,
`Game of Thrones - S1E1-10 - 2011  MVO (LostFilm), Sub WEBDL 1080p - RUSSIAN`, `Game of Thrones - S1E3 - Lord Snow - rus 1080p WEBDL (LostFilm)`, `Game of Thrones / S1E1-10 of 10 [2011, BDRip 720p] MVO (Кураж-Бамбей)`.

- [ ] **Step 1: Failing test** — разбор фикстуры (4 элемента, индексаторы, размеры, сиды, infohash, magnet), `torznabUrl` с `?`, `t=indexers` (3 индексатора с категориями), ошибка 100, таймаут (fetch, который ждёт abort).
- [ ] **Step 2–4:** RED → реализация на `XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })` → GREEN. `checkTorznab` → обёртка над `torznabCaps`, тесты `torznab.test.ts` остаются зелёными.
- [ ] **Step 5: Commit** `feat(search): клиент Torznab`.

---

### Task 4: Разбор заголовка — сезоны, серии, качество

**Files:** Create `src/lib/parse/episodes.ts`, `src/lib/parse/quality.ts`, `src/lib/parse/index.ts` (`parseRelease` без озвучек — их добавит Task 5), `src/lib/parse/normalize.ts` (`normalizeTitle`, `baseOf`, `tokens`);
Test `tests/unit/parse-episodes.test.ts`, `tests/unit/parse-corpus.test.ts`

**Interfaces — Produces:**
```ts
export const normalizeTitle = (s: string) => string;   // нижний регистр, ё→е, без пунктуации, схлопнутые пробелы
export function baseOf(title: string): string;         // нормализованная основа: до первых ' / ', ' - S', '(S', '[', '(' — для правил
export function parseEpisodes(title: string): Pick<ParsedRelease, 'seasons' | 'episodes' | 'totalInSeason' | 'absolute' | 'pack'>;
export function parseQuality(title: string, tags: string[]): Pick<ParsedRelease, 'resolution' | 'source' | 'hdr' | 'dv' | 'screener'>;
export function parseNames(title: string): { names: string[]; year: number | null };
```
Правила `parseEpisodes` (по порядку, первое сработавшее):
`S(\d+)-(\d+)E(\d+)-(\d+)` → сезоны диапазоном, серии диапазоном; `S(\d+)E(\d+)(?:-E?(\d+))?` (+ «of N»); `\(S(\d+)\)` или `(\d+)(?:nd|rd|th|st) Season` или «Сезон[:\s]+(\d+)» → сезон;
`\[E(\d+)(?:-(\d+))? of (\d+)\]` / `E(\d+)-E?(\d+)` / «Серии?[:\s]+(\d+)-(\d+)( из (\d+))?» → серии; `Полный S(\d+)` / ` - S(\d+) - ` → весь сезон; одиночные `E(\d+)` после сезона.
Серий нет, сезон есть → `episodes: null`, `pack: true`. Ни сезона, ни признака аниме-сквозной → `seasons: []`. `E01-E28` без сезона → `absolute: true`.
`pack = episodes === null ? seasons.length > 0 : episodes.to > episodes.from || seasons.length > 1`.

- [ ] **Step 1: Failing tests** — синтетика:
```ts
test.each([
  ['Show S02E05 1080p', { seasons: [2], episodes: { from: 5, to: 5 }, pack: false }],
  ['Severance / S2E1-10 of 10 [2025, WEB-DL 1080p]', { seasons: [2], episodes: { from: 1, to: 10 }, totalInSeason: 10, pack: true }],
  ['Severance - S1-2E1-19 - 2022-2025  MVO', { seasons: [1, 2], episodes: { from: 1, to: 19 }, pack: true }],
  ['Severance - S2 - rus 1080p WEBDL (LostFilm)', { seasons: [2], episodes: null, pack: true }],
  ['The Bear - S5E8 - The Original Beef - rus 720p WEBDL (LostFilm)', { seasons: [5], episodes: { from: 8, to: 8 }, pack: false }],
  ['Медведь (The Bear)S5E00-08 (HD 1080p WEBRip) Полный S5', { seasons: [5], episodes: { from: 0, to: 8 }, pack: true }],
  ['Sousou no Frieren  S02E01-E10 [RUS] [HDTV 1080p]', { seasons: [2], episodes: { from: 1, to: 10 } }],
  ['(S2) / Sousou no Frieren 2nd Season / Frieren [TV] [E10 of 12]', { seasons: [2], episodes: { from: 1, to: 10 }, totalInSeason: 12 }],
  ['Провожающая в последний путь Фрирен / E01-E28 Sousou no Frieren - AniLiberty.TOP', { seasons: [], episodes: { from: 1, to: 28 }, absolute: true }],
  ['Провожающая в последний путь Фрирен 2 / E01-E10 Sousou no Frieren 2nd Season', { seasons: [2], episodes: { from: 1, to: 10 }, absolute: false }],
  ['Криминальное прошлое / Сезон: 2 / Серии: 1-4 из 8 [WEB-DL 1080p]', { seasons: [2], episodes: { from: 1, to: 4 }, totalInSeason: 8 }],
  ['Rick and Morty / : 1-5 / E1-51 of 51 [2013-2021]', { seasons: [1, 2, 3, 4, 5] }],
  ['S1E1-146 of ??? [2009-2024, WEBRip 576p]', { seasons: [1], episodes: { from: 1, to: 146 } }],
  ['Просто название', { seasons: [], episodes: null, pack: false }],
])('%s', (t, exp) => expect(parseEpisodes(t)).toMatchObject(exp));
```
качество:
```ts
test.each([
  ['[2025, HDR10, HDR10+, Dolby Vision, WEB-DL 2160p]', { resolution: 2160, source: 'webdl', hdr: true, dv: true }],
  ['DUB, Sub 4K, HEVC, HDR, DV P8 WEBDL', { resolution: 2160, hdr: true, dv: true, source: 'webdl' }],
  ['Sub Blu-Ray Remux 1080p - RUSSIAN', { resolution: 1080, source: 'remux' }],
  ['[2022, BDRip 1080p]', { resolution: 1080, source: 'bdrip' }],
  ['(HD 720p WEBRip)', { resolution: 720, source: 'webrip' }],
  ['[HDTVRip 720p]', { resolution: 720, source: 'hdtv' }],
  ['Movie 2026 CAMRip', { screener: true, source: 'cam' }],
  ['Movie.2026.TS.1080p', { screener: true }],
])('%s', (t, exp) => expect(parseQuality(t, [])).toMatchObject(exp));
test('теги дополняют', () => expect(parseQuality('Show S01', ['1080p', 'WEB-DL', 'HDR'])).toMatchObject({ resolution: 1080, source: 'webdl', hdr: true }));
```
и `parse-corpus.test.ts` — по каждой строке `hub-corpus.tsv` (кроме комментариев) `parseRelease` не бросает и даёт ожидаемые `seasons` и `resolution` из таблицы-ожидания в тесте
(для строк с указанием качества и сезона; обрезанные «…» — только «не падает»).
- [ ] **Step 2–4:** RED → реализация → GREEN. **Step 5: Commit** `feat(parse): сезоны, серии, качество`.

---

### Task 5: Разбор озвучек

**Files:** Create `src/lib/parse/dubs.ts`; Modify `src/lib/parse/index.ts`, `src/lib/studio-seed.ts` (+ `trackers: ['anidub']` у AniDUB, `['rudub']` у RuDub; StudioBand — вариант «StudioBand»; AniLibria — вариант «AniLiberty.TOP»);
Test `tests/unit/parse-dubs.test.ts`

**Interfaces — Produces:**
```ts
export type StudioRef = { id: number; name: string; aliases: string[]; trackers: string[] };
export function studioMatcher(studios: StudioRef[]): (text: string) => StudioRef | null;  // целыми токенами по нормализованному имени/варианту
export function parseDubs(title: string, tags: string[], trackerName: string, find: ReturnType<typeof studioMatcher>, studios: StudioRef[]):
  { dubs: ParsedRelease['dubs']; original: boolean; subs: boolean };
export function parseRelease(title: string, attrs: Record<string, string | string[]>, trackerName: string, studios: StudioRef[]): ParsedRelease;
```
`studioMatcher`: строит индекс «последовательность нормализованных токенов → студия»; поиск — по текстовому фрагменту (позиция в скобках) **целиком** или по токенам заголовка скользящим окном (для пункта 4 спецификации). Нормализация токена — `normalizeStudio` по словам.

- [ ] **Step 1: Failing tests**
```ts
const studios = [ /* из STUDIO_SEED с id по порядку + trackers из Task 5 */ ];
test.each([
  ['Severance / S2E1-10 of 10 [2025, WEB-DL 1080p] Dub (Red Head Sound) + 6 x MVO (HDrezka Studio, LostFilm)', 'RuTracker.org',
    [{ kind: 'dub', name: 'Red Head Sound', by: 'title' }, { kind: 'mvo', name: 'HDrezka Studio', by: 'title' }, { kind: 'mvo', name: 'LostFilm', by: 'title' }]],
  ['Severance - S2E1-10 - 2025  DUB, 5 x MVO, MVO (LE-Production), Sub 4K', 'Kinozal',
    [{ kind: 'dub', name: null, by: 'none' }, { kind: 'mvo', name: null, by: 'none' }, { kind: 'mvo', name: 'LE-Production', by: 'title' }]],
  ['The Bear - S5E8 - Beef - rus 1080p WEBDL (LostFilm)', 'LostFilm.tv', [{ kind: 'mvo', name: 'LostFilm', by: 'tracker' }]],
  ['Фрирен 2 / E01-E10 Sousou no Frieren 2nd Season - AniLiberty.TOP [WEB-DL 1080p]', 'Anilibria', [{ kind: 'mvo', name: 'AniLibria', by: 'tracker' }]],
  ['Sousou no Frieren  S02E01-E10 [RUS] [HDTV 1080p]', 'AniDUB', [{ kind: 'mvo', name: 'AniDUB', by: 'tracker' }]],
  ['Sousou no Frieren - S1E1-28 - 2023-2024  DUB (StudioBand), MVO, Sub HEVC', 'Kinozal', [{ kind: 'dub', name: 'Studio Band', by: 'title' }, { kind: 'mvo', name: null, by: 'none' }]],
  ['Криминальное прошлое S02E03 [WEB-DL 1080p] MVO Paravozik', 'Kinozal', [{ kind: 'mvo', name: null, label: 'Paravozik', by: 'none' }]],
  ['Rick and Morty - S6E1-10 - 2022  MVO (NewComers) WEBRip 720p', 'Kinozal', [{ kind: 'mvo', name: null, label: 'NewComers', by: 'title' }]],
])('%s', (title, tracker, exp) => { /* сравнить kind, имя студии по id, by */ });

test('короткие варианты — только целым словом', () => {
  const find = studioMatcher(studios);
  expect(find('LF')?.name).toBe('LostFilm');
  expect(find('WOLF')).toBeNull();
  expect(find('JAMES')).toBeNull();
});
test('оригинал и субтитры', () => {
  expect(parseDubs('… VO + Original + Sub (Rus, Eng)', [], 'RuTracker.org', studioMatcher(studios), studios)).toMatchObject({ original: true, subs: true });
  expect(parseDubs('[RUS(ext), JAP+Sub]', [], 'RuTracker.org', studioMatcher(studios), studios)).toMatchObject({ subs: true });
});
test('теги Jackett дают тип, если в заголовке его нет', () => {
  expect(parseDubs('Show S01 WEB-DL', ['дубляж'], 'Kinozal', studioMatcher(studios), studios).dubs).toEqual([{ kind: 'dub', studioId: null, label: 'дубляж', by: 'tag' }]);
});
```
(В таблице «MVO Paravozik» — `label: 'Paravozik'`, студии нет → нераспознанная студия; «MVO (NewComers)» — перечень есть, студии в словаре нет → `studioId: null`, `label: 'NewComers'`, `by: 'title'`.)
- [ ] **Step 2–4:** RED → реализация → GREEN; `parse-corpus.test.ts` дополнить проверкой озвучек для 10 строк корпуса.
- [ ] **Step 5: Commit** `feat(parse): озвучки и студии`.

---

### Task 6: Сквозная нумерация, совпадение, правила

**Files:** Create `src/lib/match.ts`, `src/lib/release-rules.ts`; Test `tests/unit/match.test.ts`, `tests/unit/release-rules.test.ts`

**Interfaces — Produces:**
```ts
export function absoluteToSeason(n: number, seasonEpisodeCounts: { season: number; count: number }[]): { season: number; episode: number } | null;
export function dice(a: string, b: string): number;                       // биграммы нормализованных строк
export type TitleInfo = { names: string[]; year: number | null; seasons: { number: number; episodeCount: number; year: number | null }[]; kind: 'series' | 'anime' };
export function matchRelease(p: ParsedRelease, size: number, t: TitleInfo, rule?: 'match' | 'reject'): MatchResult;
export function resolveAbsolute(p: ParsedRelease, t: TitleInfo): ParsedRelease;  // absolute → сезоны/серии, если нужно
// release-rules.ts
export function addRule(db, titleId, trackerName: string | null, title: string, verdict: 'match' | 'reject'): void;  // pattern = baseOf(title)
export function ruleFor(db, titleId, trackerName: string, title: string): 'match' | 'reject' | undefined;
```
Причины в `MatchResult.reasons`: «Название не похоже», «Год не совпадает», «Такого сезона нет», «Серий больше, чем в сезоне», «Размер на серию неправдоподобен», «В чёрном списке», «Подтверждено вручную».

- [ ] **Step 1: Failing tests** — `absoluteToSeason(37, [{1,25},{2,12}])` → `{2,12}`; `(26, …)` → `{2,1}`; `(40, …)` → `null`;
  `matchRelease` для «Game of Thrones / S1E1-10 of 10 [2011, BDRip 1080p]» и сериала 1399 (названия: «Игра престолов», «Game of Thrones», «Игра тронов»; год 2011; сезон 1 из 10 серий) → `level: 'match'`, `score ≥ 0.8`;
  для «Game of Thrones: Conquest & Rebellion [2017]» → не `match`; для «Breaking Bear - S1E1-8 - 2026» против «Медведь (The Bear)» 2022 → `reject`; размер 300 ГБ на сезон из 10 серий 1080p → причина «Размер на серию неправдоподобен»;
  правило `reject` → `score: 0, level: 'reject', reasons: ['В чёрном списке']`; `match` → `score: 1`.
  `release-rules`: `addRule` дважды — без дубля; `ruleFor` с `trackerName = null` правилом срабатывает на любом трекере.
- [ ] **Step 2–4:** RED → реализация → GREEN. **Step 5: Commit** `feat(search): совпадение с сериалом и правила`.

---

### Task 7: Поиск по источникам

**Files:** Create `src/lib/trackers.ts`, `src/lib/search.ts`; Test `tests/unit/search.test.ts`, `tests/unit/trackers.test.ts`

**Interfaces — Produces:**
```ts
// trackers.ts
export function syncTrackers(db, sourceId: number, indexers: TorznabIndexer[]): void;   // upsert; роль primary, если такого indexerId нет у источника, добавленного раньше
export function setPrimary(db, trackerId: number): void;                                // этот — primary, остальные с тем же indexerId — backup
export function trackersTable(db): { indexerId: string; name: string; kind: string; primary: { sourceName: string; trackerId: number } | null; backups: { sourceName: string; trackerId: number }[]; status: 'ok' | 'error' | 'unknown'; error?: string }[];
// search.ts
export type SourceStatus = { sourceId: number; name: string; ok: boolean; found: number; ms: number; error?: string };
export type SearchOptions = { fetchImpl?: typeof fetch; now?: number };
export async function searchTitle(db, titleId: number, opts?: SearchOptions): Promise<{ releases: Release[]; sources: SourceStatus[] }>;
export function queriesFor(t: Title): string[];   // ≤ 4 уникальных названия; аниме — сначала латиница
```
Алгоритм `searchTitle` — по спецификации (§ «Поиск по сериалу»). Параллельность — `Promise.allSettled` по источникам, внутри источника — запросы последовательно-ограниченно (до 4 одновременно).
Трекер релиза: `indexerId` из ответа → строка `trackers` этого источника (создаётся «на лету» с ролью по правилу `syncTrackers`, если `t=indexers` не поддержан).
Отброс запасного: релиз от трекера с ролью `backup`, у которого основной источник ответил без ошибки, — отбрасывается.
Запись: upsert по `(titleId, infohash)`, иначе по `(titleId, trackerName, title, size)`; `firstSeenAt` не меняется при обновлении.

- [ ] **Step 1: Failing tests** (`fetchImpl` по URL отдаёт фикстуры):
  - два источника (A — Jackett, B — второй Jackett с тем же `rutracker`): одинаковая раздача от обоих → одна запись, `sourceId = A`; если A упал — запись от B;
  - одна раздача в 1080p и 720p — две записи;
  - источник C, который не отвечает (fetch ждёт abort) при `timeoutMs: 50` → `sources` содержит `{ ok: false, error: 'Нет ответа за 0,05 с' }`, поиск завершается;
  - повторный поиск не меняет `firstSeenAt` и обновляет `seeders`;
  - ссылка на .torrent в базе зашифрована (`downloadEnc` не содержит `apikey`);
  - `queriesFor`: аниме — латиница первой; дубли по нормализации убраны; не больше 4.
  - `trackers.test.ts`: `syncTrackers` для A и B → у B `rutracker` — backup; `setPrimary(B.rutracker)` меняет роли.
- [ ] **Step 2–4:** RED → реализация → GREEN. **Step 5: Commit** `feat(search): опрос источников, дедупликация, основной и запасной`.

---

### Task 8: Оценка раздач для подписки

**Files:** Create `src/lib/evaluate.ts`; Test `tests/unit/evaluate.test.ts`

**Interfaces — Produces:**
```ts
export type Target = { season: number; episode?: number };
export type Verdict = { releaseId: number; ok: boolean; best: boolean; reason: string; position: number | null; tone: 'best' | 'ok' | 'wait' | 'reject' | 'ask' };
export function evaluateReleases(releases: Release[], ctx: { profile: Profile; episodes: Episode[]; studioName: (id: number) => string | undefined; today: string }, target: Target): Verdict[];
export const finalCheck = (_r: Release) => true;   // место для Laya (фаза 4)
```
Порядок проверок и тексты — по спецификации. `tone`: лучший — `best`; прошёл, но не лучший — `ok` («Подходит · {N}-я по приоритету»); ожидание — `wait`; нужна помощь пользователя («Неизвестная студия», «Сомнительное совпадение») — `ask`; прочие отказы — `reject`.
Дата «до …» в «Рано: ждём LostFilm до 3 окт» — `air_date + waitDays` следующей открывающейся позиции, формат `formatAirDate`.

- [ ] **Step 1: Failing tests** — профиль LostFilm(0) → HDrezka(2) → Любая(5), серия S1E3 с эфиром `2026-09-28`, today `2026-09-30`:
  - LostFilm 1080p отдельная серия → `best`, «Лучший · 1-я по приоритету»;
  - HDrezka пак: открыта с `09-30` (эфир 28 + 2 дня, включительно) → `ok`; при today `09-29` → `wait` «Рано: ждём LostFilm до 30 сент»;
  - TVShows (не в профиле, «Любая» с 10-03) → `wait` «Рано: ждём LostFilm до 3 окт»; при today `10-03` → `ok`;
  - экранка → `reject` «Экранка»; 720p при цели 2160 и `allowLower` → прошёл с меньшим приоритетом; 480p → «Ниже 1080p»; размер больше лимита → «Больше 4 ГБ»; сиды 0 → «Нет сидов»;
  - релиз S2 → «Не та серия»; `match.level = 'doubt'` → `ask` «Сомнительное совпадение»; нераспознанная студия без «Любой» в профиле → `ask` «Неизвестная студия»;
  - из двух LostFilm (серия и пак) лучший — серия; из двух серий — с HDR при `preferHdr`; затем больше сидов.
- [ ] **Step 2–4:** RED → реализация → GREEN. **Step 5: Commit** `feat(search): оценка раздач для подписки`.

---

### Task 9: Настройки «Источники»

**Files:** Modify `src/app/(app)/settings/sources/page.tsx`; Create `src/app/(app)/settings/sources/{SourceCard.tsx,SourceEditor.tsx,TrackersTable.tsx,source-actions.ts}`, `src/lib/source-form.ts`; Modify `src/lib/sources.ts` (+`updateSource`, `getSourceWithKey`); Test `tests/unit/source-form.test.ts`, `tests/unit/sources.test.ts`

- `parseSourceForm(form)` → `{ name, url, apiKey?, timeoutMs }` или ошибка (адрес http(s), таймаут 3–60 с).
- Actions: `saveSourceAction` (проверка `torznabCaps` + `torznabIndexers` → `syncTrackers`; пустой ключ при правке — сохранённый), `deleteSourceAction`, `setPrimaryAction(trackerId)`, `refreshTrackersAction(sourceId)`.
- Страница: «Источники» + описание из макета, «+ Добавить источник»; сетка карточек источников по макету (точка: ok — progress, ошибка — danger); карточка TMDB (из 1a) — ниже источников;
  таблица трекеров (Трекер, Контент, Основной, Запасной, Статус; «Основной» — `select` из источников, где есть трекер); подпись из макета про основной/запасной.
- [ ] **Step 1:** тесты `parseSourceForm`, `updateSource` (ключ шифруется, пустой не затирает). **Step 2–4:** RED → GREEN → UI. **Step 5:** скриншоты против `Settings.dc.html`. **Step 6: Commit** `feat(settings): источники и трекеры`.

---

### Task 10: Ручной поиск

**Files:** Create `src/app/(app)/search/[tmdbId]/{page.tsx,actions.ts,ReleaseRow.tsx,AssignStudio.tsx}`, `src/lib/manual-search.ts`; Modify карточка сериала (кнопка «Ручной поиск» и лупа у серии), `src/components/shell/nav.ts` (`/search` → «Активность»);
Test `tests/unit/manual-search.test.ts`

- `runManualSearch(db, tmdbId, target, opts)` → `{ title, rows: { release, verdict, dubs: { label, studioName?, by }[] }[], sources }` — поиск, затем `evaluateReleases`; без подписки — профиль по умолчанию (подпись «Без подписки — оценка по профилю по умолчанию»); сортировка: лучший, `ok`, `wait`, `ask`, `reject`, внутри — по сидам.
- Actions: `assignStudioAction` (releaseId, label, studioId | `new`+имя) → вариант написания `label` добавляется студии (`updateStudio`) или создаётся студия; повторный разбор релизов сериала;
  `ruleAction` (releaseId, verdict) → `addRule`; повторная оценка.
- Страница — по спецификации (§ «Ручной поиск»); поиск запускается при открытии страницы (серверно), «Искать снова» — перезагрузка. Подсказка, если источников нет: «Добавьте источник в настройках».
- [ ] **Step 1:** тест `runManualSearch` на фикстурах (лучший первым, причины, без подписки). **Step 2–4:** RED → GREEN → UI. **Step 5:** скриншоты против `Activity.dc.html` (desktop) и телефон. **Step 6: Commit** `feat(search): ручной поиск`.

---

### Task 11: E2E с заглушкой Jackett, документация

**Files:** Create `tests/e2e/jackett-stub.mjs` (порт 3198: `t=caps`, `t=indexers`, `t=search` → `search-jackett.xml`, `/dl/*` → .torrent-заглушка), `tests/e2e/04-search.spec.ts`; Modify `playwright.config.ts`, `CLAUDE.md`

- [ ] **Step 1: Сценарий:** вход → «Настройки → Источники» → «+ Добавить источник» (адрес заглушки, ключ `ok`) → карточка «3 трекера» и таблица трекеров →
  `/series/1399` → «Подписаться» (профиль по умолчанию) → «Ручной поиск» → строка «Game of Thrones - S1E3 - Lord Snow …» помечена «Лучший», пак Кураж-Бамбей — «Не в профиле озвучки» или «Рано…» →
  у раздачи с нераспознанной студией «Назначить студию» → выбрать → вердикт меняется.
- [ ] **Step 2:** `pnpm e2e` — 4 сценария PASS. **Step 3:** `CLAUDE.md` — «Решения (фаза 1c)». **Step 4:** `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`. **Step 5: Commit** `test(e2e): ручной поиск; документация`.
