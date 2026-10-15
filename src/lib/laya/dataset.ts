import { createHash } from 'node:crypto';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { downloads, layaExamples, releases, studios, titles, type Release, type Title } from '../db/schema';
import { normalizeTitle } from '../parse/normalize';
import { ruleFor } from '../release-rules';
import { matchInput, matchKey, studioInput, titleContext, type TitleContext } from './review';
import { finalInput } from './final';

// Обучающий набор для дообучения голов Laya (laya-train/): строки — ровно те вопросы, что Dublyarr задаёт Laya в бою.

export type DatasetTask = 'match' | 'studio' | 'anime' | 'final';
export type DatasetSource = 'user' | 'rule' | 'download' | 'alias' | 'pair';
export type DatasetRow = {
  task: DatasetTask;
  group: string; // сериал (tv:1399) или подпись студии — разбиение на обучение/проверку без утечки
  source: DatasetSource;
  state: unknown;
  question: unknown;
  target: boolean | string;
};

const RANK: Record<DatasetSource, number> = { user: 0, rule: 1, download: 2, alias: 3, pair: 4 };
const PER_GROUP = 200;
const pad = (n: number) => String(n).padStart(2, '0');
const groupOf = (t: Pick<Title, 'tmdbType' | 'tmdbId'>) => `${t.tmdbType}:${t.tmdbId}`;
const hash = (s: string) => createHash('sha1').update(s).digest('hex');
const names = (t: Title) => new Set([t.nameRu, t.nameOriginal, ...(t.altNames ?? [])].filter(Boolean).map((n) => normalizeTitle(n!)));

export function buildDataset(db: Db, o: { perGroup?: number; seed?: number } = {}): DatasetRow[] {
  const perGroup = o.perGroup ?? PER_GROUP;
  const seed = String(o.seed ?? 1);
  const all = db.select().from(titles).all();
  const byId = new Map(all.map((t) => [t.id, t]));
  const studioList = db.select().from(studios).all();
  const ctxs = new Map<number, TitleContext>();
  const ctx = (t: Title) => ctxs.get(t.id) ?? ctxs.set(t.id, titleContext(db, t)).get(t.id)!;
  const out = new Map<string, DatasetRow>();
  const add = (row: DatasetRow) => {
    const k = `${row.task}|${JSON.stringify(row.state)}|${JSON.stringify(row.question)}`;
    const prev = out.get(k);
    if (!prev || RANK[row.source] < RANK[prev.source]) out.set(k, row);
  };

  const rels = db.select().from(releases).all();
  // «тот ли сериал» до 2.5 спрашивали коротко — по ключу находим раздачу и задаём вопрос в нынешнем виде
  const byMatchKey = new Map(rels.flatMap((r) => (byId.has(r.titleId) ? [[matchKey(byId.get(r.titleId)!, r), r] as const] : [])));

  // 1. ответы пользователя — как есть (вопрос «тот ли сериал» — в нынешнем виде, если раздача ещё в базе)
  for (const e of db.select().from(layaExamples).all()) {
    if (!['match', 'studio', 'anime', 'final'].includes(e.task)) continue;
    const g = /(?:tv|movie):\d+/.exec(e.key)?.[0] ?? e.key;
    const r = e.task === 'match' ? byMatchKey.get(e.key) : undefined;
    const q = r ? matchInput(byId.get(r.titleId)!, r, ctx(byId.get(r.titleId)!)) : null;
    add({ task: e.task as DatasetTask, group: g, source: 'user', state: q?.state ?? e.input.state, question: q?.question ?? e.input.question, target: e.label });
  }

  // 2. правила «это он / не тот сериал»
  for (const r of rels) {
    const t = byId.get(r.titleId);
    if (!t) continue;
    const v = ruleFor(db, t.id, r.trackerName, r.title);
    if (!v) continue;
    const m = matchInput(t, r, ctx(t));
    add({ task: 'match', group: groupOf(t), source: 'rule', state: m.state, question: m.question, target: v === 'match' });
  }

  // 3. скачанное и импортированное: тот сериал — да; финальная проверка серии/сезона в озвучке загрузки — да
  const relById = new Map(rels.map((r) => [r.id, r]));
  const positives: { t: Title; r: Release; dub: string; code: string; what: string }[] = [];
  for (const d of db.select().from(downloads).where(and(eq(downloads.state, 'imported'), isNotNull(downloads.releaseId))).all()) {
    const r = relById.get(d.releaseId!);
    const t = byId.get(d.titleId);
    if (!r || !t) continue;
    const m = matchInput(t, r, ctx(t));
    add({ task: 'match', group: groupOf(t), source: 'download', state: m.state, question: m.question, target: true });
    if (t.kind === 'movie') continue;
    const dub = d.studioLabel ?? 'любой';
    const targets =
      d.kind === 'season'
        ? [{ code: `S${pad(d.season)}`, what: `весь ${d.season} сезон` }]
        : d.episodes.map((e) => ({ code: r.parsed.pack ? `S${pad(e.season)}` : `S${pad(e.season)}E${pad(e.number)}`, what: `серия ${e.number} сезона ${e.season}` }));
    for (const x of targets) {
      const f = finalInput({ title: t, code: x.code, what: x.what, dub }, r, ctx(t));
      add({ task: 'final', group: groupOf(t), source: 'download', state: f.state, question: f.question, target: true });
      positives.push({ t, r, dub, ...x });
    }
  }

  // 4. студии: подпись в заголовке, совпавшая со студией словаря
  for (const r of rels) {
    const t = byId.get(r.titleId);
    if (!t) continue;
    for (const d of r.parsed.dubs ?? []) {
      if (d.by !== 'title' || d.studioId === null) continue;
      const s = studioList.find((x) => x.id === d.studioId);
      const label = (r.title.match(new RegExp(`[^\\p{L}\\p{N}]?(${[s?.name, ...(s?.aliases ?? [])].filter(Boolean).map((v) => v!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}\\p{N}])`, 'iu'))?.[1] ?? d.label).trim();
      if (!s || !label) continue;
      const q = studioInput(db, t, r, label);
      if (!(q.question as { criteria?: Record<string, string> }).criteria?.[s.name]) continue; // студии нет среди вариантов — не пример
      add({ task: 'studio', group: groupOf(t), source: 'alias', state: q.state, question: q.question, target: s.name });
    }
  }

  // 5. отрицательные пары: раздача сериала A, поставленная к сериалу B (другие названия); чужая студия в финальной проверке
  const positivesMatch = [...out.values()].filter((x) => x.task === 'match' && x.target === true).length;
  let pairsLeft = 2 * positivesMatch;
  const others = (t: Title) => all.filter((b) => b.id !== t.id && b.kind !== 'movie' === (t.kind !== 'movie') && ![...names(b)].some((n) => names(t).has(n)));
  for (const p of positives) {
    if (pairsLeft <= 0) break;
    const cands = others(p.t).sort((x, y) => hash(seed + p.r.id + x.id).localeCompare(hash(seed + p.r.id + y.id)));
    for (const b of cands.slice(0, 2)) {
      if (pairsLeft-- <= 0) break;
      const m = matchInput(b, p.r, ctx(b));
      add({ task: 'match', group: groupOf(b), source: 'pair', state: m.state, question: m.question, target: false });
    }
  }
  const finalsPos = positives.length;
  let wrongDubLeft = finalsPos;
  for (const p of positives) {
    if (wrongDubLeft <= 0) break;
    const inRelease = new Set((p.r.parsed.dubs ?? []).map((d) => d.studioId));
    const other = studioList.filter((s) => s.name !== p.dub && !inRelease.has(s.id)).sort((x, y) => hash(seed + p.r.id + x.id).localeCompare(hash(seed + p.r.id + y.id)))[0];
    if (!other || p.dub === 'любой') continue;
    const f = finalInput({ title: p.t, code: p.code, what: p.what, dub: other.name }, p.r, ctx(p.t));
    add({ task: 'final', group: groupOf(p.t), source: 'pair', state: f.state, question: f.question, target: false });
    wrongDubLeft--;
  }

  // не больше perGroup строк задачи на сериал (детерминированная выборка), надёжные источники — первыми
  const rows = [...out.entries()].sort((a, b) => RANK[a[1].source] - RANK[b[1].source] || hash(seed + a[0]).localeCompare(hash(seed + b[0])));
  const count = new Map<string, number>();
  return rows
    .filter(([, r]) => {
      const k = `${r.task}|${r.group}`;
      const n = (count.get(k) ?? 0) + 1;
      count.set(k, n);
      return n <= perGroup;
    })
    .map(([, r]) => r);
}
