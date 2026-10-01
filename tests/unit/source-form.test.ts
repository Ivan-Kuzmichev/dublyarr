import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { parseSourceForm } from '@/lib/source-form';
import { testDb } from './helpers';
import { addSource, updateSource, sourcesForSearch } from '@/lib/sources';
import { sources } from '@/lib/db/schema';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const f = (o: Record<string, string>) => {
  const d = new FormData();
  for (const [k, v] of Object.entries(o)) d.set(k, v);
  return d;
};

test('разбор формы источника', () => {
  expect(parseSourceForm(f({ name: ' Jackett ', url: 'http://j:9117/api/v2.0/indexers/all/results/torznab/', apiKey: ' K ', timeout: '20' }))).toEqual({
    name: 'Jackett',
    url: 'http://j:9117/api/v2.0/indexers/all/results/torznab/',
    apiKey: 'K',
    timeoutMs: 20_000,
    kind: 'jackett',
  });
  expect(parseSourceForm(f({ name: '', url: 'http://j', apiKey: '', timeout: '15' }))).toMatchObject({ name: 'Jackett' });
  expect(parseSourceForm(f({ name: 'J', url: 'ftp://j', apiKey: '', timeout: '15' }))).toEqual({ error: 'Адрес — http(s)://…' });
  expect(parseSourceForm(f({ name: 'J', url: 'http://j', apiKey: '', timeout: '0' }))).toEqual({ error: 'Таймаут — от 3 до 60 с' });
});

test('правка источника: ключ шифруется, пустой ключ не затирает сохранённый', () => {
  const db = testDb();
  const s = addSource(db, { name: 'J', url: 'http://j', apiKey: 'OLD' });
  updateSource(db, s.id, { name: 'J2', url: 'http://j2', apiKey: '', timeoutMs: 20_000 });
  expect(sourcesForSearch(db)[0]).toMatchObject({ name: 'J2', url: 'http://j2', apiKey: 'OLD', timeoutMs: 20_000 });
  updateSource(db, s.id, { name: 'J2', url: 'http://j2', apiKey: 'NEW', timeoutMs: 20_000 });
  expect(sourcesForSearch(db)[0].apiKey).toBe('NEW');
  expect(db.select().from(sources).get()!.apiKeyEnc).not.toContain('NEW');
});

test('адрес с неверным портом не принимается', () => {
  expect(parseSourceForm(f({ name: 'J', url: 'http://host:99999/api', apiKey: '', timeout: '15' }))).toEqual({ error: 'Адрес — http(s)://…' });
});

test('тип источника: jackett по умолчанию, jacred без ключа, неизвестный — ошибка', () => {
  const d = f({ url: 'http://j:9117', timeout: '15' });
  expect(parseSourceForm(d)).toMatchObject({ kind: 'jackett', url: 'http://j:9117', name: 'Jackett' });
  d.set('kind', 'jacred');
  d.set('url', 'https://jac.red');
  expect(parseSourceForm(d)).toMatchObject({ kind: 'jacred', name: 'JacRed' });
  d.set('kind', 'x');
  expect(parseSourceForm(d)).toEqual({ error: 'Неизвестный тип источника' });
});
