import { expect, test, beforeEach } from 'vitest';
import { Writable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { setLogDestination, applyLogSettings } from '@/lib/log';
import { createQbit } from '@/lib/qbit';
import { runOnce, enqueue } from '@/worker/jobs';
import { testDb } from './helpers';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
let lines: Record<string, unknown>[] = [];
beforeEach(() => {
  lines = [];
  setLogDestination(
    new Writable({
      write(c, _e, cb) {
        for (const l of String(c).trim().split('\n')) lines.push(JSON.parse(l));
        cb();
      },
    }),
  );
  applyLogSettings({ level: 'debug', areas: {} });
});

test('qbit: каждый вызов WebAPI в журнале, пароль — нет', async () => {
  const fetchImpl = (async (url: string) => new Response(String(url).includes('login') ? 'Ok.' : '[]', { headers: { 'set-cookie': 'SID=s1' } })) as unknown as typeof fetch;
  const q = createQbit({ url: 'http://q:8080', username: 'u', password: 'СЕКРЕТ' }, { fetchImpl });
  await q.list('dublyarr');
  const calls = lines.filter((l) => l.area === 'qbit');
  expect(calls.map((l) => l.path)).toContain('/api/v2/torrents/info?category=dublyarr');
  expect(JSON.stringify(lines)).not.toContain('СЕКРЕТ');
});

test('worker: задача с длительностью', async () => {
  const db = testDb();
  enqueue(db, 'x.test');
  await runOnce(db, { 'x.test': async () => undefined });
  expect(lines.find((l) => l.area === 'worker' && l.msg === 'job done')).toMatchObject({ type: 'x.test' });
});

test('область выключена — её записей нет', async () => {
  applyLogSettings({ level: 'debug', areas: { worker: 'off' } });
  const db = testDb();
  enqueue(db, 'x.test');
  await runOnce(db, { 'x.test': async () => undefined });
  expect(lines.filter((l) => l.area === 'worker')).toEqual([]);
});
