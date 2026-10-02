import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { layaAnswers, releases as releasesT, studios as studiosT, titles as titlesT, type Release, type Studio, type Title } from '../db/schema';
import { listStudios, normalizeStudio, StudioError, updateStudio } from '../studios';
import { absoluteCandidates, dice, toTitleInfo, type AbsoluteCandidate, type TitleInfo } from '../match';
import { listSeasons } from '../catalog';
import { parseRelease } from '../parse/dubs';
import type { ParsedRelease } from '../parse/types';
import { seriesKind } from '../profile';
import { reparseReleases } from '../search';
import { addExample } from './examples';
import type { MatchResult } from '../match-types';
import { formatSize } from '../format';
import type { LayaClient } from './client';
import { decide, type Budget, type Decision, type DecideInput } from './decide';

// Laya в разборе раздач: «тот ли сериал» для сомнительных совпадений.

const pct = (p: number) => `${Math.round(p * 100)} %`;

export const matchKey = (t: Pick<Title, 'tmdbType' | 'tmdbId'>, r: Pick<Release, 'trackerName' | 'title' | 'size'>) => `${t.tmdbType}:${t.tmdbId}|${r.trackerName}|${r.title}|${r.size}`;

/** Вопрос «тот ли сериал»: формулировка, которая лучше всего различала на замере (см. ledger фазы 4). */
export function matchInput(t: Title, r: Pick<Release, 'trackerName' | 'title' | 'size' | 'match'>): DecideInput {
  const name = `${t.nameRu}${t.nameOriginal && t.nameOriginal !== t.nameRu ? ` (${t.nameOriginal})` : ''}${t.year ? `, ${t.year}` : ''}`;
  return {
    key: matchKey(t, r),
    state: { [t.kind === 'movie' ? 'фильм' : 'сериал']: name, раздача: r.title, размер: formatSize(r.size) },
    question: { type: 'noul', instructions: t.kind === 'movie' ? 'Эта раздача — тот же фильм?' : 'Эта раздача — тот же сериал?' },
    features: [r.match.score],
  };
}

/** Применить ответ Laya к сомнительному совпадению: уверенно — «подходит» / «отказ», иначе остаётся вопросом. */
export function applyMatchDecision(m: MatchResult, d: Decision<boolean> | null): MatchResult {
  if (!d || d.by !== 'laya' || m.level !== 'doubt' || m.rule) return m;
  const laya = { p: d.p, answer: d.answer };
  if (d.sure && d.answer) return { ...m, level: 'match', reasons: [`Laya: тот же · ${pct(d.p)}`], laya };
  // «нет» не отклоняет молча: раздача остаётся вопросом пользователю с мнением Laya (её уверенное «нет» уже ошибалось)
  if (d.sure) return { ...m, reasons: [...m.reasons, `Laya думает, что не тот · ${pct(1 - d.p)}`], laya };
  return { ...m, reasons: [...m.reasons, `Laya не уверена · ${pct(Math.max(d.p, 1 - d.p))}`], laya };
}

/** Спросить Laya о сомнительных раздачах (в пределах бюджета) и записать решения. */
export async function reviewMatches(db: Db, t: Title, rows: Release[], o: { budget: Budget; client?: LayaClient }): Promise<Release[]> {
  const out: Release[] = [];
  for (const r of rows) {
    if (r.match.level !== 'doubt' || r.match.rule || r.match.laya) {
      out.push(r);
      continue;
    }
    const d = await decide<boolean>(db, 'match', matchInput(t, r), o);
    const match = applyMatchDecision(r.match, d);
    if (match !== r.match) db.update(releasesT).set({ match }).where(eq(releasesT.id, r.id)).run();
    out.push({ ...r, match });
  }
  return out;
}

// --- «Какая студия» ---

const GENERIC = /^(?:DUB|MVO|DVO|VO|AVO)$/;
const MAX_STUDIOS = 19; // модель рекомендует < 20 вариантов в одном вопросе
const MIN_LABEL = 3;
const MAX_NEW_ALIASES = 3;

/** Подписи озвучки, которые словарь не узнал (как «Неизвестная студия» в вердиктах). */
export const unknownLabels = (r: Pick<Release, 'parsed'>) => [...new Set(r.parsed.dubs.filter((d) => d.studioId === null && d.by !== 'tag' && !GENERIC.test(d.label)).map((d) => d.label))];

export const studioKey = (label: string) => `studio|${normalizeStudio(label)}`;

/** Вопрос «какая студия»: до 19 студий подходящего вида (самые похожие на подпись — первыми) и «новая». */
export function studioInput(db: Db, t: Title, r: Pick<Release, 'title' | 'trackerName'>, label: string): DecideInput {
  const n = normalizeStudio(label);
  const sim = (s: Studio) => Math.max(...[s.name, ...s.aliases].map((v) => dice(normalizeStudio(v), n)));
  const ranked = listStudios(db, seriesKind(t.kind))
    .map((s) => ({ s, sim: sim(s) }))
    .sort((a, b) => b.sim - a.sim || a.s.name.localeCompare(b.s.name, 'ru'))
    .slice(0, MAX_STUDIOS);
  const criteria: Record<string, string> = Object.fromEntries(ranked.map(({ s }) => [s.name, [s.name, ...s.aliases].slice(0, 3).join(', ')]));
  criteria['новая'] = 'этой студии нет в списке';
  return {
    key: studioKey(label),
    state: { раздача: r.title, трекер: r.trackerName, подпись: label },
    question: { type: 'choice', instructions: `Какая студия озвучки скрывается за подписью «${label}»?`, criteria },
    features: [ranked[0]?.sim ?? 0],
  };
}

/** Неизвестные подписи озвучки: уверенный выбор Laya — вариант написания студии («Laya, не подтверждено»), раздачи переразбираются. */
export async function reviewStudios(db: Db, t: Title, rows: Release[], o: { budget: Budget; client?: LayaClient }): Promise<Release[]> {
  let changed = 0;
  const seen = new Set<string>();
  for (const r of rows)
    for (const label of unknownLabels(r)) {
      // короткие подписи («Px», «HD») слишком двусмысленны; за проход — не больше 3 новых вариантов
      if (seen.has(normalizeStudio(label)) || normalizeStudio(label).length < MIN_LABEL || changed >= MAX_NEW_ALIASES) continue;
      seen.add(normalizeStudio(label));
      const d = await decide<string>(db, 'studio', studioInput(db, t, r, label), o);
      if (d.by !== 'laya' || !d.sure || d.answer === 'новая') continue;
      const s = listStudios(db).find((x) => x.name === d.answer);
      if (!s) continue;
      try {
        updateStudio(db, s.id, { name: s.name, aliases: [...s.aliases, label], kind: s.kind, trackers: s.trackers });
        db.update(studiosT).set({ layaAliases: [...s.layaAliases, label] }).where(eq(studiosT.id, s.id)).run();
        changed++;
      } catch (e) {
        if (!(e instanceof StudioError)) throw e; // подпись уже у другой студии — не трогаем
      }
    }
  if (!changed) return rows;
  reparseReleases(db, t.id);
  const ids = rows.map((r) => r.id);
  return db.select().from(releasesT).where(inArray(releasesT.id, ids)).all();
}

/** Ответ пользователя на вариант написания от Laya: «Верно» — подтверждено; «Нет» — убрать и переразобрать раздачи. Оба — примеры. */
export function confirmLayaAlias(db: Db, studioId: number, alias: string, ok: boolean, now = Date.now()) {
  const s = db.select().from(studiosT).where(eq(studiosT.id, studioId)).get();
  if (!s) return;
  const n = normalizeStudio(alias);
  const asked = db.select().from(layaAnswers).where(and(eq(layaAnswers.task, 'studio'), eq(layaAnswers.key, studioKey(alias)))).all().at(-1);
  if (asked?.input)
    addExample(db, { task: 'studio', key: studioKey(alias), input: asked.input, label: ok ? s.name : 'новая', laya: { answer: asked.answer, p: asked.p, raw: asked.raw }, source: 'studio-confirm', title: alias, now });
  const layaAliases = s.layaAliases.filter((a) => normalizeStudio(a) !== n);
  if (ok) {
    db.update(studiosT).set({ layaAliases }).where(eq(studiosT.id, s.id)).run();
    return;
  }
  db.update(studiosT)
    .set({ layaAliases, aliases: s.aliases.filter((a) => normalizeStudio(a) !== n) })
    .where(eq(studiosT.id, s.id))
    .run();
  for (const { id } of db.selectDistinct({ id: releasesT.titleId }).from(releasesT).all()) reparseReleases(db, id);
}

// --- «Нумерация аниме» ---

export const animeKey = (t: Pick<Title, 'tmdbType' | 'tmdbId'>, r: Pick<Release, 'trackerName' | 'title'>) => `anime|${t.tmdbType}:${t.tmdbId}|${r.trackerName}|${r.title}`;

export function animeInput(t: Title, r: Pick<Release, 'trackerName' | 'title'>, cands: AbsoluteCandidate[], info: TitleInfo): DecideInput {
  const seasonsText = info.seasons.filter((s) => s.number > 0).map((s) => `сезон ${s.number} — ${s.episodeCount} серий`).join(', ');
  return {
    key: animeKey(t, r),
    state: { аниме: t.nameRu, раздача: r.title, сезоны: seasonsText },
    question: { type: 'choice', instructions: 'Какой сезон и серия в этой раздаче?', criteria: Object.fromEntries(cands.map((c) => [c.label, c.label.replace(/^S0?(\d+)E0?(\d+)/, 'сезон $1, серия $2')])) },
    features: [cands.length],
  };
}

/** Выбранная Laya раскладка (или null — эвристика как раньше). */
export function applyAnimeDecision(cands: AbsoluteCandidate[], d: Decision<string> | null): ParsedRelease | null {
  if (!d || d.by !== 'laya' || !d.sure) return null;
  return cands.find((c) => c.label === d.answer)?.parsed ?? null;
}

/** Сквозная нумерация, которую нельзя разложить однозначно: Laya выбирает сезон и серию. */
export async function reviewAnime(db: Db, t: Title, rows: Release[], o: { budget: Budget; client?: LayaClient }): Promise<Release[]> {
  if (t.kind !== 'anime') return rows;
  const info = toTitleInfo(t, listSeasons(db, t.id));
  const out: Release[] = [];
  for (const r of rows) {
    const cands = absoluteCandidates(parseRelease(r.title, r.attrs, { id: r.trackerName.toLowerCase(), name: r.trackerName }, []), info);
    if (cands.length < 2) {
      out.push(r);
      continue;
    }
    const chosen = applyAnimeDecision(cands, await decide<string>(db, 'anime', animeInput(t, r, cands, info), o));
    if (!chosen) {
      out.push(r);
      continue;
    }
    // студии и качество — из текущего разбора, сезон и серия — из выбора
    const parsed = { ...r.parsed, seasons: chosen.seasons, episodes: chosen.episodes, absolute: false, pack: chosen.pack };
    db.update(releasesT).set({ parsed }).where(eq(releasesT.id, r.id)).run();
    out.push({ ...r, parsed });
  }
  return out;
}

/** Варианты нумерации раздачи и текущий выбор (для исправления вручную); null — раскладка однозначна. */
export function animeChoices(db: Db, t: Title, r: Release): { current: string; options: string[] } | null {
  if (t.kind !== 'anime') return null;
  const info = toTitleInfo(t, listSeasons(db, t.id));
  const cands = absoluteCandidates(parseRelease(r.title, r.attrs, { id: r.trackerName.toLowerCase(), name: r.trackerName }, []), info);
  if (cands.length < 2) return null;
  const cur = cands.find((c) => c.parsed.seasons[0] === r.parsed.seasons[0] && c.parsed.episodes?.from === r.parsed.episodes?.from && c.parsed.episodes?.to === r.parsed.episodes?.to);
  return { current: cur?.label ?? cands[0].label, options: cands.map((c) => c.label) };
}

/** Пользователь исправил нумерацию: пример (тот же вопрос, что у Laya) — окончательный ответ; раздачи переразбираются. */
export function correctAnime(db: Db, titleId: number, releaseId: number, label: string, now = Date.now()) {
  const t = db.select().from(titlesT).where(eq(titlesT.id, titleId)).get();
  const r = db.select().from(releasesT).where(eq(releasesT.id, releaseId)).get();
  if (!t || !r || r.titleId !== titleId) throw new Error('Раздача не найдена');
  const info = toTitleInfo(t, listSeasons(db, t.id));
  const cands = absoluteCandidates(parseRelease(r.title, r.attrs, { id: r.trackerName.toLowerCase(), name: r.trackerName }, []), info);
  if (!cands.some((c) => c.label === label)) throw new Error('Нет такого варианта');
  const { key, ...input } = animeInput(t, r, cands, info);
  const asked = db.select().from(layaAnswers).where(and(eq(layaAnswers.task, 'anime'), eq(layaAnswers.key, key))).all().at(-1);
  addExample(db, { task: 'anime', key, input, label, laya: asked ? { answer: asked.answer, p: asked.p, raw: asked.raw, model: asked.model || undefined } : null, source: 'correction', title: r.title, now });
  reparseReleases(db, titleId);
}
