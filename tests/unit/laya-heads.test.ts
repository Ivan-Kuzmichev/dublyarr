import { expect, test } from 'vitest';
import { mkdtempSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { headsAvailable, headsEnabled, reloadLaya, setHeadsEnabled } from '@/lib/laya/heads';

test('дообученные головы: включены по умолчанию; выключение — файл heads.disabled в {DATA_DIR}/laya', () => {
  const data = mkdtempSync(path.join(tmpdir(), 'dy-heads-'));
  expect(headsEnabled(data)).toBe(true);
  setHeadsEnabled(data, false);
  expect(existsSync(path.join(data, 'laya', 'heads.disabled'))).toBe(true);
  expect(headsEnabled(data)).toBe(false);
  setHeadsEnabled(data, true);
  expect(headsEnabled(data)).toBe(true);
});

test('перечитать головы — POST /reload в laya-serve; ответ — какая модель теперь', async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method} ${url}`);
    return new Response(JSON.stringify({ model: 'm@abc+heads-2026-10-15' }), { status: 200 });
  }) as typeof fetch;
  expect(await reloadLaya(8765, fetchImpl)).toBe('m@abc+heads-2026-10-15');
  expect(calls).toEqual(['POST http://127.0.0.1:8765/reload']);
  const down = (async () => {
    throw new Error('ECONNREFUSED');
  }) as typeof fetch;
  expect(await reloadLaya(8765, down)).toBeNull();
});

test('есть ли дообученные головы: свои в {DATA_DIR}/laya/heads или в образе (laya/heads рядом с приложением)', () => {
  const data = mkdtempSync(path.join(tmpdir(), 'dy-heads-'));
  const app = mkdtempSync(path.join(tmpdir(), 'dy-app-'));
  expect(headsAvailable(data, app)).toBe(false);
  mkdirSync(path.join(app, 'laya', 'heads'), { recursive: true });
  writeFileSync(path.join(app, 'laya', 'heads', 'heads.safetensors'), 'x');
  expect(headsAvailable(data, app)).toBe(true);
  const data2 = mkdtempSync(path.join(tmpdir(), 'dy-heads-'));
  mkdirSync(path.join(data2, 'laya', 'heads'), { recursive: true });
  writeFileSync(path.join(data2, 'laya', 'heads', 'heads.safetensors'), 'x');
  expect(headsAvailable(data2, mkdtempSync(path.join(tmpdir(), 'dy-app-')))).toBe(true);
});
