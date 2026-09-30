import { expect, test } from 'vitest';
import { checkTorznab } from '@/lib/integrations/torznab';

const caps = `<?xml version="1.0"?><caps><server title="Jackett"/><categories><category id="5000" name="TV"/><category id="2000" name="Movies"/></categories></caps>`;

test('caps → ok, ключ передаётся, существующий query сохраняется', async () => {
  let seen = '';
  const f = (async (u: RequestInfo | URL) => {
    seen = String(u);
    return new Response(caps);
  }) as typeof fetch;
  expect(await checkTorznab({ url: 'http://j:9117/api/v2.0/indexers/all/results/torznab/', apiKey: 'K' }, f)).toEqual({ ok: true, categories: 2 });
  expect(seen).toBe('http://j:9117/api/v2.0/indexers/all/results/torznab/?t=caps&apikey=K');
  await checkTorznab({ url: 'http://p/1/api?x=1', apiKey: 'K' }, f);
  expect(seen).toBe('http://p/1/api?x=1&t=caps&apikey=K');
});

test('неверный ключ и не-Torznab', async () => {
  const bad = (async () => new Response('<error code="100" description="Invalid API Key"/>')) as typeof fetch;
  expect(await checkTorznab({ url: 'http://j/', apiKey: 'x' }, bad)).toEqual({ ok: false, error: 'Неверный API-ключ' });
  const html = (async () => new Response('<html>')) as typeof fetch;
  expect(await checkTorznab({ url: 'http://j/', apiKey: 'x' }, html)).toEqual({ ok: false, error: 'Ответ не похож на Torznab' });
});
