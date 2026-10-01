import { describe, expect, test } from 'vitest';
import { testDb } from './helpers';
import { createLayaClient } from '@/lib/laya/client';
import { getLayaSettings, parseLayaForm } from '@/lib/laya/settings';
import { beat, serviceStatuses } from '@/lib/heartbeat';

const Q = { m: { type: 'noul' as const, instructions: 'Тот же сериал?' } };

describe('клиент Laya', () => {
  test('ответ и время последнего ответа', async () => {
    const calls: string[] = [];
    const c = createLayaClient({ port: 1, fetchImpl: (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return Response.json({ answers: { m: { noul: 0.8 } }, ms: 420 });
    }) as typeof fetch });
    expect(await c.ask({ a: 1 }, Q)).toEqual({ answers: { m: { noul: 0.8 } }, ms: 420 });
    expect(calls).toEqual(['POST http://127.0.0.1:1/ask']);
    expect(c.last()).toBe(420);
  });
  test('неполный ответ, 503, ошибка сети — недоступна (null)', async () => {
    const r = (body: unknown, status = 200) => createLayaClient({ port: 1, fetchImpl: (async () => Response.json(body, { status })) as typeof fetch });
    expect(await r({ answers: {} }).ask({}, Q)).toBeNull();
    expect(await r({ error: 'downloading' }, 503).ask({}, Q)).toBeNull();
    const net = createLayaClient({ port: 1, fetchImpl: (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch });
    expect(await net.ask({}, Q)).toBeNull();
  });
  test('таймаут 10 с; три подряд — пауза 10 минут без запросов', async () => {
    let now = 0;
    let calls = 0;
    const hang = (async (_u: string, init?: RequestInit) => {
      calls++;
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    }) as typeof fetch;
    const c = createLayaClient({ port: 1, fetchImpl: hang, timeoutMs: 20, now: () => now });
    for (let i = 0; i < 3; i++) expect(await c.ask({}, Q)).toBeNull();
    expect(calls).toBe(3);
    expect(await c.ask({}, Q)).toBeNull();
    expect(calls).toBe(3);
    now = 10 * 60_000 + 1;
    await c.ask({}, Q);
    expect(calls).toBe(4);
  });
  test('здоровье', async () => {
    const c = createLayaClient({ port: 1, fetchImpl: (async () => Response.json({ status: 'downloading', laya: '0.3.22' })) as typeof fetch });
    expect(await c.health()).toEqual({ status: 'downloading', laya: '0.3.22' });
    const dead = createLayaClient({ port: 1, fetchImpl: (async () => { throw new Error('x'); }) as typeof fetch });
    expect(await dead.health()).toBeNull();
  });
});

describe('статус и настройки', () => {
  test('«Сервисы»: готова — работает; скачивает модель; загружает; ошибка — недоступна', () => {
    const db = testDb();
    const laya = () => serviceStatuses(db, 1000).find((s) => s.name === 'Laya');
    beat(db, 'laya', true, JSON.stringify({ status: 'ready', runtime: 'torch' }), 1000);
    expect(laya()).toMatchObject({ state: 'ok', note: 'работает' });
    beat(db, 'laya', true, JSON.stringify({ status: 'downloading' }), 1000);
    expect(laya()).toMatchObject({ state: 'warn', note: 'скачивает модель' });
    beat(db, 'laya', true, JSON.stringify({ status: 'loading' }), 1000);
    expect(laya()).toMatchObject({ state: 'warn', note: 'загружает модель' });
    beat(db, 'laya', true, JSON.stringify({ status: 'error', error: 'нет сети' }), 1000);
    expect(laya()).toMatchObject({ state: 'warn', note: 'недоступна' });
  });
  test('настройки по умолчанию и разбор формы', () => {
    const db = testDb();
    expect(getLayaSettings(db)).toEqual({ tasks: { studio: true, match: true, anime: true, final: true }, threshold: 0.85 });
    const f = (o: Record<string, string>) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(o)) fd.set(k, v);
      return parseLayaForm(fd);
    };
    expect(f({ studio: 'on', final: 'on', threshold: '90' })).toEqual({ tasks: { studio: true, match: false, anime: false, final: true }, threshold: 0.9 });
    expect(f({ threshold: '40' })).toEqual({ error: 'Порог — от 50 до 99 %' });
  });
});
