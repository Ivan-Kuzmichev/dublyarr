# Фаза 3a «Пересборка файлов»: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** пересборка mkv при импорте (нужные дорожки, флаги, внешние дорожки), проверка «та ли серия» и реальных разрешения/HDR, раздел «Обработка файлов».

**Architecture:** чистые модули — `src/lib/media/probe.ts` (разбор вывода ffprobe), `src/lib/media/tracks.ts` (`classifyAudio`, `planTracks`, `findExternal`), `src/lib/media/mkvmerge.ts` (аргументы);
ввод-вывод — `src/lib/media/runner.ts` (`execFile`, доступность программ), `src/lib/media/process.ts` (`processEpisode`: ffprobe → проверка → план → mkvmerge → файл);
встраивание — `importEpisode` в `src/lib/downloads.ts`; экран — `/settings/files`.

**Tech Stack:** как раньше; внешние программы — `ffprobe`, `mkvmerge` (есть в образе Docker).

**Spec:** `docs/superpowers/specs/2026-10-01-phase-3a-remux-design.md`; `docs/spec.md` §6; макет `Settings.dc.html` («Обработка файлов»).

## Global Constraints

- Без перекодирования; источник в папке загрузок не изменяется (раздача продолжается).
- Нужная озвучка не опознана — аудио не трогать.
- Импорт по-прежнему не затирает чужой файл; старая копия — правило 2b.
- Нет программ — импорт как раньше (жёсткая ссылка), без ошибок.
- Каждая задача — тест сначала, затем код, затем `pnpm test && pnpm typecheck && pnpm lint`.

## Review Focus

1. **Озвучка из подписки не опознана** (дорожки без названий, только язык `rus`) — аудио не меняется, флаги прежние. Тест в Task 2.
2. **Источник — жёсткая ссылка на файл раздачи**: сборка пишет только новый файл в медиатеку, исходник не меняется. Тест в Task 4.
3. **mkvmerge упал / нет места** — временный файл удалён, импорт серии не удался с понятной ошибкой, старая копия на месте. Тест в Task 4.
4. **Серия без runtime в TMDB** — нормальная серия не считается «не той». Тест в Task 3.
5. **Внешние дорожки другой серии в той же раздаче** (`Rus Sound/LostFilm/S01E02.mka` при импорте E03) — не вшиваются. Тест в Task 2.

---

### Task 1: Данные и разбор ffprobe

**Files:** Modify `src/lib/db/schema.ts` (+ `drizzle/0010_*.sql`); Create `src/lib/media/probe.ts`, `tests/fixtures/ffprobe/*.json`; Test `tests/unit/probe.test.ts`

**Interfaces — Produces:**
`episodeFiles` += `processed: boolean` (false), `hdr: boolean` (false), `duration: number | null`, `tracks: { before: TrackInfo[]; after: TrackInfo[] } | null`; `downloads` += `processing: boolean` (false).
```ts
export type Stream = { index: number; type: 'video' | 'audio' | 'subtitle' | 'other'; codec: string; language: string | null; title: string | null; isDefault: boolean; forced: boolean; channels?: number; width?: number; height?: number; hdr?: boolean; dv?: boolean };
export type Probe = { streams: Stream[]; duration: number | null; container: string };
export function parseProbe(json: unknown): Probe;
export function resolutionOf(p: Probe): number | null; // 2160/1080/720/576/480 по кадру
export const hdrOf: (p: Probe) => boolean;
export type TrackInfo = { kind: string; name: string; flag?: string };
```
- [ ] **Step 1: Failing tests** на фикстурах: многоязычный mkv (видео HEVC 2160p HDR10, en 5.1 «Original», ru «HDrezka», ru «LostFilm», субтитры ru forced / ru full / en); mp4 с одной дорожкой; DV. **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(media): разбор ffprobe`.

---

### Task 2: Выбор дорожек

**Files:** Create `src/lib/media/tracks.ts`; Test `tests/unit/tracks.test.ts`

**Interfaces — Produces:**
```ts
export type ProcessingSettings = { audio: 'dub+original' | 'dub' | 'all'; keepBackups: boolean; external: boolean; defaultSubs: 'none' | 'forced' | 'full'; keepSubs: string[] };
export const DEFAULT_PROCESSING: ProcessingSettings; export function getProcessing(db): ProcessingSettings; export function parseProcessingForm(form: FormData): ProcessingSettings | { error: string };
export type AudioClass = { kind: 'studio'; studioId: number } | { kind: 'original' } | { kind: 'other' };
export function classifyAudio(s: Stream, studios: { id: number; name: string; aliases: string[] }[], originalLang: string | null): AudioClass;
export type External = { path: string; type: 'audio' | 'subtitle'; language: string | null; title: string | null };
export function findExternal(files: string[], videoPath: string, season: number, episode: number, single: boolean): External[];
export type TrackPlan = { changed: boolean; audio: number[]; subs: number[]; order: number[]; defaults: { audio: number | null; sub: number | null }; external: External[]; untouchedAudio: boolean };
export function planTracks(p: Probe, o: { wanted: number[]; backups: number[]; originalLang: string | null; studios: …; settings: ProcessingSettings; external: External[]; container: string }): TrackPlan;
export function describePlan(p: Probe, plan: TrackPlan, studioName): { before: TrackInfo[]; after: TrackInfo[] };
```
`wanted` — id студий нужной позиции (одна), `backups` — студии других позиций.

- [ ] **Step 1: Failing tests:** `classifyAudio` (студия по названию и варианту написания целым словом, оригинал по языку и по слову, иначе другая); `planTracks`: «озвучка + оригинал» → [HDrezka, en], по умолчанию HDrezka и ru forced; «только озвучка»; «всё»; запасные;
  нужная не опознана → аудио все, флаги прежние (Review Focus №1); субтитры по `keepSubs`; `none`/`full`; менять нечего → `changed: false`; mp4 → `changed: true`;
  `findExternal`: своя серия по имени и папке, чужая серия — нет (№5), один видеофайл — все внешние, язык по папке «Rus Sound» / «Eng Subs».
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(media): выбор дорожек`.

---

### Task 3: Аргументы mkvmerge и проверка длительности

**Files:** Create `src/lib/media/mkvmerge.ts`, `src/lib/media/checks.ts`; Test `tests/unit/mkvmerge.test.ts`, `tests/unit/checks.test.ts`

**Interfaces — Produces:**
```ts
export function mkvmergeArgs(src: string, out: string, plan: TrackPlan): string[];
export function wrongEpisode(durationSec: number | null, runtimeMin: number | null): string | null; // текст причины или null
```
- [ ] **Step 1: Failing tests:** аргументы — `--audio-tracks 2,1 --subtitle-tracks 4 --track-order 0:0,0:2,0:1,0:4 --default-track-flag 2:1 1:0 4:1 …`, внешние файлы с `--language`/`--track-name`, `changed`+все дорожки → без фильтров;
  длительность: 130 мин при runtime 55 — «Не та серия: 2 ч 10 мин вместо ~55 мин»; 50 мин — null; без runtime 45 мин — null (Review Focus №4), без runtime 125 мин — «похоже на фильм».
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(media): аргументы mkvmerge и проверка серии`.

---

### Task 4: Обработка при импорте

**Files:** Create `src/lib/media/runner.ts`, `src/lib/media/process.ts`; Modify `src/lib/downloads.ts` (`importEpisode`, «не та серия»), `src/lib/activity.ts` («Пересборка…»); Test `tests/unit/process.test.ts`, `tests/unit/sync.test.ts`

**Interfaces — Produces:**
```ts
export type Runner = { available(): Promise<{ ffprobe: boolean; mkvmerge: boolean }>; probe(file: string): Promise<unknown>; mkvmerge(args: string[]): Promise<{ code: number; output: string }> };
export const systemRunner: Runner; // execFile, таймаут 30 мин на сборку
export type ProcessResult = { kind: 'link' } | { kind: 'remux'; tmp: string; plan: TrackPlan; probe: Probe } | { kind: 'wrong'; reason: string };
export async function processEpisode(o: { runner: Runner; src: string; targetDir: string; settings: ProcessingSettings; …контекст серии }): Promise<ProcessResult>;
```
`importEpisode`: `processEpisode` → `link` — как раньше; `remux` — постановка `tmp` на место (правила импорта, старая копия), `episode_files` с `processed`, `hdr`, `duration`, реальным `resolution`, `tracks`; `wrong` — исключение «не та серия» → загрузка `error`, раздача отвергнута для серии, торрент убран из клиента без файлов, поиск в очередь.
Runner передаётся через `Paths`/зависимости синхронизации (по умолчанию `systemRunner`), чтобы тесты подменяли.

- [ ] **Step 1: Failing tests** (подменённый Runner, который «собирает» копированием и пишет сценарий вызовов): пересборка — в медиатеке `.mkv`, источник не изменён (Review Focus №2), `episode_files.processed`, `tracks`; менять нечего — жёсткая ссылка; mkvmerge код 2 — временного файла нет, ошибка в загрузке, старая копия на месте (№3);
  «не та серия» — `error`, торрент убран, файла в медиатеке нет; программ нет — жёсткая ссылка без ошибок.
- [ ] **Step 2–4:** RED → GREEN. **Step 5: Commit** `feat(media): пересборка при импорте и проверка серии`.

---

### Task 5: «Настройки → Обработка файлов» и карточка

**Files:** Create `src/app/(app)/settings/files/page.tsx`, `actions.ts`, `ProcessingForm.tsx`; Modify `src/lib/dashboard.ts` (подстрока файла: HDR, «пересобран»); Test `tests/unit/tracks.test.ts` (разбор формы), `tests/unit/dashboard.test.ts`

- [ ] **Step 1: Failing tests:** разбор формы; подстрока файла «LostFilm · 1080p HDR · 2 ГБ · пересобран».
- [ ] **Step 2–4:** RED → GREEN → страница по макету (варианты аудио, переключатели, «По умолчанию в плеере», пример по последнему пересобранному файлу, статус программ). **Step 5:** скриншоты desktop + 390 px. **Step 6: Commit** `feat(settings): обработка файлов`.

---

### Task 6: Проверка в образе Docker и документация

**Files:** Create `scripts/remux-smoke.ts` (собирается esbuild в `dist/remux-smoke.cjs`), `scripts/remux-smoke.sh`; Modify `esbuild.mjs`, `CLAUDE.md` («Решения (фаза 3a)»).

- [ ] **Step 1:** `remux-smoke.sh` внутри контейнера: `ffmpeg` создаёт тестовый mkv (видео 2 с, аудио en «Original», ru «HDrezka», ru «LostFilm», субтитры ru forced и ru full), `node dist/remux-smoke.cjs` вызывает `processEpisode` с `systemRunner` (профиль HDrezka, «озвучка + оригинал», форсированные), `ffprobe` результата → ожидаемые 2 аудио (HDrezka по умолчанию, en), субтитры ru forced по умолчанию.
- [ ] **Step 2:** `docker build --platform linux/amd64 -t dublyarr:dev .` и `docker run --rm --entrypoint sh dublyarr:dev scripts/remux-smoke.sh` → «remux smoke: OK». Если Docker недоступен — записать в ledger и сообщить.
- [ ] **Step 3:** `pnpm e2e` — 9 сценариев PASS (в e2e программ нет — импорт как раньше). **Step 4:** `CLAUDE.md`. **Step 5: Commit** `test(media): проверка пересборки в образе; документация`.
