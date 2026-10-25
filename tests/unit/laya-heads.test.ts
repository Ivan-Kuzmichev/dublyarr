import { expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { headsAvailable } from '@/lib/laya/heads';

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
  // надстройка (2.6) — тоже дообучение: laya/probe/<задача>.json
  const app3 = mkdtempSync(path.join(tmpdir(), 'dy-app-'));
  mkdirSync(path.join(app3, 'laya', 'probe'), { recursive: true });
  writeFileSync(path.join(app3, 'laya', 'probe', 'match.json'), '{}');
  expect(headsAvailable(mkdtempSync(path.join(tmpdir(), 'dy-heads-')), app3)).toBe(true);
});
