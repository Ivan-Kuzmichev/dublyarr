import { describe, expect, test } from 'vitest';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { testDb } from './helpers';
import { metrics, splitHoldout, trainAdapter } from '@/lib/laya/adapter';
import { trainVersion, rollback, trainingDue } from '@/lib/laya/versions';
import { currentAdapters } from '@/lib/laya/adapter';
import { beat } from '@/lib/heartbeat';
import { layaExamples, layaVersions } from '@/lib/db/schema';
import type { LayaClient } from '@/lib/laya/client';

// Примеры «тот ли сериал»: Laya почти не различает (p ≈ 0,5), а оценка правил (признак) — различает
const rows = (n: number, seed = 1) =>
  Array.from({ length: n }, (_, i) => {
    const label = (i * 7 + seed) % 2 === 0;
    return { id: i + 1, pLaya: 0.4, features: [label ? 0.7 + (i % 3) / 20 : 0.55 - (i % 3) / 20], label };
  });

describe('адаптер', () => {
  test('учится различать по признакам; разбиение 80/20 детерминировано по id', () => {
    const { train, test: hold } = splitHoldout(rows(100));
    expect(hold.map((r) => r.id)).toEqual(rows(100).filter((r) => r.id % 5 === 0).map((r) => r.id));
    expect(train).toHaveLength(80);
    const a = trainAdapter(train);
    expect(metrics(a, hold, 0.85).accuracy).toBeGreaterThanOrEqual(0.9);
    expect(metrics(null, hold, 0.85).accuracy).toBeLessThan(0.7);
  });
});

const READY = { status: 'ready', laya: '0.3.22', model: 'm@1' };
function setup(n = 40, mk: (i: number) => { p: number; label: boolean; score: number } = (i) => ({ p: 0.5, label: i % 2 === 0, score: i % 2 === 0 ? 0.75 : 0.5 })) {
  const db = testDb();
  const dir = mkdtempSync(path.join(tmpdir(), 'dy-laya-'));
  beat(db, 'laya', true, JSON.stringify(READY));
  for (let i = 0; i < n; i++) {
    const e = mk(i);
    db.insert(layaExamples).values({ task: 'match', key: `k${i}`, input: { state: {}, question: { type: 'noul', instructions: 'x' }, features: [e.score] }, label: e.label, laya: { answer: e.p >= 0.5, p: e.p, raw: e.p }, source: 'match-answer', createdAt: 1000 + i }).run();
  }
  return { db, dir };
}

describe('версии', () => {
  test('лучше базовой — версия 1 на диске и в базе, текущая; адаптер применяется', async () => {
    const { db, dir } = setup();
    const r = await trainVersion(db, dir, { now: 5000 });
    expect(r).toMatchObject({ applied: true, version: 1 });
    expect(existsSync(path.join(dir, 'versions', '1', 'adapters.json'))).toBe(true);
    expect(db.select().from(layaVersions).get()).toMatchObject({ number: 1, current: true, examples: 40, laya: '0.3.22', model: 'm@1' });
    expect(currentAdapters(db).adapters.match).not.toBeNull();
  });
  test('мало новых примеров — не учимся (кроме «Обучить сейчас»); меньше 10 по задаче — адаптера нет', async () => {
    const { db, dir } = setup(12);
    expect(await trainVersion(db, dir, { now: 5000 })).toMatchObject({ applied: false, reason: 'Мало новых примеров: 12 из 30' });
    const few = setup(8);
    expect(await trainVersion(few.db, few.dir, { now: 5000, force: true })).toMatchObject({ applied: false, reason: 'Мало примеров для обучения' });
  });
  test('новая версия хуже на проверке — не применяется, текущая остаётся', async () => {
    const { db, dir } = setup();
    await trainVersion(db, dir, { now: 5000 });
    // новые обучающие примеры перевёрнуты (ошибки разметки), проверочные (id % 5 = 0) — как раньше: новая версия хуже
    for (let i = 40; i < 120; i++) {
      const hold = (i + 1) % 5 === 0;
      const label = i % 2 === 0;
      const score = (hold ? label : !label) ? 0.75 : 0.5;
      db.insert(layaExamples).values({ task: 'match', key: `k${i}`, input: { state: {}, question: {}, features: [score] }, label, laya: { answer: true, p: 0.5, raw: 0.5 }, source: 'match-answer', createdAt: 6000 + i }).run();
    }
    const r = await trainVersion(db, dir, { now: 9000 });
    expect(r).toMatchObject({ applied: false, reason: 'Новая версия хуже на проверке' });
    expect(db.select().from(layaVersions).all().map((v) => [v.number, v.current])).toEqual([[1, true]]);
  });
  test('хранятся 3 последние; откат на прошлую и на базовую', async () => {
    const { db, dir } = setup(40);
    for (let k = 0; k < 4; k++) await trainVersion(db, dir, { now: 5000 + k, force: true });
    expect(db.select().from(layaVersions).all().map((v) => v.number)).toEqual([2, 3, 4]);
    expect(readdirSync(path.join(dir, 'versions')).sort()).toEqual(['2', '3', '4']);
    rollback(db, dir, 3);
    expect(currentAdapters(db).version).toBe(3);
    rollback(db, dir, 'base');
    expect(currentAdapters(db)).toEqual({ version: 0, adapters: {} });
  });
  test('обновилась библиотека или модель — базовая и переобучение на всех примерах в ночное окно', async () => {
    const { db, dir } = setup();
    await trainVersion(db, dir, { now: 5000 });
    beat(db, 'laya', true, JSON.stringify({ ...READY, laya: '0.4.0' }));
    expect(currentAdapters(db).version).toBe(0);
    const night = new Date('2026-10-02T02:00:00');
    expect(trainingDue(db, night)).toBe(true); // несовместимо — без порога 30
    expect(trainingDue(db, new Date('2026-10-02T14:00:00'))).toBe(false); // только ночью
    const r = await trainVersion(db, dir, { now: 9000 });
    expect(r).toMatchObject({ applied: true, version: 2 });
    expect(db.select().from(layaVersions).all().find((v) => v.number === 2)).toMatchObject({ laya: '0.4.0', examples: 40 });
  });
  test('примеры без ответа Laya — спрашиваем её перед обучением', async () => {
    const { db, dir } = setup(0);
    for (let i = 0; i < 30; i++) db.insert(layaExamples).values({ task: 'match', key: `q${i}`, input: { state: { i }, question: { type: 'noul', instructions: 'x' }, features: [i % 2 ? 0.5 : 0.75] }, label: i % 2 === 0, laya: null, source: 'match-answer', createdAt: 1000 + i }).run();
    let asked = 0;
    const client = { ask: async () => (asked++, { answers: { q: { noul: 0.5 } }, ms: 1 }), health: async () => null, last: () => 1 } as unknown as LayaClient;
    await trainVersion(db, dir, { now: 5000, client });
    expect(asked).toBe(30);
    expect(db.select().from(layaExamples).all().every((e) => e.laya !== null)).toBe(true);
  });
});

describe('исправления по ревью', () => {
  test('адаптер сходится, когда Laya уверена (большой logit): лучше, чем без адаптера', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, pLaya: 0.99995, features: [0.8], label: i % 5 !== 0 }));
    const a = trainAdapter(rows);
    expect(metrics(a, rows, 0.85).logLoss).toBeLessThan(metrics(null, rows, 0.85).logLoss);
    expect(metrics(a, rows, 0.85).logLoss).toBeLessThan(0.6);
  });
  test('после смены модели примеры переспрашиваются у новой модели (не больше 50 за раз)', async () => {
    const { db, dir } = setup(60);
    await trainVersion(db, dir, { now: 5000 });
    beat(db, 'laya', true, JSON.stringify({ ...READY, model: 'm@2' }));
    let asked = 0;
    const client = { ask: async () => (asked++, { answers: { q: { noul: 0.5 } }, ms: 1 }), health: async () => null, last: () => 1 } as unknown as LayaClient;
    await trainVersion(db, dir, { now: 9000, client });
    expect(asked).toBe(50);
    expect(db.select().from(layaExamples).all().filter((e) => e.laya?.model === 'm@2')).toHaveLength(50);
  });
});
