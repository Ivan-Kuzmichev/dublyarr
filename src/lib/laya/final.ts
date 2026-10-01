import type { Db } from '../db/client';
import type { Release, Title } from '../db/schema';
import type { Verdict } from '../evaluate';
import { formatSize } from '../format';
import type { LayaClient } from './client';
import { decide, type Budget, type DecideInput } from './decide';

// Финальная проверка перед загрузкой (spec §3): «это S01E03 сериала X в озвучке Y?» — до трёх лучших раздач.

const MAX_CHECKS = 3;
const pct = (p: number) => `${Math.round(p * 100)} %`;

/**
 * Что проверяем: сериал/фильм; код для ключа вопроса — у пака один на раздачу («S01»), у серии «S01E03», у фильма «фильм»;
 * текст для вопроса и озвучка (по позиции профиля раздачи).
 */
export type FinalTarget = { title: Title; codeOf: (r: Release) => string; what: string; dubOf: (v: Verdict, r: Release) => string; today: string };

export function finalInput(t: { title: Title; code: string; what: string; dub: string }, r: Release): DecideInput {
  const name = `${t.title.nameRu}${t.title.nameOriginal && t.title.nameOriginal !== t.title.nameRu ? ` (${t.title.nameOriginal})` : ''}${t.title.year ? `, ${t.title.year}` : ''}`;
  return {
    key: `final|${t.title.tmdbType}:${t.title.tmdbId}|${t.code}|${t.dub}|${r.trackerName}|${r.title}|${r.size}`,
    state: { [t.title.kind === 'movie' ? 'фильм' : 'сериал']: name, нужно: `${t.what} в озвучке ${t.dub}`, раздача: r.title, размер: formatSize(r.size) },
    question: { type: 'noul', instructions: `Это ${t.what} ${t.title.kind === 'movie' ? 'фильма' : 'сериала'} «${t.title.nameRu}» в озвучке ${t.dub}?` },
    features: [r.match.score],
  };
}

/**
 * Проверить лучшие подходящие раздачи по очереди (не больше трёх). «Да» — она и качается; «нет» / «не уверена» — следующая;
 * все три не прошли — ничего не качаем, вопрос пользователю. Laya недоступна или задача выключена — вердикты как были.
 */
export async function finalChecks(db: Db, verdicts: Verdict[], byId: Map<number, Release>, t: FinalTarget, o: { budget: Budget; client?: LayaClient }): Promise<Verdict[]> {
  const best = verdicts.find((v) => v.best);
  if (!best) return verdicts;
  const order = [best, ...verdicts.filter((v) => v.ok && v !== best)];
  const out = new Map(verdicts.map((v) => [v.releaseId, { ...v }]));
  const failed: number[] = [];
  for (const v of order.slice(0, MAX_CHECKS)) {
    const r = byId.get(v.releaseId);
    if (!r) continue;
    const dub = t.dubOf(v, r);
    const d = await decide<boolean>(db, 'final', finalInput({ title: t.title, code: t.codeOf(r), what: t.what, dub }, r), o);
    if (d.by === 'budget') {
      // вопросы на этот проход кончились — непроверенное не качаем, проверим на следующем поиске
      for (const x of out.values()) if (x.ok) Object.assign(x, { ok: false, best: false, tone: 'wait' as const, until: t.today, reason: 'Ждём проверку Laya' });
      return verdicts.map((x) => out.get(x.releaseId)!);
    }
    if (d.by === 'rules' || (d.by === 'laya' && d.sure && d.answer)) {
      // проверено или проверить нечем — эта раздача лучшая
      for (const x of out.values()) x.best = x.releaseId === v.releaseId;
      Object.assign(out.get(v.releaseId)!, { best: true, tone: 'best' as const });
      return verdicts.map((x) => out.get(x.releaseId)!);
    }
    failed.push(v.releaseId);
    Object.assign(out.get(v.releaseId)!, { ok: false, best: false, tone: 'reject' as const, reason: d.sure ? `Laya: не то · ${pct(1 - d.p)}` : `Laya не уверена · ${pct(Math.max(d.p, 1 - d.p))}` });
  }
  if (!failed.length) return verdicts;
  // ни одна не прошла — сомнительное не качаем: вопрос пользователю
  for (const x of out.values()) if (x.ok) Object.assign(x, { ok: false, best: false, tone: 'reject' as const, reason: 'Не проверена: Laya отклонила лучшие' });
  const first = out.get(failed[0])!;
  Object.assign(first, { tone: 'ask' as const, reason: `Laya не уверена, что это ${t.what} в озвучке ${t.dubOf(first, byId.get(first.releaseId)!)}` });
  return verdicts.map((x) => out.get(x.releaseId)!);
}
