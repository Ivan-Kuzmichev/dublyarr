import { expect, test } from 'vitest';
import { createQbit, QbitError } from '@/lib/qbit';

type Req = { path: string; method: string; body: string | FormData | null; cookie: string | null };
function fake(version: string, handlers: Record<string, (r: Req, n: number) => Response> = {}) {
  const log: Req[] = [];
  const counts: Record<string, number> = {};
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input));
    const body = init?.body instanceof FormData ? init.body : init?.body ? String(init.body) : null;
    const r: Req = { path: u.pathname + u.search, method: init?.method ?? 'GET', body, cookie: new Headers(init?.headers).get('cookie') };
    log.push(r);
    counts[u.pathname] = (counts[u.pathname] ?? 0) + 1;
    const h = handlers[u.pathname];
    if (h) return h(r, counts[u.pathname]);
    if (u.pathname === '/api/v2/auth/login') return new Response('Ok.', { headers: { 'set-cookie': `SID=s${counts[u.pathname]}; HttpOnly` } });
    if (u.pathname === '/api/v2/app/webapiVersion') return new Response(version);
    if (u.pathname === '/api/v2/app/version') return new Response('v5.1.2');
    return new Response('Ok.');
  }) as typeof fetch;
  return { fetchImpl, log };
}
const cfg = { url: 'http://q:8080', username: 'admin', password: 'pw' };

test('вход один раз, cookie в запросах; v5 — start/stop', async () => {
  const f = fake('2.11.4');
  const q = createQbit(cfg, { fetchImpl: f.fetchImpl });
  await q.start(['aa', 'bb']);
  await q.stop(['aa']);
  expect(f.log.filter((r) => r.path.startsWith('/api/v2/auth/login'))).toHaveLength(1);
  const start = f.log.find((r) => r.path === '/api/v2/torrents/start')!;
  expect(start.body).toBe('hashes=aa%7Cbb');
  expect(start.cookie).toBe('SID=s1');
  expect(f.log.some((r) => r.path === '/api/v2/torrents/stop')).toBe(true);
});

test('v4 — resume/pause', async () => {
  const f = fake('2.8.3');
  const q = createQbit(cfg, { fetchImpl: f.fetchImpl });
  await q.start(['aa']);
  await q.stop(['aa']);
  expect(f.log.map((r) => r.path)).toContain('/api/v2/torrents/resume');
  expect(f.log.map((r) => r.path)).toContain('/api/v2/torrents/pause');
});

test('403 — один повторный вход; второй 403 подряд — ошибка', async () => {
  const f = fake('2.11.4', { '/api/v2/torrents/info': (_r, n) => (n === 1 ? new Response('Forbidden', { status: 403 }) : Response.json([])) });
  const q = createQbit(cfg, { fetchImpl: f.fetchImpl });
  expect(await q.list('dublyarr')).toEqual([]);
  expect(f.log.filter((r) => r.path.startsWith('/api/v2/auth/login'))).toHaveLength(2);
  const always = fake('2.11.4', { '/api/v2/torrents/info': () => new Response('Forbidden', { status: 403 }) });
  await expect(createQbit(cfg, { fetchImpl: always.fetchImpl }).list('x')).rejects.toMatchObject({ code: 'auth' });
});

test('неверный пароль и бан', async () => {
  const bad = fake('2.11.4', { '/api/v2/auth/login': () => new Response('Fails.') });
  await expect(createQbit(cfg, { fetchImpl: bad.fetchImpl }).list('x')).rejects.toMatchObject({ code: 'auth', message: 'Неверный логин или пароль qBittorrent' });
  const banned = fake('2.11.4', { '/api/v2/auth/login': () => new Response('', { status: 403 }) });
  await expect(createQbit(cfg, { fetchImpl: banned.fetchImpl }).list('x')).rejects.toMatchObject({ code: 'banned' });
});

test('добавление торрента — multipart на паузе, категория и путь', async () => {
  const f = fake('2.11.4');
  await createQbit(cfg, { fetchImpl: f.fetchImpl }).add(Buffer.from('d4:infod4:name1:xee'), { savePath: '/downloads/dublyarr', category: 'dublyarr', paused: true });
  const add = f.log.find((r) => r.path === '/api/v2/torrents/add')!;
  const fd = add.body as FormData;
  expect(fd.get('category')).toBe('dublyarr');
  expect(fd.get('savepath')).toBe('/downloads/dublyarr');
  expect(fd.get('paused')).toBe('true');
  expect(fd.get('stopped')).toBe('true');
  expect(fd.get('torrents')).toBeInstanceOf(Blob);
  await createQbit(cfg, { fetchImpl: f.fetchImpl }).add({ magnet: 'magnet:?xt=urn:btih:aa' }, { savePath: '/d', category: 'dublyarr', paused: false });
  const mag = f.log.filter((r) => r.path === '/api/v2/torrents/add').at(-1)!.body as FormData;
  expect(mag.get('urls')).toBe('magnet:?xt=urn:btih:aa');
  expect(mag.get('paused')).toBe('false');
});

test('файлы, приоритеты, удаление без файлов, категория', async () => {
  const f = fake('2.11.4', {
    '/api/v2/torrents/files': () => Response.json([{ index: 0, name: 'S/a.mkv', size: 10, progress: 0.5, priority: 1 }, { name: 'S/b.mkv', size: 20, progress: 0, priority: 0 }]),
    '/api/v2/torrents/createCategory': () => new Response('', { status: 409 }),
  });
  const q = createQbit(cfg, { fetchImpl: f.fetchImpl });
  expect(await q.files('h')).toEqual([
    { index: 0, name: 'S/a.mkv', size: 10, progress: 0.5, priority: 1 },
    { index: 1, name: 'S/b.mkv', size: 20, progress: 0, priority: 0 },
  ]);
  await q.setFilePriority('h', [0, 2], 0);
  expect(f.log.find((r) => r.path === '/api/v2/torrents/filePrio')!.body).toBe('hash=h&id=0%7C2&priority=0');
  await q.remove(['h']);
  expect(f.log.find((r) => r.path === '/api/v2/torrents/delete')!.body).toBe('hashes=h&deleteFiles=false');
  await q.setDownloadLimit(['a', 'b'], 1048576);
  expect(f.log.find((r) => r.path === '/api/v2/torrents/setDownloadLimit')!.body).toBe('hashes=a%7Cb&limit=1048576');
  await expect(q.ensureCategory('dublyarr', '/downloads/dublyarr')).resolves.toBeUndefined();
});

test('сеть недоступна', async () => {
  const down = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  const err = await createQbit(cfg, { fetchImpl: down }).list('x').catch((e) => e);
  expect(err).toBeInstanceOf(QbitError);
  expect(err.code).toBe('network');
});

test('getQbit: один клиент, пока не сменились настройки', async () => {
  const { randomBytes } = await import('node:crypto');
  process.env.DUBLYARR_SECRET_KEY ??= randomBytes(32).toString('base64');
  const { testDb } = await import('./helpers');
  const { setSecretSetting } = await import('@/lib/settings');
  const { getQbit } = await import('@/lib/qbit');
  const db = testDb();
  setSecretSetting(db, 'qbittorrent', { url: 'http://q', username: 'a', password: 'p' });
  const a = getQbit(db);
  expect(a).not.toBeNull();
  expect(getQbit(db)).toBe(a);
  setSecretSetting(db, 'qbittorrent', { url: 'http://q', username: 'a', password: 'p2' });
  expect(getQbit(db)).not.toBe(a);
});
