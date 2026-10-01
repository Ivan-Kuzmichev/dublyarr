import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { layaAnswers, releases as releasesT, studios as studiosT, type Release, type Studio, type Title } from '../db/schema';
import { listStudios, normalizeStudio, StudioError, updateStudio } from '../studios';
import { dice } from '../match';
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
  if (d.sure) return { ...m, level: 'reject', reasons: [`Laya: не тот · ${pct(1 - d.p)}`], laya };
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
  let changed = false;
  const seen = new Set<string>();
  for (const r of rows)
    for (const label of unknownLabels(r)) {
      if (seen.has(normalizeStudio(label))) continue;
      seen.add(normalizeStudio(label));
      const d = await decide<string>(db, 'studio', studioInput(db, t, r, label), o);
      if (d.by !== 'laya' || !d.sure || d.answer === 'новая') continue;
      const s = listStudios(db).find((x) => x.name === d.answer);
      if (!s) continue;
      try {
        updateStudio(db, s.id, { name: s.name, aliases: [...s.aliases, label], kind: s.kind, trackers: s.trackers });
        db.update(studiosT).set({ layaAliases: [...s.layaAliases, label] }).where(eq(studiosT.id, s.id)).run();
        changed = true;
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
