import { isMovieProfile } from './movie-profile';
import { and, eq, gte } from 'drizzle-orm';
import type { Db } from './db/client';
import { layaExamples, releases, titles, type Release } from './db/schema';
import { matchInput, studioInput } from './laya/review';
import { addExample, lastLayaAnswer, markFinalAnswer } from './laya/examples';
import { getTitleByTmdbId, listEpisodes, listSeasons } from './catalog';
import { getSubscription } from './subscriptions';
import { getDefaultProfile, getMovieDefault } from './profile';
import { evaluateMovie } from './movie-evaluate';
import { digitalReleased } from './movies';
import { createStudio, listStudios, updateStudio } from './studios';
import { normalizeStudio } from './studios-normalize';
import { searchTitle, reparseReleases, type SearchOptions, type SourceStatus } from './search';
import { evaluateReleases, type Target, type Verdict } from './evaluate';
import { addRule } from './release-rules';
import { todayIso } from './dates';
import type { DubBy } from './parse/types';

export type ManualRow = { release: Release; verdict: Verdict; dubs: { label: string; studioName?: string; by: DubBy }[] };
export type ManualResult = { rows: ManualRow[]; sources: SourceStatus[]; profileSource: 'subscription' | 'default'; searchedAt: number | null };
/** cached — без запросов к источникам: раздачи и статусы последнего поиска (страница открывается сразу). */
export type ManualOptions = SearchOptions & { today?: string; cached?: boolean };

// ручной поиск — страница ждёт ответа: не больше 3 вопросов к Laya (остальное — из кэша или правила)
const MANUAL_LAYA_BUDGET = 3;

const TONE_ORDER: Verdict['tone'][] = ['best', 'ok', 'wait', 'ask', 'reject'];

/** Раздачи, найденные последним поиском (не раньше его начала), и как тогда ответили источники. */
function lastSearch(db: Db, titleId: number): { releases: Release[]; sources: SourceStatus[]; at: number | null } {
  const t = db.select({ at: titles.releasesSearchedAt, sources: titles.lastSources }).from(titles).where(eq(titles.id, titleId)).get();
  if (!t?.at) return { releases: [], sources: [], at: null };
  const slack = Math.max(0, ...(t.sources ?? []).map((s) => s.ms)) + 60_000; // раздачи записываются по ходу поиска — до его отметки
  return { releases: db.select().from(releases).where(and(eq(releases.titleId, titleId), gte(releases.lastSeenAt, t.at - slack))).all(), sources: t.sources ?? [], at: t.at };
}

async function found(db: Db, titleId: number, opts: ManualOptions) {
  if (opts.cached) return lastSearch(db, titleId);
  const now = opts.now ?? Date.now();
  const r = await searchTitle(db, titleId, { ...opts, now, layaBudget: opts.layaBudget ?? MANUAL_LAYA_BUDGET });
  return { releases: r.releases, sources: r.sources, at: now };
}

/** Ручной поиск: опросить источники и оценить раздачи для серии или сезона по профилю подписки (или профилю по умолчанию). */
export async function runManualSearch(db: Db, tmdbId: number, target: Target, opts: ManualOptions = {}): Promise<ManualResult> {
  const title = getTitleByTmdbId(db, tmdbId);
  if (!title) throw new Error('Сериал не найден');
  const { releases: list, sources, at } = await found(db, title.id, opts);
  const sub = getSubscription(db, title.id);
  const profile = sub && !isMovieProfile(sub.profile) ? sub.profile : getDefaultProfile(db, title.kind);
  const names = new Map(listStudios(db).map((s) => [s.id, s.name]));
  const episodes = listSeasons(db, title.id).flatMap((s) => listEpisodes(db, title.id, s.number));
  const verdicts = evaluateReleases(list, { profile, episodes, studioName: (id) => names.get(id), today: opts.today ?? todayIso() }, target);
  const byId = new Map(verdicts.map((v) => [v.releaseId, v]));
  const rows = list
    .map((release) => ({
      release,
      verdict: byId.get(release.id)!,
      dubs: release.parsed.dubs.map((d) => ({ label: d.label, studioName: d.studioId !== null ? names.get(d.studioId) : undefined, by: d.by })),
    }))
    .sort((a, b) => TONE_ORDER.indexOf(a.verdict.tone) - TONE_ORDER.indexOf(b.verdict.tone) || (b.release.seeders ?? 0) - (a.release.seeders ?? 0));
  return { rows, sources, profileSource: sub ? 'subscription' : 'default', searchedAt: at };
}

/** Ручной поиск фильма: те же строки, вердикты — по профилю фильма и дате цифрового релиза. */
export async function runManualMovieSearch(db: Db, tmdbId: number, opts: ManualOptions = {}): Promise<ManualResult> {
  const title = getTitleByTmdbId(db, tmdbId, 'movie');
  if (!title) throw new Error('Фильм не найден');
  const { releases: list, sources, at } = await found(db, title.id, opts);
  const fresh = db.select().from(titles).where(eq(titles.id, title.id)).get()!; // поиск мог отметить цифровой релиз
  const sub = getSubscription(db, title.id);
  const profile = sub && isMovieProfile(sub.profile) ? sub.profile : getMovieDefault(db);
  const today = opts.today ?? todayIso();
  const verdicts = evaluateMovie(list, { profile, digital: digitalReleased(fresh, today), today });
  const names = new Map(listStudios(db).map((s) => [s.id, s.name]));
  const byId = new Map(verdicts.map((v) => [v.releaseId, v]));
  const rows = list
    .map((release) => ({
      release,
      verdict: byId.get(release.id)!,
      dubs: release.parsed.dubs.map((d) => ({ label: d.label, studioName: d.studioId !== null ? names.get(d.studioId) : undefined, by: d.by })),
    }))
    .sort((a, b) => TONE_ORDER.indexOf(a.verdict.tone) - TONE_ORDER.indexOf(b.verdict.tone) || (b.release.seeders ?? 0) - (a.release.seeders ?? 0));
  return { rows, sources, profileSource: sub ? 'subscription' : 'default', searchedAt: at };
}

/** «Назначить студию»: подпись из заголовка становится вариантом написания студии (или новой студией). */
export function assignStudio(db: Db, titleId: number, a: { label: string; studioId: number } | { label: string; newName: string }) {
  // пример для Laya — тот же вопрос, что она увидела бы (до того, как подпись попала в словарь)
  const title = db.select().from(titles).where(eq(titles.id, titleId)).get();
  const sample = db.select().from(releases).where(eq(releases.titleId, titleId)).all().find((r) => r.parsed.dubs.some((d) => normalizeStudio(d.label) === normalizeStudio(a.label)));
  const input = title && sample ? studioInput(db, title, sample, a.label) : null;
  if ('studioId' in a) {
    const s = listStudios(db).find((x) => x.id === a.studioId);
    if (!s) throw new Error('Студия не найдена');
    if (![s.name, ...s.aliases].some((v) => normalizeStudio(v) === normalizeStudio(a.label)))
      updateStudio(db, s.id, { name: s.name, aliases: [...s.aliases, a.label], kind: s.kind, trackers: s.trackers });
  } else {
    createStudio(db, { name: a.newName, aliases: normalizeStudio(a.newName) === normalizeStudio(a.label) ? [] : [a.label], kind: 'both', trackers: [] });
  }
  if (input) {
    // выбор Laya — из студий вопроса или «новая»: студия не из вопроса (в т. ч. только что созданная) — правильный ответ «новая»
    const chosen = 'studioId' in a ? listStudios(db).find((x) => x.id === a.studioId)!.name : a.newName;
    const label = chosen in (input.question as { criteria: Record<string, string> }).criteria ? chosen : 'новая';
    const { key, ...rest } = input;
    addExample(db, { task: 'studio', key, input: rest, label, laya: lastLayaAnswer(db, 'studio', key)?.laya, source: 'studio-assign', title: a.label });
  }
  reparseReleases(db, titleId);
}

/** Ответ «это он / не он» — правило для трекера и основы заголовка. */
export function answerMatch(db: Db, titleId: number, releaseId: number, verdict: 'match' | 'reject', source: 'match-answer' | 'telegram' = 'match-answer') {
  const r = db.select().from(releases).where(eq(releases.id, releaseId)).get();
  if (!r || r.titleId !== titleId) throw new Error('Раздача не найдена');
  const title = db.select().from(titles).where(eq(titles.id, titleId)).get()!;
  // пример «тот ли сериал»: тот же вопрос, что у Laya (признаки — до правила пользователя: повторный ответ берёт прежние)
  const fresh = matchInput(title, r);
  const prev = db.select().from(layaExamples).where(and(eq(layaExamples.task, 'match'), eq(layaExamples.key, fresh.key))).get();
  const input = prev?.input ?? { state: fresh.state, question: fresh.question, features: fresh.features };
  addExample(db, { task: 'match', key: fresh.key, input, label: verdict === 'match', laya: lastLayaAnswer(db, 'match', fresh.key)?.laya, source, title: r.title });
  // «Это он» / «Не тот» — ответ и на финальную проверку этой раздачи (иначе отказ Laya повторялся бы на каждом поиске)
  markFinalAnswer(db, title, r, verdict === 'match');
  addRule(db, titleId, r.trackerName, r.title, verdict);
  reparseReleases(db, titleId);
}
