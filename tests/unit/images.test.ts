import { expect, test } from 'vitest';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isValidImageRequest, loadImage, imageUrl, posterColor } from '@/lib/images';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

test('валидация запроса', () => {
  expect(isValidImageRequest('w342', 'abc_DEF-1.jpg')).toBe(true);
  for (const [s, f] of [
    ['w999', 'a.jpg'],
    ['w342', '../secret.key'],
    ['w342', '..%2Fx.jpg'],
    ['w342', ''],
    ['w342', 'a.gif'],
    ['w342', 'a/b.jpg'],
  ]) {
    expect(isValidImageRequest(s, f)).toBe(false);
  }
});

test('первый раз качает и кладёт в кэш, второй — с диска; ошибка — 404; мусор — 400', async () => {
  const cacheDir = mkdtempSync(path.join(tmpdir(), 'dy-img-'));
  let calls = 0;
  const ok = (async (u: RequestInfo | URL) => {
    calls++;
    expect(String(u)).toBe('http://img.test/t/p/w342/abc.png');
    return new Response(PNG, { headers: { 'content-type': 'image/png' } });
  }) as typeof fetch;
  const o = { cacheDir, baseUrl: 'http://img.test/t/p', fetchImpl: ok };
  const r1 = await loadImage('w342', 'abc.png', o);
  expect(r1).toMatchObject({ status: 200, contentType: 'image/png' });
  const offline = (async () => {
    throw new Error('сеть не нужна');
  }) as typeof fetch;
  const r2 = await loadImage('w342', 'abc.png', { ...o, fetchImpl: offline });
  expect(r2.status).toBe(200);
  expect(calls).toBe(1);
  expect(readdirSync(path.join(cacheDir, 'w342'))).toEqual(['abc.png']);
  const fail = (async () => new Response('', { status: 404 })) as typeof fetch;
  expect((await loadImage('w342', 'nope.jpg', { ...o, fetchImpl: fail })).status).toBe(404);
  expect((await loadImage('w342', 'x.jpg', { ...o, fetchImpl: offline })).status).toBe(404);
  expect((await loadImage('w342', '../x.jpg', o)).status).toBe(400);
});

test('url и цвет заглушки', () => {
  expect(imageUrl('w342', '/abc.jpg')).toBe('/api/image/w342/abc.jpg');
  expect(imageUrl('w342', null)).toBeNull();
  expect(posterColor(1399)).toBe(posterColor(1399 + 18));
});
