import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { releases as releasesT, type Release, type Title } from '../db/schema';
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
