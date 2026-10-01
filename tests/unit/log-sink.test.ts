import { expect, test } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLogSink, toJsonLine } from '@/entry/log-sink';

const quiet = { echo: () => undefined };

test('ротация: 5 файлов, новый — dublyarr.log', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'logs-'));
  const sink = createLogSink(dir, { maxBytes: 100, ...quiet });
  for (let i = 0; i < 40; i++) sink.write(`{"msg":"${'x'.repeat(20)}${i}"}`);
  expect(readdirSync(dir).sort()).toEqual(['dublyarr.log', 'dublyarr.log.1', 'dublyarr.log.2', 'dublyarr.log.3', 'dublyarr.log.4']);
  expect(readFileSync(path.join(dir, 'dublyarr.log'), 'utf8')).toContain('39');
});

test('не JSON — обёртка с областью', () => {
  const j = JSON.parse(toJsonLine('Downloading model…', 'laya'));
  expect(j).toMatchObject({ area: 'laya', name: 'laya', msg: 'Downloading model…', level: 30 });
  expect(toJsonLine('{"msg":"a"}', 'web')).toBe('{"msg":"a"}');
});

test('нет прав на запись — ошибка, строки идут только в echo', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'logs-'));
  chmodSync(dir, 0o500);
  const echoed: string[] = [];
  const sink = createLogSink(path.join(dir, 'sub'), { echo: (l) => echoed.push(l) });
  sink.write('{"msg":"a"}');
  expect(sink.error).toMatch(/Журнал недоступен/);
  expect(echoed).toEqual(['{"msg":"a"}']);
});
