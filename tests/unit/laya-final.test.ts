import { describe, expect, test } from 'vitest';
import { testDb } from './helpers';
import { finalChecks } from '@/lib/laya/final';
import { setSetting } from '@/lib/settings';
import type { Verdict } from '@/lib/evaluate';
import type { Release, Title } from '@/lib/db/schema';
import type { LayaClient } from '@/lib/laya/client';

const t = { id: 1, tmdbId: 1399, tmdbType: 'tv', kind: 'series', nameRu: 'Игра престолов', nameOriginal: 'Game of Thrones', year: 2011 } as Title;
const rel = (id: number) => ({ id, title: `GoT S01E03 v${id}`, trackerName: 'RT', size: 2 * 1024 ** 3, match: { score: 0.9, level: 'match', reasons: [] } }) as unknown as Release;
const byId = new Map([1, 2, 3, 4].map((i) => [i, rel(i)]));
const v = (id: number, o: Partial<Verdict> = {}): Verdict => ({ releaseId: id, ok: true, best: id === 1, reason: 'Подходит', position: 0, tone: id === 1 ? 'best' : 'ok', ...o });
const verdicts = () => [v(1), v(2), v(3), v(4), v(9, { ok: false, best: false, tone: 'reject', reason: 'Экранка' })];
const answers = (ps: (number | null)[]) => {
  const asked: string[] = [];
  let i = 0;
  return {
    asked,
    client: {
      ask: async (state: { раздача: string }) => {
        asked.push(state.раздача);
        const p = ps[i++];
        return p === null || p === undefined ? null : { answers: { q: { noul: p } }, ms: 1 };
      },
      health: async () => null,
      last: () => 1,
    } as unknown as LayaClient,
  };
};
const target = { title: t, code: 'S01E03', what: 'серия 3 сезона 1', dubOf: () => 'LostFilm' };
const run = (db: ReturnType<typeof testDb>, ps: (number | null)[]) => {
  const a = answers(ps);
  return finalChecks(db, verdicts(), byId, target, { budget: { left: 20 }, client: a.client }).then((r) => ({ r, asked: a.asked }));
};
const best = (vs: Verdict[]) => vs.find((x) => x.best)?.releaseId;

describe('финальная проверка', () => {
  test('«да» — качаем лучшую; вопрос о нужной серии и озвучке', async () => {
    const db = testDb();
    const { r, asked } = await run(db, [0.95]);
    expect(best(r)).toBe(1);
    expect(asked).toEqual(['GoT S01E03 v1']);
  });
  test('лучшая — «нет», вторая — «да»: качаем вторую', async () => {
    const db = testDb();
    const { r } = await run(db, [0.05, 0.93]);
    expect(best(r)).toBe(2);
    expect(r.find((x) => x.releaseId === 1)).toMatchObject({ ok: false, tone: 'reject', reason: 'Laya: не то · 95 %' });
  });
  test('три «нет»/«не уверена» — ничего не качаем, вопрос пользователю; четвёртую не проверяем', async () => {
    const db = testDb();
    const { r, asked } = await run(db, [0.05, 0.6, 0.1]);
    expect(asked).toHaveLength(3);
    expect(best(r)).toBeUndefined();
    expect(r.filter((x) => x.ok)).toEqual([]);
    expect(r.find((x) => x.tone === 'ask')).toMatchObject({ releaseId: 1, reason: 'Laya не уверена, что это серия 3 сезона 1 в озвучке LostFilm' });
  });
  test('Laya недоступна или задача выключена — как раньше (качаем лучшую без проверки)', async () => {
    const db = testDb();
    expect(best((await run(db, [null])).r)).toBe(1);
    const off = testDb();
    setSetting(off, 'laya', { tasks: { final: false } });
    const o = await run(off, [0.01]);
    expect(best(o.r)).toBe(1);
    expect(o.asked).toEqual([]);
  });
  test('лучшей нет — нечего проверять', async () => {
    const db = testDb();
    const a = answers([0.9]);
    const vs = [v(9, { ok: false, best: false, tone: 'wait', until: '2026-10-05' })];
    expect(await finalChecks(db, vs, byId, target, { budget: { left: 20 }, client: a.client })).toEqual(vs);
    expect(a.asked).toEqual([]);
  });
});
