import { beforeEach, expect, test } from 'vitest';
import { createTmdb, TmdbError, clearTmdbCache } from '@/lib/tmdb/client';

type Call = { url: URL; headers: Headers };
function fake(handler: (u: URL) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, headers: new Headers(init?.headers) });
    return handler(url);
  }) as typeof fetch;
  return { calls, fetchImpl };
}
const json = (b: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(b), { ...init, headers: { 'content-type': 'application/json', ...(init?.headers as object) } });
const base = 'http://tmdb.test/3';

beforeEach(() => clearTmdbCache());

test('ключ v3 — query api_key, токен v4 — Bearer; язык ru-RU', async () => {
  const v3 = fake(() => json({ page: 1, results: [], total_results: 0 }));
  await createTmdb({ apiKey: '0123456789abcdef0123456789abcdef' }, { fetchImpl: v3.fetchImpl, baseUrl: base }).search('дэдлок');
  expect(v3.calls[0].url.searchParams.get('api_key')).toBe('0123456789abcdef0123456789abcdef');
  expect(v3.calls[0].url.searchParams.get('language')).toBe('ru-RU');
  expect(v3.calls[0].url.pathname).toBe('/3/search/tv');
  const v4 = fake(() => json({ page: 1, results: [], total_results: 0 }));
  await createTmdb({ apiKey: 'eyJhbGciOiJIUzI1NiJ9.token' }, { fetchImpl: v4.fetchImpl, baseUrl: base }).search('x');
  expect(v4.calls[0].headers.get('authorization')).toBe('Bearer eyJhbGciOiJIUzI1NiJ9.token');
  expect(v4.calls[0].url.searchParams.has('api_key')).toBe(false);
});

test('ошибки: 401, 404, сеть', async () => {
  const mk = (h: () => Response | Promise<Response>) => createTmdb({ apiKey: 'k' }, { fetchImpl: fake(h).fetchImpl, baseUrl: base });
  await expect(mk(() => json({}, { status: 401 })).details(1)).rejects.toMatchObject({ code: 'auth', message: 'Неверный ключ TMDB' });
  await expect(mk(() => json({}, { status: 404 })).details(1)).rejects.toMatchObject({ code: 'not_found' });
  await expect(
    mk(() => {
      throw new TypeError('fetch failed');
    }).details(1),
  ).rejects.toMatchObject({ code: 'network' });
  await expect(mk(() => json({}, { status: 500 })).details(1)).rejects.toBeInstanceOf(TmdbError);
});

test('429: одна пауза по Retry-After (не больше 5 с) и повтор', async () => {
  let n = 0;
  const slept: number[] = [];
  const f = fake(() =>
    ++n === 1 ? json({}, { status: 429, headers: { 'retry-after': '30' } }) : json({ page: 1, results: [{ id: 1 }], total_results: 1 }),
  );
  const tmdb = createTmdb(
    { apiKey: 'k' },
    {
      fetchImpl: f.fetchImpl,
      baseUrl: base,
      sleep: async (ms) => {
        slept.push(ms);
      },
    },
  );
  expect(await tmdb.trending()).toHaveLength(1);
  expect(slept).toEqual([5000]);
  const always = fake(() => json({}, { status: 429, headers: { 'retry-after': '1' } }));
  const t2 = createTmdb({ apiKey: 'k' }, { fetchImpl: always.fetchImpl, baseUrl: base, sleep: async () => {} });
  await expect(t2.details(1)).rejects.toMatchObject({ code: 'rate' });
  expect(always.calls).toHaveLength(2);
});

test('пустое описание дополняется из en-US', async () => {
  const f = fake((u) =>
    json(
      u.searchParams.get('language') === 'ru-RU'
        ? { id: 1, name: 'Дэдлок', overview: '', seasons: [] }
        : { id: 1, name: 'Deadloch', overview: 'English overview', seasons: [] },
    ),
  );
  const d = await createTmdb({ apiKey: 'k' }, { fetchImpl: f.fetchImpl, baseUrl: base }).details(1);
  expect(d.name).toBe('Дэдлок');
  expect(d.overview).toBe('English overview');
  expect(f.calls[0].url.searchParams.get('append_to_response')).toBe('alternative_titles,external_ids,translations');
});

test('поиск и тренды кэшируются на час', async () => {
  let t = 0;
  const f = fake(() => json({ page: 1, results: [{ id: 5 }], total_results: 1 }));
  const tmdb = createTmdb({ apiKey: 'k' }, { fetchImpl: f.fetchImpl, baseUrl: base, now: () => t });
  await tmdb.search('A');
  await tmdb.search('a ');
  expect(f.calls).toHaveLength(1);
  t = 3_600_001;
  await tmdb.search('a');
  expect(f.calls).toHaveLength(2);
});
