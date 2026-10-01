import { expect, test } from 'vitest';
import { Writable } from 'node:stream';
import { createLogger, redactUrl } from '@/lib/log';

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
