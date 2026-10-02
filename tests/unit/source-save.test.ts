import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { testDb } from './helpers';
import { saveSource } from '@/lib/source-save';
import { sourcesForSearch } from '@/lib/sources';
import { titles, trackers } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const indexers = readFileSync('tests/fixtures/torznab/indexers-jackett.xml', 'utf8');
const caps = '<?xml version="1.0"?><caps><categories><category id="5000" name="TV"/></categories></caps>';
const input = { name: 'J', apiKey: 'K', timeoutMs: 5000 };

test('Jackett: полный адрес «все трекеры» сохраняется базой, трекеры подтягиваются', async () => {
  const db = testDb();
  const urls: string[] = [];
  const fetchImpl = (async (u: string) => {
    urls.push(String(u));
    return new Response(String(u).includes('t=indexers') ? indexers : caps);
  }) as unknown as typeof fetch;
  const r = await saveSource(db, { ...input, kind: 'jackett', url: 'http://j:9117/api/v2.0/indexers/all/results/torznab/' }, null, fetchImpl);
  expect(r).toMatchObject({ ok: true, categories: 1 });
  expect(sourcesForSearch(db)[0]).toMatchObject({ kind: 'jackett', url: 'http://j:9117', apiKey: 'K' });
  expect(urls[0]).toMatch(/^http:\/\/j:9117\/api\/v2\.0\/indexers\/all\/results\/torznab\/api\?t=caps/);
  expect(db.select().from(trackers).all().length).toBeGreaterThan(0);
});

test('JacRed: проверка пробным поиском, ключ не обязателен; ошибка — текстом', async () => {
  const db = testDb();
  const ok = (async () => new Response('[]')) as unknown as typeof fetch;
  expect(await saveSource(db, { ...input, apiKey: '', kind: 'jacred', url: 'https://jr.example' }, null, ok)).toMatchObject({ ok: true });
  const bad = (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch;
  expect(await saveSource(db, { ...input, apiKey: '', kind: 'jacred', url: 'https://jr2.example' }, null, bad)).toEqual({ error: 'Ответ не похож на JacRed' });
  expect(sourcesForSearch(db).map((s) => s.kind)).toEqual(['jacred']);
});

test('новый или изменённый источник — кэш поиска сбрасывается (найдётся и в нём)', async () => {
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 1, kind: 'series', nameRu: 'A', nameOriginal: 'A', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1, releasesSearchedAt: 5 }).returning().get();
  const ok = (async () => new Response('[]')) as unknown as typeof fetch;
  await saveSource(db, { ...input, apiKey: '', kind: 'jacred', url: 'https://jr.example' }, null, ok);
  expect(db.select().from(titles).where(eq(titles.id, t.id)).get()!.releasesSearchedAt).toBeNull();
});
