import { expect, test } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readLog } from '@/lib/log-read';

const row = (time: number, level: number, area: string, msg: string, extra = {}) => JSON.stringify({ time, level, area, name: 'worker', msg, ...extra });

function dir() {
  const d = mkdtempSync(path.join(tmpdir(), 'logr-'));
  writeFileSync(path.join(d, 'dublyarr.log.1'), [row(1, 30, 'qbit', 'старое')].join('\n') + '\n');
  writeFileSync(path.join(d, 'dublyarr.log'), [row(2, 20, 'qbit', 'add', { hash: 'abc' }), '{"обрыв', row(3, 40, 'search', 'jacred 429'), row(4, 30, 'downloads', 'paused → downloading')].join('\n') + '\n');
  return d;
}

test('новые первыми, через ротацию, битые строки пропущены', () => {
  expect(readLog(dir()).map((l) => l.msg)).toEqual(['paused → downloading', 'jacred 429', 'add', 'старое']);
});

test('фильтры: уровень (и выше), область, текст, since, lines', () => {
  const d = dir();
  expect(readLog(d, { level: 'warn' }).map((l) => l.msg)).toEqual(['jacred 429']);
  expect(readLog(d, { area: 'qbit' }).map((l) => l.msg)).toEqual(['add', 'старое']);
  expect(readLog(d, { q: 'abc' }).map((l) => l.msg)).toEqual(['add']); // текст ищется и в полях
  expect(readLog(d, { since: 3 }).map((l) => l.msg)).toEqual(['paused → downloading', 'jacred 429']);
  expect(readLog(d, { lines: 1 })).toHaveLength(1);
  expect(readLog(d, { lines: 99999 }).length).toBeLessThanOrEqual(2000);
  expect(readLog(d)[2]).toMatchObject({ level: 'debug', area: 'qbit', proc: 'worker', data: { hash: 'abc' } });
});

test('нет каталога — пусто', () => {
  expect(readLog('/nonexistent/logs')).toEqual([]);
});
