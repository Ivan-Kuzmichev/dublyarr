# Фаза 1b «Подписки и студии»: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** подписка на сериал с профилем озвучек/качества/объёма, профили по умолчанию, словарь студий, «Библиотека».

**Architecture:** доменная логика в `src/lib/studios.ts`, `src/lib/profile.ts`, `src/lib/subscriptions.ts` (чистые функции над `db`); профиль — JSON-колонка
подписки и JSON в `app_settings`. Один клиентский редактор профиля `ProfileEditor` используется окном подписки и настройками; он отдаёт профиль
server action'у скрытым полем `profile` (JSON), сервер валидирует `validateProfile`.

**Tech Stack:** как в 1a.

**Spec:** `docs/superpowers/specs/2026-10-01-phase-1b-subscriptions-design.md`; `docs/spec.md` §1; макеты `design/screens/Subscribe.dc.html`, `MobileSubscribe.dc.html`,
`Library.dc.html`, `MobileLibrary.dc.html`, `Series.dc.html` (блок «Подписка»), `Settings.dc.html` (раздел «Подписки и студии»).

## Global Constraints

- Тексты интерфейса — на русском; цвета — токены `globals.css`; цели нажатия ≥ 44 px; модалки/шторки — радиус 22–24 px.
- Все server actions начинаются с `requireSession()` и проверяют входные данные на сервере (id — целые > 0, профиль — `validateProfile`).
- Формы возвращают введённые значения (React 19 сбрасывает форму).
- `Date.now()` / `todayIso()` не вызывать в теле компонента — только в функциях вне рендера.
- Фильмов нет; удаление файлов — нет (фаза 3).

## Review Focus

1. **Профиль из поддельного запроса** (дубли студий, `waitDays: -5`, неизвестный `studioId`, лишние поля, не-JSON) — отказ с понятной ошибкой, в базу ничего не пишется. Тест в Task 3 (`validateProfile` с `knownStudioIds`) и Task 5 (action разбирает не-JSON).
2. **Удаление студии, которая стоит в подписке или профиле по умолчанию** — запрещено с числом подписок в сообщении. Тест в Task 2.
3. **Граница «сегодня» и дата подписки в `wantedEpisodes`** — серия, вышедшая сегодня, нужна; режим «только новые» включает серию, вышедшую в день подписки. Тест в Task 4.
4. **Вариант написания совпадает с именем другой студии** (например, «HDrezka» как вариант двух студий) — отказ «Уже есть у студии …». Тест в Task 2.
5. **Встроенный профиль ссылается на удалённую студию** — профиль строится без неё, а если в нём не осталось позиций — только «Любая». Тест в Task 3.

---

## Структура файлов

```
src/lib/db/schema.ts                 + studios, subscriptions
drizzle/0002_*.sql
src/lib/studios.ts                   нормализация, засев, CRUD, поиск по варианту, проверка использования
src/lib/studio-seed.ts               начальный набор
src/lib/profile.ts                   типы Profile, validateProfile, встроенные/сохранённые профили по умолчанию, describeProfile
src/lib/subscriptions.ts             subscribe/update/unsubscribe/get, wantedEpisodes, libraryItems
src/components/subscribe/ProfileEditor.tsx     клиентский редактор профиля
src/components/subscribe/SubscribeDialog.tsx   модалка/шторка
src/components/ui/Stepper.tsx                  регулятор −/число/+
src/components/ui/Modal.tsx                    модалка desktop / шторка mobile
src/app/(app)/series/[tmdbId]/{SubscriptionPanel.tsx,subscribe-actions.ts}
src/app/(app)/library/page.tsx
src/app/(app)/settings/studios/{page.tsx,actions.ts,StudioEditor.tsx,DefaultProfileCard.tsx}
tests/unit/{studios,profile,subscriptions,wanted}.test.ts
tests/e2e/03-subscriptions.spec.ts
```

---

### Task 1: Таблицы `studios` и `subscriptions`

**Files:** Modify `src/lib/db/schema.ts`; Create `drizzle/0002_*.sql`; Test `tests/unit/subscriptions-schema.test.ts`

**Interfaces — Produces:**
```ts
export const studios = sqliteTable('studios', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  aliases: json<string[]>('aliases').notNull().default([]),
  kind: text('kind', { enum: ['series', 'anime', 'both'] }).notNull(),
  trackers: json<string[]>('trackers').notNull().default([]),
  source: text('source', { enum: ['seed', 'manual', 'laya'] }).notNull(),
  confirmed: integer('confirmed', { mode: 'boolean' }).notNull().default(true),
  createdAt: ts('created_at').notNull(),
});
export const subscriptions = sqliteTable('subscriptions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  titleId: integer('title_id').notNull().unique().references(() => titles.id, { onDelete: 'cascade' }),
  profile: json<Profile>('profile').notNull(),   // тип из src/lib/profile.ts (import type)
  subscribedAt: ts('subscribed_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
});
export type Studio = typeof studios.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
```
(`import type { Profile } from '../profile'` в schema.ts — только тип, цикла на рантайме нет.)

- [ ] **Step 1: Failing test**
```ts
// tests/unit/subscriptions-schema.test.ts
import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { studios, subscriptions, titles } from '@/lib/db/schema';

test('подписка — одна на сериал, удаляется вместе с сериалом', () => {
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 1, kind: 'series', nameRu: 'A', nameOriginal: 'A', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  const s = db.insert(studios).values({ name: 'LostFilm', kind: 'series', source: 'seed', createdAt: 1 }).returning().get();
  expect(s.aliases).toEqual([]);
  const profile = { dubs: [{ kind: 'studio' as const, studioId: s.id, waitDays: 0 }], quality: { target: 1080 as const, allowLower: true, preferHdr: false, maxSizeGb: null },
    scope: { mode: 'new' as const }, wholeSeasonAfterFinale: false, replaceWithHigher: true, autoNextSeason: true };
  db.insert(subscriptions).values({ titleId: t.id, profile, subscribedAt: 1, updatedAt: 1 }).run();
  expect(db.select().from(subscriptions).get()!.profile).toEqual(profile);
  expect(() => db.insert(subscriptions).values({ titleId: t.id, profile, subscribedAt: 1, updatedAt: 1 }).run()).toThrow();
  db.delete(titles).run();
  expect(db.select().from(subscriptions).all()).toEqual([]);
});
```
- [ ] **Step 2: Run** — FAIL. **Step 3:** таблицы + `pnpm db:generate`. **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat(subs): таблицы studios и subscriptions`.

(Тип `Profile` появляется в Task 3; в Task 1 создать `src/lib/profile.ts` с одними типами `DubPosition`, `Quality`, `Scope`, `Profile` из спецификации.)

---

### Task 2: Словарь студий

**Files:** Create `src/lib/studio-seed.ts`, `src/lib/studios.ts`; Modify `src/lib/db/client.ts` (засев в `getDb`); Test `tests/unit/studios.test.ts`

**Interfaces — Produces:**
```ts
export const normalizeStudio = (s: string) => string; // lower, ё→е, без [\s.\-_]
export type StudioInput = { name: string; aliases: string[]; kind: Studio['kind']; trackers: string[] };
export function seedStudios(db: Db): void;                         // один раз, флаг app_settings['studios.seeded']
export function listStudios(db: Db, kind?: 'series' | 'anime'): Studio[]; // kind → этого типа + both; сортировка по name (ru)
export function findStudioByAlias(db: Db, text: string): Studio | undefined; // по нормализованному name/aliases
export function createStudio(db: Db, input: StudioInput, source?: Studio['source']): Studio;  // бросает StudioError
export function updateStudio(db: Db, id: number, input: StudioInput): Studio;
export function deleteStudio(db: Db, id: number): void;             // бросает StudioError, если используется
export function studioUsage(db: Db, id: number): { subscriptions: number; profiles: ('series' | 'anime')[] };
export class StudioError extends Error {}
```
Проверка ввода: имя 1…60 символов после trim; варианты — trim, пустые выкинуть, без дублей; трекеры — trim, нижний регистр, без пустых;
конфликт имени/варианта с другой студией — `StudioError('«HDrezka» уже есть у студии HDrezka Studio')`.
`studioUsage` читает все подписки (`profile.dubs`) и оба профиля по умолчанию **сохранённые** в настройках (встроенные на удаление не влияют — они строятся по имени).

`studio-seed.ts` — массив `StudioInput` из спецификации (32 записи, в том же порядке).

- [ ] **Step 1: Failing test**
```ts
// tests/unit/studios.test.ts
import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { seedStudios, listStudios, findStudioByAlias, createStudio, updateStudio, deleteStudio, normalizeStudio, StudioError } from '@/lib/studios';
import { STUDIO_SEED } from '@/lib/studio-seed';
import { subscriptions, titles } from '@/lib/db/schema';

test('нормализация', () => {
  expect(normalizeStudio(' Кураж-Бамбей ')).toBe('куражбамбей');
  expect(normalizeStudio('LostFilm.TV')).toBe('lostfilmtv');
  expect(normalizeStudio('Жёлтый_Кот')).toBe('желтыйкот');
});

test('засев один раз; удалённая студия не возвращается', () => {
  const db = testDb();
  seedStudios(db);
  expect(listStudios(db)).toHaveLength(STUDIO_SEED.length);
  const lf = findStudioByAlias(db, 'lostfilm.tv')!;
  deleteStudio(db, lf.id);
  seedStudios(db);
  expect(findStudioByAlias(db, 'LostFilm')).toBeUndefined();
});

test('поиск по варианту и фильтр по типу', () => {
  const db = testDb();
  seedStudios(db);
  expect(findStudioByAlias(db, 'HDREZKA')?.name).toBe('HDrezka Studio');
  expect(findStudioByAlias(db, 'Анилибрия')?.name).toBe('AniLibria');
  const anime = listStudios(db, 'anime').map((s) => s.name);
  expect(anime).toContain('AniDUB');
  expect(anime).toContain('Дубляж'); // both
  expect(anime).not.toContain('LostFilm');
});

test('конфликты имён и вариантов', () => {
  const db = testDb();
  seedStudios(db);
  expect(() => createStudio(db, { name: 'Новая', aliases: ['HDrezka'], kind: 'series', trackers: [] })).toThrow('«HDrezka» уже есть у студии HDrezka Studio');
  expect(() => createStudio(db, { name: ' lostfilm ', aliases: [], kind: 'series', trackers: [] })).toThrow(StudioError);
  expect(() => createStudio(db, { name: '  ', aliases: [], kind: 'series', trackers: [] })).toThrow('Введите название студии');
  const s = createStudio(db, { name: 'Paravozik', aliases: [' Паровозик ', '', 'Паровозик'], kind: 'series', trackers: [' NNM-Club '] });
  expect(s).toMatchObject({ aliases: ['Паровозик'], trackers: ['nnm-club'], source: 'manual' });
  expect(updateStudio(db, s.id, { name: 'Paravozik Studio', aliases: ['Paravozik'], kind: 'both', trackers: [] }).name).toBe('Paravozik Studio');
});

test('используемую студию удалить нельзя', () => {
  const db = testDb();
  seedStudios(db);
  const lf = findStudioByAlias(db, 'LostFilm')!;
  const t = db.insert(titles).values({ tmdbId: 1, kind: 'series', nameRu: 'A', nameOriginal: 'A', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  db.insert(subscriptions).values({ titleId: t.id, subscribedAt: 1, updatedAt: 1, profile: {
    dubs: [{ kind: 'studio', studioId: lf.id, waitDays: 0 }], quality: { target: 1080, allowLower: true, preferHdr: false, maxSizeGb: null },
    scope: { mode: 'all' }, wholeSeasonAfterFinale: false, replaceWithHigher: true, autoNextSeason: true } }).run();
  expect(() => deleteStudio(db, lf.id)).toThrow('Студия используется: подписок — 1');
});
```
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** (ядро):
```ts
// src/lib/studios.ts
import { asc, eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { studios, subscriptions, type Studio } from './db/schema';
import { getSetting, setSetting } from './settings';
import { STUDIO_SEED } from './studio-seed';
import type { Profile } from './profile';

export class StudioError extends Error {}
export type StudioInput = { name: string; aliases: string[]; kind: Studio['kind']; trackers: string[] };

export const normalizeStudio = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[\s.\-_]+/g, '');

const uniq = (xs: string[], f: (s: string) => string = (s) => s) => {
  const seen = new Set<string>();
  return xs.map((x) => x.trim()).filter((x) => x && !seen.has(f(x)) && seen.add(f(x)));
};

function clean(input: StudioInput): StudioInput {
  const name = input.name.trim();
  if (!name) throw new StudioError('Введите название студии');
  if (name.length > 60) throw new StudioError('Название — не длиннее 60 символов');
  const aliases = uniq(input.aliases, normalizeStudio).filter((a) => normalizeStudio(a) !== normalizeStudio(name));
  return { name, aliases, kind: input.kind, trackers: uniq(input.trackers.map((t) => t.toLowerCase())) };
}

function assertNoConflict(db: Db, input: StudioInput, selfId?: number) {
  const taken = new Map<string, string>();
  for (const s of db.select().from(studios).all()) {
    if (s.id === selfId) continue;
    for (const v of [s.name, ...s.aliases]) taken.set(normalizeStudio(v), s.name);
  }
  for (const v of [input.name, ...input.aliases]) {
    const owner = taken.get(normalizeStudio(v));
    if (owner) throw new StudioError(`«${v}» уже есть у студии ${owner}`);
  }
}

export function createStudio(db: Db, input: StudioInput, source: Studio['source'] = 'manual'): Studio {
  const c = clean(input);
  assertNoConflict(db, c);
  return db.insert(studios).values({ ...c, source, confirmed: source !== 'laya', createdAt: Date.now() }).returning().get();
}

export function updateStudio(db: Db, id: number, input: StudioInput): Studio {
  const c = clean(input);
  assertNoConflict(db, c, id);
  const row = db.update(studios).set(c).where(eq(studios.id, id)).returning().get();
  if (!row) throw new StudioError('Студия не найдена');
  return row;
}

export function studioUsage(db: Db, id: number) {
  const uses = (p?: Profile) => !!p?.dubs.some((d) => d.kind === 'studio' && d.studioId === id);
  const subs = db.select({ profile: subscriptions.profile }).from(subscriptions).all().filter((s) => uses(s.profile)).length;
  const profiles = (['series', 'anime'] as const).filter((k) => uses(getSetting<Profile>(db, `profile.${k}`)));
  return { subscriptions: subs, profiles };
}

export function deleteStudio(db: Db, id: number) {
  const u = studioUsage(db, id);
  if (u.subscriptions || u.profiles.length) {
    const parts = [u.subscriptions ? `подписок — ${u.subscriptions}` : null, u.profiles.length ? 'профиль по умолчанию' : null].filter(Boolean);
    throw new StudioError(`Студия используется: ${parts.join(', ')}`);
  }
  db.delete(studios).where(eq(studios.id, id)).run();
}

export function seedStudios(db: Db) {
  if (getSetting<boolean>(db, 'studios.seeded')) return;
  db.transaction((tx) => {
    for (const s of STUDIO_SEED) tx.insert(studios).values({ ...s, source: 'seed', confirmed: true, createdAt: Date.now() }).run();
  });
  setSetting(db, 'studios.seeded', true);
}

export function listStudios(db: Db, kind?: 'series' | 'anime'): Studio[] {
  return db.select().from(studios).orderBy(asc(studios.name)).all()
    .filter((s) => !kind || s.kind === kind || s.kind === 'both')
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export function findStudioByAlias(db: Db, text: string): Studio | undefined {
  const n = normalizeStudio(text);
  return db.select().from(studios).all().find((s) => [s.name, ...s.aliases].some((v) => normalizeStudio(v) === n));
}
```
`getDb()` в `src/lib/db/client.ts`: после `migrateDb(db)` — `seedStudios(db)` (импорт из `../studios`; при цикле импортов вынести вызов в `src/lib/db/init.ts`: `export function initDb(db) { migrateDb(db); seedStudios(db); }` и вызывать его из `getDb` и супервизора).
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `feat(studios): словарь студий`.

---

### Task 3: Профиль — проверка, умолчания, описание

**Files:** Modify `src/lib/profile.ts`; Test `tests/unit/profile.test.ts`

**Interfaces — Produces:**
```ts
export type DubPosition = { kind: 'studio'; studioId: number; waitDays: number } | { kind: 'any'; waitDays: number } | { kind: 'original'; waitDays: number };
export type Quality = { target: 720 | 1080 | 2160; allowLower: boolean; preferHdr: boolean; maxSizeGb: number | null };
export type Scope = { mode: 'all' } | { mode: 'new' } | { mode: 'from'; season: number; episode: number; until: 'season_end' | 'onward' };
export type Profile = { dubs: DubPosition[]; quality: Quality; scope: Scope; wholeSeasonAfterFinale: boolean; replaceWithHigher: boolean; autoNextSeason: boolean };
export type ValidationResult = { ok: true; profile: Profile } | { ok: false; error: string };
export function validateProfile(raw: unknown, knownStudioIds: Set<number>): ValidationResult;  // строит новый объект только из известных полей
export function parseProfileJson(json: string, knownStudioIds: Set<number>): ValidationResult;  // не-JSON → «Неверные данные профиля»
export function builtinProfile(db: Db, kind: 'series' | 'anime'): Profile;
export function getDefaultProfile(db: Db, kind: 'series' | 'anime'): Profile;   // сохранённый (с выкинутыми неизвестными студиями) или встроенный
export function saveDefaultProfile(db: Db, kind: 'series' | 'anime', p: Profile): void;
export function describeProfile(p: Profile, studioName: (id: number) => string | undefined): { chain: string; quality: string; scope: string };
```
Сообщения `validateProfile`: «Выберите хотя бы одну озвучку», «Студия выбрана дважды», «Неизвестная студия», «„Любая“ — только одна и последней», «„Оригинал“ выбран дважды»,
«Ожидание — от 0 до 60 дней», «Качество — 720p, 1080p или 2160p», «Лимит — от 0,5 до 200 ГБ», «Сезон и серия — с 1», «Неверные данные профиля» (для прочего мусора).
`waitDays` первой позиции принудительно 0.
`describeProfile`: `chain` = «LostFilm → HDrezka Studio (2 дн) → Любая (5 дн)» (удалённая студия — «Студия удалена»); `quality` = «2160p, иначе ниже · HDR» / «1080p · до 4 ГБ»;
`scope` = «Все сезоны» / «Только новые серии» / «С S02E05 до конца сезона» / «С S02E05 и дальше».

Встроенные: `series` — имена `['LostFilm', 'HDrezka Studio']`, `anime` — `['AniDUB', 'AniLibria']`; ожидания 0, 2; затем `any` 5; качество `{2160, true, true, null}`,
scope `new`, `wholeSeasonAfterFinale: false`, `replaceWithHigher: true`, `autoNextSeason: true`. Студий нет в словаре → пропустить; осталась только «Любая» — её `waitDays` 0.

- [ ] **Step 1: Failing test**
```ts
// tests/unit/profile.test.ts
import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { seedStudios, findStudioByAlias, deleteStudio } from '@/lib/studios';
import { validateProfile, parseProfileJson, builtinProfile, getDefaultProfile, saveDefaultProfile, describeProfile, type Profile } from '@/lib/profile';

const base: Profile = { dubs: [{ kind: 'studio', studioId: 1, waitDays: 3 }, { kind: 'any', waitDays: 5 }],
  quality: { target: 2160, allowLower: true, preferHdr: true, maxSizeGb: null }, scope: { mode: 'new' },
  wholeSeasonAfterFinale: false, replaceWithHigher: true, autoNextSeason: true };
const known = new Set([1, 2]);

test('правильный профиль; первая позиция без ожидания; лишние поля отброшены', () => {
  const r = validateProfile({ ...base, hacker: 1, dubs: [{ ...base.dubs[0], extra: true }, base.dubs[1]] }, known);
  expect(r).toEqual({ ok: true, profile: { ...base, dubs: [{ kind: 'studio', studioId: 1, waitDays: 0 }, { kind: 'any', waitDays: 5 }] } });
});

test.each([
  [{ ...base, dubs: [] }, 'Выберите хотя бы одну озвучку'],
  [{ ...base, dubs: [{ kind: 'studio', studioId: 1, waitDays: 0 }, { kind: 'studio', studioId: 1, waitDays: 1 }] }, 'Студия выбрана дважды'],
  [{ ...base, dubs: [{ kind: 'studio', studioId: 99, waitDays: 0 }] }, 'Неизвестная студия'],
  [{ ...base, dubs: [{ kind: 'any', waitDays: 0 }, { kind: 'studio', studioId: 1, waitDays: 1 }] }, '«Любая» — только одна и последней'],
  [{ ...base, dubs: [{ kind: 'original', waitDays: 0 }, { kind: 'original', waitDays: 1 }] }, '«Оригинал» выбран дважды'],
  [{ ...base, dubs: [{ kind: 'studio', studioId: 1, waitDays: 0 }, { kind: 'any', waitDays: -5 }] }, 'Ожидание — от 0 до 60 дней'],
  [{ ...base, quality: { ...base.quality, target: 480 } }, 'Качество — 720p, 1080p или 2160p'],
  [{ ...base, quality: { ...base.quality, maxSizeGb: 0.1 } }, 'Лимит — от 0,5 до 200 ГБ'],
  [{ ...base, scope: { mode: 'from', season: 0, episode: 1, until: 'onward' } }, 'Сезон и серия — с 1'],
  [{ ...base, scope: { mode: 'later' } }, 'Неверные данные профиля'],
  ['строка', 'Неверные данные профиля'],
])('отказ: %#', (raw, error) => {
  expect(validateProfile(raw, known)).toEqual({ ok: false, error });
});

test('не-JSON', () => {
  expect(parseProfileJson('{oops', known)).toEqual({ ok: false, error: 'Неверные данные профиля' });
});

test('встроенные профили по типу; удалённая студия пропускается', () => {
  const db = testDb();
  seedStudios(db);
  const lf = findStudioByAlias(db, 'LostFilm')!.id;
  const hd = findStudioByAlias(db, 'HDrezka')!.id;
  expect(builtinProfile(db, 'series').dubs).toEqual([{ kind: 'studio', studioId: lf, waitDays: 0 }, { kind: 'studio', studioId: hd, waitDays: 2 }, { kind: 'any', waitDays: 5 }]);
  expect(builtinProfile(db, 'series')).toMatchObject({ quality: { target: 2160, allowLower: true, preferHdr: true, maxSizeGb: null }, scope: { mode: 'new' } });
  deleteStudio(db, lf);
  expect(builtinProfile(db, 'series').dubs).toEqual([{ kind: 'studio', studioId: hd, waitDays: 0 }, { kind: 'any', waitDays: 5 }]);
  deleteStudio(db, hd);
  expect(builtinProfile(db, 'series').dubs).toEqual([{ kind: 'any', waitDays: 0 }]);
});

test('сохранённый профиль по умолчанию', () => {
  const db = testDb();
  seedStudios(db);
  const ad = findStudioByAlias(db, 'AniDUB')!.id;
  const p: Profile = { ...base, dubs: [{ kind: 'studio', studioId: ad, waitDays: 0 }] };
  saveDefaultProfile(db, 'anime', p);
  expect(getDefaultProfile(db, 'anime')).toEqual(p);
  expect(getDefaultProfile(db, 'series').dubs[0]).toMatchObject({ kind: 'studio' });
});

test('описание профиля', () => {
  const names: Record<number, string> = { 1: 'LostFilm', 2: 'HDrezka Studio' };
  const p: Profile = { ...base, dubs: [{ kind: 'studio', studioId: 1, waitDays: 0 }, { kind: 'studio', studioId: 2, waitDays: 2 }, { kind: 'studio', studioId: 7, waitDays: 3 }, { kind: 'any', waitDays: 5 }] };
  expect(describeProfile(p, (id) => names[id])).toEqual({ chain: 'LostFilm → HDrezka Studio (2 дн) → Студия удалена (3 дн) → Любая (5 дн)', quality: '2160p, иначе ниже · HDR', scope: 'Только новые серии' });
  expect(describeProfile({ ...p, quality: { target: 1080, allowLower: false, preferHdr: false, maxSizeGb: 4 }, scope: { mode: 'from', season: 2, episode: 5, until: 'season_end' } }, (id) => names[id]))
    .toMatchObject({ quality: '1080p · до 4 ГБ', scope: 'С S02E05 до конца сезона' });
});
```
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** `validateProfile` вручную (без библиотек): проверка типов каждого поля, сбор нового объекта; `builtinProfile` через `findStudioByAlias`;
  `getDefaultProfile` = сохранённый, прогнанный через `validateProfile` с текущими id студий после удаления позиций неизвестных студий (если после чистки пусто — встроенный); `saveDefaultProfile` — `setSetting`.
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `feat(subs): профиль подписки`.

---

### Task 4: Подписки, нужные серии, библиотека

**Files:** Create `src/lib/subscriptions.ts`; Test `tests/unit/subscriptions.test.ts`, `tests/unit/wanted.test.ts`

**Interfaces — Produces:**
```ts
export class SubscriptionError extends Error {}
export function getSubscription(db: Db, titleId: number): Subscription | undefined;
export function subscribe(db: Db, titleId: number, profile: Profile, now?: number): Subscription;  // уже есть → SubscriptionError('Уже есть подписка'); нет сериала → 'Сериал не найден'
export function updateSubscription(db: Db, titleId: number, profile: Profile, now?: number): Subscription;
export function unsubscribe(db: Db, titleId: number): void;
export function wantedEpisodes(sub: Pick<Subscription, 'profile' | 'subscribedAt'>, eps: Pick<Episode, 'season' | 'number' | 'airDate'>[], today: string): { season: number; number: number }[];
export type LibraryFilter = 'all' | 'airing' | 'ended';
export type LibraryItem = { title: Title; profile: Profile; next: { season: number; number: number; airDate: string } | null };
export function libraryItems(db: Db, today: string): LibraryItem[];                  // все подписки, сортировка: next.airDate ↑ (null в конце), затем nameRu (ru)
export function filterLibrary(items: LibraryItem[], f: LibraryFilter): LibraryItem[];
export const libraryCounts: (items: LibraryItem[]) => Record<LibraryFilter, number>;
```
Дата подписки для `new` — локальная дата `subscribedAt` (`new Date(ms).toLocaleDateString('sv-SE')`).

- [ ] **Step 1: Failing tests**
```ts
// tests/unit/wanted.test.ts
import { expect, test } from 'vitest';
import { wantedEpisodes } from '@/lib/subscriptions';
import type { Profile } from '@/lib/profile';

const p = (scope: Profile['scope']): Profile => ({ dubs: [{ kind: 'any', waitDays: 0 }], quality: { target: 1080, allowLower: true, preferHdr: false, maxSizeGb: null },
  scope, wholeSeasonAfterFinale: false, replaceWithHigher: true, autoNextSeason: true });
const eps = [
  { season: 0, number: 1, airDate: '2020-01-01' },
  { season: 1, number: 1, airDate: '2025-01-01' }, { season: 1, number: 2, airDate: '2025-01-08' },
  { season: 2, number: 1, airDate: '2026-09-20' }, { season: 2, number: 2, airDate: '2026-09-27' },
  { season: 2, number: 3, airDate: '2026-09-30' }, { season: 2, number: 4, airDate: '2026-10-07' }, { season: 2, number: 5, airDate: null },
];
const today = '2026-09-30';
const sub = (scope: Profile['scope'], subscribedAt = Date.parse('2026-09-27T12:00:00')) => ({ profile: p(scope), subscribedAt });
const ids = (xs: { season: number; number: number }[]) => xs.map((e) => `S${e.season}E${e.number}`);

test('все сезоны: вышедшие, без спецвыпусков и без даты; сегодняшняя — нужна', () => {
  expect(ids(wantedEpisodes(sub({ mode: 'all' }), eps, today))).toEqual(['S1E1', 'S1E2', 'S2E1', 'S2E2', 'S2E3']);
});
test('только новые: с даты подписки включительно', () => {
  expect(ids(wantedEpisodes(sub({ mode: 'new' }), eps, today))).toEqual(['S2E2', 'S2E3']);
});
test('с серии: до конца сезона и дальше', () => {
  expect(ids(wantedEpisodes(sub({ mode: 'from', season: 1, episode: 2, until: 'season_end' }), eps, today))).toEqual(['S1E2']);
  expect(ids(wantedEpisodes(sub({ mode: 'from', season: 1, episode: 2, until: 'onward' }), eps, today))).toEqual(['S1E2', 'S2E1', 'S2E2', 'S2E3']);
});
```
```ts
// tests/unit/subscriptions.test.ts
import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { testDb } from './helpers';
import { fakeTmdb } from './fake-tmdb';
import { syncTitle } from '@/lib/catalog';
import { seedStudios } from '@/lib/studios';
import { builtinProfile } from '@/lib/profile';
import { subscribe, updateSubscription, unsubscribe, getSubscription, libraryItems, filterLibrary, libraryCounts, SubscriptionError } from '@/lib/subscriptions';
import type { TmdbTvDetails, TmdbSeason } from '@/lib/tmdb/types';

const fx = <T>(n: string) => JSON.parse(readFileSync(`tests/fixtures/tmdb/${n}.json`, 'utf8')) as T;

async function setup() {
  const db = testDb();
  seedStudios(db);
  const running = { ...fx<TmdbTvDetails>('tv-1399'), id: 5, name: 'Бета', status: 'Returning Series' };
  const { tmdb } = fakeTmdb({ details: { 1399: fx<TmdbTvDetails>('tv-1399'), 1429: fx<TmdbTvDetails>('tv-1429'), 5: running },
    seasons: { '1399:1': fx<TmdbSeason>('tv-1399-season-1'), '5:1': { season_number: 1, episodes: [{ episode_number: 1, name: 'x', air_date: '2026-10-05', runtime: 50 }] } } });
  const got = await syncTitle(db, tmdb, 1399, { now: 1 });
  const aot = await syncTitle(db, tmdb, 1429, { now: 1 });
  const beta = await syncTitle(db, tmdb, 5, { now: 1 });
  return { db, got, aot, beta };
}

test('подписка, правка, отписка', async () => {
  const { db, got } = await setup();
  const p = builtinProfile(db, 'series');
  const s = subscribe(db, got.id, p, 100);
  expect(s).toMatchObject({ titleId: got.id, subscribedAt: 100 });
  expect(() => subscribe(db, got.id, p)).toThrow(SubscriptionError);
  expect(() => subscribe(db, 9999, p)).toThrow('Сериал не найден');
  const upd = updateSubscription(db, got.id, { ...p, quality: { ...p.quality, target: 1080 } }, 200);
  expect(upd).toMatchObject({ subscribedAt: 100, updatedAt: 200 });
  expect(getSubscription(db, got.id)!.profile.quality.target).toBe(1080);
  unsubscribe(db, got.id);
  expect(getSubscription(db, got.id)).toBeUndefined();
});

test('библиотека: ближайшая серия, сортировка, фильтры', async () => {
  const { db, got, aot, beta } = await setup();
  for (const t of [got, aot, beta]) subscribe(db, t.id, builtinProfile(db, t.kind));
  const items = libraryItems(db, '2026-09-30');
  expect(items.map((i) => i.title.nameRu)).toEqual(['Бета', 'Атака титанов', 'Игра престолов']);
  expect(items[0].next).toEqual({ season: 1, number: 1, airDate: '2026-10-05' });
  expect(items[1].next).toBeNull();
  expect(libraryCounts(items)).toEqual({ all: 3, airing: 1, ended: 2 });
  expect(filterLibrary(items, 'airing').map((i) => i.title.nameRu)).toEqual(['Бета']);
});
```
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** `wantedEpisodes`:
```ts
export function wantedEpisodes(sub, eps, today) {
  const since = new Date(sub.subscribedAt).toLocaleDateString('sv-SE');
  const s = sub.profile.scope;
  return eps
    .filter((e) => e.season > 0 && e.airDate && e.airDate <= today)
    .filter((e) =>
      s.mode === 'all' ? true
      : s.mode === 'new' ? e.airDate! >= since
      : s.until === 'season_end' ? e.season === s.season && e.number >= s.episode
      : (e.season === s.season && e.number >= s.episode) || e.season > s.season)
    .sort((a, b) => a.season - b.season || a.number - b.number)
    .map((e) => ({ season: e.season, number: e.number }));
}
```
`libraryItems`: подписки join titles; для каждого — `min(air_date)` среди серий с `air_date >= today` и `season > 0` (один SQL-запрос с `GROUP BY title_id` или по сериалу — подписок мало).
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `feat(subs): подписки, нужные серии, данные библиотеки`.

---

### Task 5: Редактор профиля и окно подписки; карточка сериала

**Files:** Create `src/components/ui/Stepper.tsx`, `src/components/ui/Modal.tsx`, `src/components/subscribe/ProfileEditor.tsx`, `src/components/subscribe/SubscribeDialog.tsx`,
`src/app/(app)/series/[tmdbId]/subscribe-actions.ts`, `src/app/(app)/series/[tmdbId]/SubscriptionPanel.tsx`; Modify `src/app/(app)/series/[tmdbId]/page.tsx`;
Test `tests/unit/subscribe-action-input.test.ts`

**Interfaces — Produces:**
- `Stepper({ value, min, max, onChange, label })` — «−» число «+», кнопки 44×44 (визуально 32, зона нажатия 44), `aria-label` «Меньше/Больше».
- `Modal({ open, onClose, labelledBy, children })` — клиентский: `≥ md` — центр экрана, ширина до 880 px, `rounded-[24px] bg-surface border border-line`, затемнение `bg-black/60`;
  `< md` — шторка снизу `rounded-t-[22px]`, высота до 92vh, прокрутка внутри; Esc и клик по фону закрывают; фокус внутрь при открытии, возврат при закрытии; `body` без прокрутки.
- `ProfileEditor({ studios, initial, onChange })` — `studios: { id; name }[]` (уже отфильтрованы по типу); секции по спецификации; поднимает `Profile` через `onChange`.
- `SubscribeDialog({ mode: 'subscribe' | 'edit' | 'default', title?, studios, initial, action, onClose })` — внутри форма с `<input type="hidden" name="profile" value={JSON.stringify(profile)}>`, `describeProfile` в сводке.
- `subscribe-actions.ts`: `saveSubscriptionAction(prev, form)` — поля `tmdbId`, `profile`, `intent` (`subscribe` | `save` | `unsubscribe`); проверка → `subscribe`/`updateSubscription`/`unsubscribe` → `revalidatePath` карточки и `/library` → `{ ok: true }` или `{ error }`.
  Разбор входа вынесен в чистую функцию `parseSubscriptionForm(form: FormData, knownStudioIds: Set<number>): { tmdbId: number; intent: …; profile?: Profile } | { error: string }` в `src/lib/subscription-form.ts` (тестируется).

- [ ] **Step 1: Failing test**
```ts
// tests/unit/subscribe-action-input.test.ts
import { expect, test } from 'vitest';
import { parseSubscriptionForm } from '@/lib/subscription-form';

const f = (o: Record<string, string>) => { const d = new FormData(); for (const [k, v] of Object.entries(o)) d.set(k, v); return d; };
const profile = JSON.stringify({ dubs: [{ kind: 'any', waitDays: 0 }], quality: { target: 1080, allowLower: true, preferHdr: false, maxSizeGb: null }, scope: { mode: 'all' },
  wholeSeasonAfterFinale: false, replaceWithHigher: true, autoNextSeason: true });

test('разбор формы подписки', () => {
  expect(parseSubscriptionForm(f({ tmdbId: '1399', intent: 'subscribe', profile }), new Set())).toMatchObject({ tmdbId: 1399, intent: 'subscribe', profile: { scope: { mode: 'all' } } });
  expect(parseSubscriptionForm(f({ tmdbId: '1399', intent: 'unsubscribe' }), new Set())).toEqual({ tmdbId: 1399, intent: 'unsubscribe' });
  expect(parseSubscriptionForm(f({ tmdbId: 'abc', intent: 'subscribe', profile }), new Set())).toEqual({ error: 'Сериал не найден' });
  expect(parseSubscriptionForm(f({ tmdbId: '1', intent: 'drop', profile }), new Set())).toEqual({ error: 'Неверное действие' });
  expect(parseSubscriptionForm(f({ tmdbId: '1', intent: 'save', profile: '{' }), new Set())).toEqual({ error: 'Неверные данные профиля' });
});
```
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** `subscription-form.ts`, затем компоненты и action.
  Карточка: вместо неактивной «Подписаться» — клиентский `SubscribeButton` (открывает `SubscribeDialog`); данные для окна (студии по типу сериала, профиль по умолчанию или текущий) готовит серверная страница.
  Подписан — кнопка secondary «Подписка» и `SubscriptionPanel` (серверный): «Подписка · активна» (accent), порядок `n. Имя — сразу / если нет N дн`, строки правил из `describeProfile` и флагов
  (включён — точка accent, выключен — точка dim и текст `faint`). Desktop — колонка справа от таблицы серий (`grid lg:grid-cols-[minmax(0,1fr)_340px]`), телефон — под hero.
  Удалить строку «Подписки — в следующем обновлении».
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint` — PASS.
- [ ] **Step 5: Скриншоты** окна (desktop 1440, шторка 390), карточки с подпиской; сверить с `Subscribe.dc.html`, `MobileSubscribe.dc.html`, `Series.dc.html`.
- [ ] **Step 6: Commit** `feat(subs): окно подписки и блок подписки в карточке`.

---

### Task 6: Библиотека

**Files:** Modify `src/app/(app)/library/page.tsx`; Create `src/components/catalog/LibraryCard.tsx`

**Interfaces:** Consumes `libraryItems`, `filterLibrary`, `libraryCounts`, `describeProfile`, `formatAirDate`, `Poster`.
- `/library?filter=airing|ended` (по умолчанию `all`); заголовок «Библиотека» + `text-muted` число.
- Чипы-фильтры (ссылки): активный — `bg-text text-bg`, неактивный — `border border-line text-text-2`; подпись «Все · 3».
- Карточка по `Library.dc.html`: постер 2:3 `rounded-[14px]`, название 15 px/600, строка «4K · LostFilm → HDrezka Studio» (`text-muted` 13 px; 2160 → «4K», иначе «1080p»/«720p»; цепочка — первые две позиции + «…»),
  строка состояния 13 px: `next` → «S02E05 · 7 окт» (`text-text-2`); иначе ended/canceled → «Завершён» (`text-faint`); иначе «Новых серий пока не объявлено» (`text-faint`).
- Сетка как у «Поиска и трендов»; пусто — карточка-подсказка со ссылкой «Поиск и тренды».

- [ ] **Step 1:** страница + карточка. **Step 2:** `pnpm typecheck && pnpm lint`. **Step 3:** скриншоты против `Library.dc.html` / `MobileLibrary.dc.html`.
- [ ] **Step 4: Commit** `feat(library): библиотека подписок`.

(Логика покрыта тестами Task 4; e2e — Task 8.)

---

### Task 7: Настройки «Подписки и студии»

**Files:** Create `src/app/(app)/settings/studios/{page.tsx,actions.ts,StudioEditor.tsx,DefaultProfileCard.tsx}`, `src/lib/studio-form.ts`; Test `tests/unit/studio-form.test.ts`

**Interfaces — Produces:**
- `parseStudioForm(form: FormData): StudioInput | { error: string }` — `name`, `aliases` и `trackers` через запятую, `kind` ∈ series|anime|both.
- Actions: `saveStudioAction(prev, form)` (`id` пустой → create, иначе update; `StudioError` → `{ error }`; ввод возвращается `values`), `deleteStudioAction(prev, form)`,
  `saveDefaultProfileAction(prev, form)` (`kind`, `profile` → `parseProfileJson` → `saveDefaultProfile`).
- Страница: `SectionHeader` «Подписки и студии» + описание из макета; две `DefaultProfileCard` (название «Сериалы»/«Аниме», качество справа, цепочка чипами `1 LostFilm` как в макете, «Изменить» → `SubscribeDialog mode="default"`);
  «Словарь студий · N» + кнопка secondary «+ Студия»; таблица (`ui/Table`) колонки: Студия (500), Варианты написания (моно 12 px), Тип (Сериалы/Аниме/Оба), Свой трекер, Кто добавил (Начальный набор / Вручную / Laya), и «Изменить».
  `StudioEditor` — `Modal` с формой: Название, Варианты (через запятую), Тип (`Segmented`), Свои трекеры (через запятую, hint «Имя трекера в Jackett: раздачи с него — всегда эта студия»), «Сохранить», «Удалить» (destructive, только для существующей).

- [ ] **Step 1: Failing test**
```ts
// tests/unit/studio-form.test.ts
import { expect, test } from 'vitest';
import { parseStudioForm } from '@/lib/studio-form';
const f = (o: Record<string, string>) => { const d = new FormData(); for (const [k, v] of Object.entries(o)) d.set(k, v); return d; };
test('разбор формы студии', () => {
  expect(parseStudioForm(f({ name: 'Paravozik', aliases: 'Паровозик, Paravozik Studio,', kind: 'series', trackers: '' })))
    .toEqual({ name: 'Paravozik', aliases: ['Паровозик', 'Paravozik Studio'], kind: 'series', trackers: [] });
  expect(parseStudioForm(f({ name: 'X', aliases: '', kind: 'movie', trackers: '' }))).toEqual({ error: 'Выберите тип' });
});
```
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** Раздел `studios` убрать из заглушки `[section]` (появляется своя страница).
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint` — PASS. **Step 5:** скриншоты против `Settings.dc.html` (раздел «Подписки и студии»).
- [ ] **Step 6: Commit** `feat(settings): профили по умолчанию и словарь студий`.

---

### Task 8: E2E и документация

**Files:** Create `tests/e2e/03-subscriptions.spec.ts`; Modify `CLAUDE.md`

- [ ] **Step 1: Сценарий** (вход как в `02-catalog`: ждать новое окно TOTP, код шага `current + 1`; **02 теперь тоже использовал код** — поэтому 03 ждёт следующего окна и берёт `current + 1` так же):
  1. `/series/1399` → «Подписаться» → в окне снять LostFilm (нажатие на строку), оставить HDrezka Studio и «Любая»; «2160p» → «1080p»; «Подписаться».
  2. Карточка: виден блок «Подписка · активна», цепочка «HDrezka Studio → Любая (5 дн)».
  3. `/library` → карточка «Игра престолов», строка «1080p · HDrezka Studio → Любая».
  4. Карточка → «Подписка» → «Отписаться» → подтверждение → `/library` пустая («Библиотека пуста»).
  5. `/settings/studios` → «+ Студия» → «Paravozik», варианты «Паровозик» → «Сохранить» → строка в таблице; попытка создать студию с вариантом «HDrezka» → ошибка «уже есть у студии HDrezka Studio».
  6. `/series/1399` → «Подписаться» → в окне есть «Paravozik».
- [ ] **Step 2: Run** `pnpm e2e` — все три сценария PASS.
- [ ] **Step 3: Документация** — `CLAUDE.md`: раздел «Решения (фаза 1b)»: словарь (`src/lib/studios.ts`, засев один раз, нормализация), профиль (`src/lib/profile.ts`, JSON в подписке и `app_settings['profile.*']`, проверка на сервере),
  `wantedEpisodes` — точка входа для 1c, окно подписки = `ProfileEditor` + `SubscribeDialog` (и для профилей по умолчанию).
- [ ] **Step 4:** `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`. **Step 5: Commit** `test(e2e): подписки; документация`.
