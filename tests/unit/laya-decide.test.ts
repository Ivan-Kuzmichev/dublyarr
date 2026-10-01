import { describe, expect, test } from 'vitest';
import { testDb } from './helpers';
import { decide, type Budget } from '@/lib/laya/decide';
import { applyAdapter, currentAdapters } from '@/lib/laya/adapter';
import { setSetting } from '@/lib/settings';
import { beat } from '@/lib/heartbeat';
import { layaVersions } from '@/lib/db/schema';
import type { LayaClient } from '@/lib/laya/client';

const fake = (answer: Record<string, unknown> | null) => {
  const calls: unknown[] = [];
  const client = { ask: async (state: unknown) => (calls.push(state), answer ? { answers: { q: answer }, ms: 5 } : null), health: async () => null, last: () => 5 } as unknown as LayaClient;
  return { client, calls };
};
const noul = { type: 'noul' as const, instructions: 'Тот же сериал?' };
const choice = { type: 'choice' as const, instructions: 'Какая студия?', criteria: { LostFilm: 'LostFilm', новая: 'нет в списке' } };
const budget = (left = 20): Budget => ({ left });
const input = (key = 'k1', q: typeof noul | typeof choice = noul, features: number[] = [0.7]) => ({ key, state: { a: key }, question: q, features });

describe('решение Laya', () => {
  test('да/нет: уверенно «да», уверенно «нет», не уверена', async () => {
    const db = testDb();
    expect(await decide(db, 'match', input('a'), { budget: budget(), client: fake({ noul: 0.92 }).client })).toEqual({ by: 'laya', answer: true, p: 0.92, raw: 0.92, sure: true });
    expect(await decide(db, 'match', input('b'), { budget: budget(), client: fake({ noul: 0.1 }).client })).toMatchObject({ answer: false, sure: true });
    expect(await decide(db, 'match', input('c'), { budget: budget(), client: fake({ noul: 0.7 }).client })).toMatchObject({ answer: true, sure: false });
  });
  test('выбор: ответ и уверенность выбранного варианта', async () => {
    const db = testDb();
    const r = await decide(db, 'studio', input('s', choice), { budget: budget(), client: fake({ choice: 'LostFilm', probabilities: { LostFilm: 0.88, новая: 0.12 } }).client });
    expect(r).toEqual({ by: 'laya', answer: 'LostFilm', p: 0.88, raw: 0.88, sure: true });
  });
  test('задача выключена, Laya недоступна, бюджет исчерпан — правила', async () => {
    const db = testDb();
    setSetting(db, 'laya', { tasks: { match: false } });
    const f = fake({ noul: 0.99 });
    expect(await decide(db, 'match', input(), { budget: budget(), client: f.client })).toEqual({ by: 'rules' });
    expect(f.calls).toEqual([]);
    expect(await decide(db, 'final', input(), { budget: budget(), client: fake(null).client })).toEqual({ by: 'rules' });
    const b = budget(0);
    expect(await decide(db, 'final', input('z'), { budget: b, client: f.client })).toEqual({ by: 'rules' });
  });
  test('кэш: повторный вопрос без запроса и без траты бюджета; порог из настроек', async () => {
    const db = testDb();
    const f = fake({ noul: 0.9 });
    const b = budget(1);
    await decide(db, 'match', input('x'), { budget: b, client: f.client });
    expect(b.left).toBe(0);
    expect(await decide(db, 'match', input('x'), { budget: b, client: f.client })).toMatchObject({ by: 'laya', p: 0.9 });
    expect(f.calls).toHaveLength(1);
    setSetting(db, 'laya', { threshold: 0.95 });
    expect(await decide(db, 'match', input('x'), { budget: b, client: f.client })).toMatchObject({ sure: false });
  });
});

describe('адаптер', () => {
  test('без адаптера — вероятность Laya; с весами — сигмоида признаков', () => {
    expect(applyAdapter(null, 0.7, [1])).toBe(0.7);
    expect(applyAdapter({ w: [1, 0], b: 0 }, 0.7, [5])).toBeCloseTo(0.7, 6);
    expect(applyAdapter({ w: [0, 2], b: -1 }, 0.5, [1])).toBeCloseTo(1 / (1 + Math.exp(-1)), 6);
  });
  test('текущая версия применяется, только если совместима с моделью; новая версия — новые вопросы', async () => {
    const db = testDb();
    db.insert(layaVersions).values({ number: 1, createdAt: 1, examples: 40, laya: '0.3.22', model: 'm@1', current: true, adapters: { match: { w: [0, 3], b: 0 } }, metrics: {} }).run();
    beat(db, 'laya', true, JSON.stringify({ status: 'ready', laya: '0.3.22', model: 'm@1' }));
    expect(currentAdapters(db)).toMatchObject({ version: 1, adapters: { match: { w: [0, 3], b: 0 } } });
    const f = fake({ noul: 0.5 });
    const r = await decide(db, 'match', input('v', noul, [1]), { budget: budget(), client: f.client });
    expect(r).toMatchObject({ raw: 0.5, sure: true, answer: true });
    beat(db, 'laya', true, JSON.stringify({ status: 'ready', laya: '0.4.0', model: 'm@1' }));
    expect(currentAdapters(db)).toEqual({ version: 0, adapters: {} }); // обновилась библиотека — базовая
    await decide(db, 'match', input('v', noul, [1]), { budget: budget(), client: f.client });
    expect(f.calls).toHaveLength(2);
  });
});
