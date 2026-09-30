import { expect, test } from 'vitest';
import { checkQbittorrent } from '@/lib/integrations/qbittorrent';

const cfg = { url: 'http://q:8080', username: 'admin', password: 'pw' };

function fakeFetch(map: Record<string, () => Response>) {
  return (async (input: RequestInfo | URL) => {
    const key = new URL(String(input)).pathname;
    const f = map[key];
    if (!f) throw new Error('unexpected ' + key);
    return f();
  }) as typeof fetch;
}

test('успешное подключение', async () => {
  const f = fakeFetch({
    '/api/v2/auth/login': () => new Response('Ok.', { headers: { 'set-cookie': 'SID=abc; HttpOnly; path=/' } }),
    '/api/v2/app/version': () => new Response('v5.0.2'),
  });
  expect(await checkQbittorrent(cfg, f)).toEqual({ ok: true, version: 'v5.0.2' });
});

test('неверный пароль', async () => {
  const f = fakeFetch({ '/api/v2/auth/login': () => new Response('Fails.') });
  expect(await checkQbittorrent(cfg, f)).toEqual({ ok: false, error: 'Неверный логин или пароль qBittorrent' });
});

test('бан по IP', async () => {
  const f = fakeFetch({ '/api/v2/auth/login': () => new Response('', { status: 403 }) });
  expect(await checkQbittorrent(cfg, f)).toEqual({ ok: false, error: 'IP заблокирован qBittorrent после неудачных входов' });
});

test('недоступен', async () => {
  const f = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  const r = await checkQbittorrent(cfg, f);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toMatch(/^qBittorrent не отвечает/);
});
