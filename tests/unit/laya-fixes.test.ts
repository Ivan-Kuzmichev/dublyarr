import { describe, expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { decide } from '@/lib/laya/decide';
import { addExample } from '@/lib/laya/examples';
import { beat } from '@/lib/heartbeat';
import { layaVersions } from '@/lib/db/schema';
import type { LayaClient } from '@/lib/laya/client';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const client = (answer: Record<string, unknown>) => {
  let calls = 0;
  return { get calls() { return calls; }, client: { ask: async () => (calls++, { answers: { q: answer }, ms: 1 }), health: async () => null, last: () => 1 } as unknown as LayaClient };
};
const noul = { type: 'noul' as const, instructions: 'Тот же сериал?' };
const input = (key = 'k', features = [1]) => ({ key, state: { k: key }, question: noul, features });

describe('ответ пользователя важнее Laya', () => {
  test('пример по тому же вопросу — решение без запроса и без кэша Laya', async () => {
    const db = testDb();
    const c = client({ noul: 0.95 });
    expect(await decide(db, 'match', input(), { budget: { left: 5 }, client: c.client })).toMatchObject({ answer: true, sure: true });
    addExample(db, { task: 'match', key: 'k', input: { state: {}, question: noul, features: [1] }, label: false, source: 'match-answer' });
    expect(await decide(db, 'match', input(), { budget: { left: 5 }, client: c.client })).toMatchObject({ by: 'laya', answer: false, sure: true, user: true });
    expect(c.calls).toBe(1);
  });
});

describe('кэш — ответ модели, адаптер применяется при чтении', () => {
  test('новая версия адаптеров не требует новых вопросов', async () => {
    const db = testDb();
    beat(db, 'laya', true, JSON.stringify({ status: 'ready', laya: '0.3.22', model: 'm@1' }));
    const c = client({ noul: 0.5 });
    expect(await decide(db, 'match', input('a', [1]), { budget: { left: 5 }, client: c.client })).toMatchObject({ sure: false });
    db.insert(layaVersions).values({ number: 1, createdAt: 1, examples: 40, laya: '0.3.22', model: 'm@1', current: true, adapters: { match: { w: [0, 3], b: 0 } }, metrics: {} }).run();
    expect(await decide(db, 'match', input('a', [1]), { budget: { left: 5 }, client: c.client })).toMatchObject({ sure: true, answer: true, raw: 0.5 });
    expect(c.calls).toBe(1);
    // другая модель — ответы прежней не годятся
    beat(db, 'laya', true, JSON.stringify({ status: 'ready', laya: '0.3.22', model: 'm@2' }));
    await decide(db, 'match', input('a', [1]), { budget: { left: 5 }, client: c.client });
    expect(c.calls).toBe(2);
  });
  test('бюджет кончился — отдельное решение (не «правила»)', async () => {
    const db = testDb();
    expect(await decide(db, 'final', input('z'), { budget: { left: 0 }, client: client({ noul: 0.9 }).client })).toEqual({ by: 'budget' });
  });
});

import { finalChecks } from '@/lib/laya/final';
import { answerMatch } from '@/lib/manual-search';
import { releases, sources, titles, type Release, type Title } from '@/lib/db/schema';
import type { Verdict } from '@/lib/evaluate';

describe('финальная проверка: бюджет, паки, ответ пользователя', () => {
  const setupFinal = () => {
    const db = testDb();
    const t = db.insert(titles).values({ tmdbId: 1399, kind: 'series', nameRu: 'Игра престолов', nameOriginal: 'Game of Thrones', originalLanguage: 'en', year: 2011, status: 'ended', createdAt: 1, refreshedAt: 1 }).returning().get() as Title;
    const s = db.insert(sources).values({ name: 'J', url: 'http://j', createdAt: 1 }).returning().get();
    const mk = (title: string, pack: boolean) =>
      db.insert(releases).values({ titleId: t.id, sourceId: s.id, trackerName: 'RT', title, size: 1, firstSeenAt: 1, lastSeenAt: 1, parsed: { base: 'x', names: [], year: null, seasons: [1], episodes: pack ? null : { from: 3, to: 3 }, totalInSeason: null, absolute: false, pack, resolution: 1080, source: 'webdl', hdr: false, dv: false, screener: false, dubs: [], original: false, subs: false }, match: { score: 0.9, level: 'match', reasons: [] } }).returning().get() as Release;
    return { db, t, mk };
  };
  const target = (t: Title) => ({ title: t, codeOf: (r: Release) => (r.parsed.pack ? 'S01' : 'S01E03'), what: 'серия 3 сезона 1', dubOf: () => 'LostFilm', today: '2026-10-01' });
  const v = (r: Release): Verdict => ({ releaseId: r.id, ok: true, best: true, reason: '', position: 0, tone: 'best' });

  test('кончился бюджет — не качаем непроверенное: ждём следующего поиска', async () => {
    const { db, t, mk } = setupFinal();
    const r = mk('GoT S01E03', false);
    const out = await finalChecks(db, [v(r)], new Map([[r.id, r]]), target(t), { budget: { left: 0 }, client: client({ noul: 0.99 }).client });
    expect(out[0]).toMatchObject({ ok: false, best: false, tone: 'wait', until: '2026-10-01', reason: 'Ждём проверку Laya' });
  });
  test('пак спрашивается один раз на раздачу (не по серии)', async () => {
    const { db, t, mk } = setupFinal();
    const r = mk('GoT S01 pack', true);
    const c = client({ noul: 0.99 });
    for (const what of ['серия 1 сезона 1', 'серия 2 сезона 1', 'серия 3 сезона 1'])
      await finalChecks(db, [v(r)], new Map([[r.id, r]]), { ...target(t), what }, { budget: { left: 5 }, client: c.client });
    expect(c.calls).toBe(1);
  });
  test('«Это он» после отказа Laya — раздача проходит финальную проверку', async () => {
    const { db, t, mk } = setupFinal();
    const r = mk('GoT S01E03', false);
    const no = client({ noul: 0.02 });
    expect((await finalChecks(db, [v(r)], new Map([[r.id, r]]), target(t), { budget: { left: 5 }, client: no.client }))[0].tone).toBe('ask');
    answerMatch(db, t.id, r.id, 'match');
    const fresh = db.select().from(releases).get() as Release;
    const again = await finalChecks(db, [v(fresh)], new Map([[fresh.id, fresh]]), target(t), { budget: { left: 5 }, client: no.client });
    expect(again[0]).toMatchObject({ best: true, ok: true });
    expect(no.calls).toBe(1);
  });
});
