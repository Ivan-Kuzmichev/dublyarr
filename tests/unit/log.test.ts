import { expect, test } from 'vitest';
import { Writable } from 'node:stream';
import { createLogger, redactUrl, logger, applyLogSettings, setLogDestination } from '@/lib/log';

function capture() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _e, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  return { lines, destination };
}

test('секреты в полях маскируются', () => {
  const { lines, destination } = capture();
  const log = createLogger({ destination });
  log.info(
    { password: 'p1', apiKey: 'k1', qbit: { password: 'p2' }, headers: { cookie: 'SID=1', authorization: 'Bearer t' }, totpSecret: 's' },
    'x',
  );
  const out = lines.join('');
  for (const s of ['p1', 'k1', 'p2', 'SID=1', 'Bearer t', '"s"']) expect(out).not.toContain(s);
});

test('redactUrl прячет ключи и логин:пароль', () => {
  expect(redactUrl('http://j:9117/api?t=caps&apikey=SECRET&q=a')).toBe('http://j:9117/api?t=caps&apikey=***&q=a');
  expect(redactUrl('http://user:pass@host/x')).toBe('http://***:***@host/x');
  expect(redactUrl('не url')).toBe('не url');
});

test('ключ Jackett в ссылке на .torrent маскируется', () => {
  expect(redactUrl('http://j:9117/dl/rutracker/?jackett_apikey=SECRET&path=abc')).toBe('http://j:9117/dl/rutracker/?jackett_apikey=***&path=abc');
});

test('logger(area) пишет поле area и слушается уровня области', () => {
  const { lines, destination } = capture();
  setLogDestination(destination);
  applyLogSettings({ level: 'info', areas: { qbit: 'debug', tmdb: 'off' } });
  logger('qbit').debug({ hash: 'h' }, 'add');
  logger('tmdb').warn('x');
  logger('search').debug('скрыто');
  logger('search').info('видно');
  const rows = lines.join('').trim().split('\n').map((l) => JSON.parse(l));
  expect(rows.map((r) => [r.area, r.msg])).toEqual([['qbit', 'add'], ['search', 'видно']]);
});

test('смена настроек меняет уровень уже созданного логгера', () => {
  const { lines, destination } = capture();
  setLogDestination(destination);
  applyLogSettings({ level: 'info', areas: {} });
  const l = logger('downloads');
  l.debug('1');
  applyLogSettings({ level: 'info', areas: { downloads: 'debug' } });
  l.debug('2');
  expect(lines.join('')).not.toContain('"msg":"1"');
  expect(lines.join('')).toContain('"msg":"2"');
});
