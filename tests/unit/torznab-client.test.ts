import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { torznabSearch, torznabIndexers, torznabUrl, TorznabError } from '@/lib/torznab';

const fx = (n: string) => readFileSync(`tests/fixtures/torznab/${n}`, 'utf8');
const src = { url: 'http://j:9117/api/v2.0/indexers/all/results/torznab/', apiKey: 'K', timeoutMs: 5000 };
const respond = (body: string, status = 200) => (async () => new Response(body, { status })) as typeof fetch;

test('адрес запроса', () => {
  expect(torznabUrl('http://j/api', { t: 'search', q: 'игра' })).toBe('http://j/api?t=search&q=%D0%B8%D0%B3%D1%80%D0%B0');
  expect(torznabUrl('http://p/1/api?x=1', { t: 'caps' })).toBe('http://p/1/api?x=1&t=caps');
});

test('разбор поиска Jackett', async () => {
  let seen = '';
  const f = (async (u: RequestInfo | URL) => {
    seen = String(u);
    return new Response(fx('search-jackett.xml'));
  }) as typeof fetch;
  const items = await torznabSearch(src, 'Game of Thrones', [5000, 5070], f);
  expect(seen).toContain('t=search');
  expect(seen).toContain('cat=5000%2C5070');
  expect(seen).toContain('apikey=K');
  expect(items).toHaveLength(4);
  expect(items[0]).toMatchObject({
    title: 'Game of Thrones / S1E1-10 of 10 [2011, BDRip 1080p] Dub + MVO (LostFilm, AlexFilm) + Original',
    indexerId: 'rutracker',
    indexerName: 'RuTracker.org',
    size: 21474836480,
    seeders: 120,
    peers: 130,
    infohash: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555',
    magnet: 'magnet:?xt=urn:btih:AAAA1111BBBB2222CCCC3333DDDD4444EEEE5555',
    details: 'https://rutracker.org/forum/viewtopic.php?t=3001',
    categories: [5000, 100509],
  });
  expect(items[0].link).toContain('jackett_apikey=SECRETKEY');
  expect(items[0].publishedAt).toBe(Date.parse('Sun, 12 Jun 2016 10:00:00 +0300'));
  expect(items[1]).toMatchObject({ indexerId: 'kinozal', seeders: 0, infohash: null, magnet: null });
  expect(items[3].infohash).toBeNull();
});

test('список трекеров', async () => {
  const list = await torznabIndexers(src, respond(fx('indexers-jackett.xml')));
  expect(list).toEqual([
    { id: 'rutracker', name: 'RuTracker.org', categories: [2000, 5000, 5070] },
    { id: 'kinozal', name: 'Kinozal', categories: [5000] },
    { id: 'lostfilm', name: 'LostFilm.tv', categories: [5000] },
  ]);
  expect(await torznabIndexers(src, respond('<error code="203" description="Function Not Available"/>'))).toBeNull();
});

test('ошибки', async () => {
  await expect(torznabSearch(src, 'x', [5000], respond(fx('error-100.xml')))).rejects.toMatchObject({ code: 'auth', message: 'Неверный API-ключ' });
  await expect(torznabSearch(src, 'x', [5000], respond('<html>'))).rejects.toMatchObject({ code: 'bad', message: 'Ответ не похож на Torznab' });
  await expect(torznabSearch(src, 'x', [5000], respond('', 502))).rejects.toMatchObject({ code: 'http', message: 'HTTP 502' });
  const hang = ((_u: RequestInfo | URL, init?: RequestInit) =>
    new Promise((_r, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))) as typeof fetch;
  await expect(torznabSearch({ ...src, timeoutMs: 50 }, 'x', [5000], hang)).rejects.toMatchObject({ code: 'timeout', message: 'Нет ответа за 0,05 с' });
  await expect(torznabSearch(src, 'x', [5000], respond('<error code="500" description="Indexer down"/>'))).rejects.toBeInstanceOf(TorznabError);
});

test('пустой ответ — пустой список', async () => {
  expect(await torznabSearch(src, 'x', [5000], respond('<rss><channel><title>t</title></channel></rss>'))).toEqual([]);
});
