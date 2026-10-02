import { expect, test } from 'vitest';
import { jacredSearch } from '@/lib/jacred';

const item = (o: object) => ({
  tracker: 'rutracker', url: 'https://rutracker.org/forum/viewtopic.php?t=1', title: 'Книжный / Bookish [S01] WEB-DL 1080p', size: 2_000_000_000,
  createTime: '2026-01-27T10:21:00', sid: 12, pir: 3, magnet: 'magnet:?xt=urn:btih:E4F0D0728B31DC0679E0D5F0E138779F62377917&tr=x', types: ['tvshow'], ...o,
});
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
let n = 0;
const src = () => ({ url: `https://jac${++n}.red`, apiKey: '', timeoutMs: 5000 }); // своя очередь у каждого теста
const nosleep = async () => undefined;

test('ответ JacRed → раздачи: хэш из magnet, трекер, топик, вид', async () => {
  const urls: string[] = [];
  const fetchImpl = (async (u: string) => {
    urls.push(String(u));
    return json([item({}), item({ types: ['movie'], title: 'Книжный клуб', magnet: 'magnet:?xt=urn:btih:' + 'a'.repeat(40) })]);
  }) as unknown as typeof fetch;
  const s = src();
  const r = await jacredSearch(s, 'Книжный', 'series', { fetchImpl, sleep: nosleep });
  expect(urls[0]).toBe(`${s.url}/api/v1.0/torrents?search=%D0%9A%D0%BD%D0%B8%D0%B6%D0%BD%D1%8B%D0%B9`);
  expect(r).toHaveLength(1);
  expect(r[0]).toMatchObject({ infohash: 'e4f0d0728b31dc0679e0d5f0e138779f62377917', indexerId: 'rutracker', indexerName: 'rutracker', details: 'https://rutracker.org/forum/viewtopic.php?t=1', link: null, seeders: 12, peers: 3, size: 2_000_000_000 });
  expect(r[0].magnet).toMatch(/^magnet:/);
});

test('без magnet или без btih — пропускается', async () => {
  const fetchImpl = (async () => json([item({ magnet: null }), item({ magnet: 'magnet:?dn=x' })])) as unknown as typeof fetch;
  expect(await jacredSearch(src(), 'x', 'series', { fetchImpl, sleep: nosleep })).toEqual([]);
});

test('429 → одна пауза по Retry-After (не больше 10 с), повтор', async () => {
  const waits: number[] = [];
  let calls = 0;
  const fetchImpl = (async () => (calls++ === 0 ? json({}, 429, { 'retry-after': '30' }) : json([item({})]))) as unknown as typeof fetch;
  const r = await jacredSearch(src(), 'x', 'series', { fetchImpl, sleep: async (ms) => void waits.push(ms) });
  expect(r).toHaveLength(1);
  expect(waits).toContain(10_000);
});

test('429 дважды — ошибка «не ответил»', async () => {
  const fetchImpl = (async () => json({}, 429)) as unknown as typeof fetch;
  await expect(jacredSearch(src(), 'x', 'series', { fetchImpl, sleep: nosleep })).rejects.toThrow('JacRed не ответил: слишком много запросов');
});

test('запросы к одному JacRed — по одному с паузой ≥ 1 с', async () => {
  const log: string[] = [];
  let active = 0;
  const fetchImpl = (async () => {
    active++;
    log.push(`start:${active}`);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return json([]);
  }) as unknown as typeof fetch;
  const sleep = async (ms: number) => void log.push(`sleep:${ms}`);
  const s = src();
  await Promise.all([jacredSearch(s, 'a', 'series', { fetchImpl, sleep }), jacredSearch(s, 'b', 'series', { fetchImpl, sleep })]);
  expect(log).toEqual(['start:1', 'sleep:1000', 'start:1', 'sleep:1000']);
});

test('трекер JacRed с другим именем — тот же, что в Jackett (aniliberty → anilibria)', async () => {
  const fetchImpl = (async () => json([item({ tracker: 'aniliberty' })])) as unknown as typeof fetch;
  const [r] = await jacredSearch(src(), 'x', 'series', { fetchImpl, sleep: nosleep });
  expect(r).toMatchObject({ indexerId: 'anilibria', indexerName: 'aniliberty' });
});
