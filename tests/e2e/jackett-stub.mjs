// Заглушка Jackett (Torznab) для e2e и ручных проверок. Запуск: node tests/e2e/jackett-stub.mjs [порт] (по умолчанию 3198)
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const port = Number(process.argv[2] ?? 3198);
const dir = path.join(import.meta.dirname, '..', 'fixtures', 'torznab');
const read = (n) => readFileSync(path.join(dir, n), 'utf8');
const EMPTY = '<?xml version="1.0"?><rss version="2.0"><channel><title>empty</title></channel></rss>';
const CAPS = '<?xml version="1.0"?><caps><server title="Jackett stub"/><categories><category id="5000" name="TV"/><category id="5070" name="Anime"/></categories></caps>';

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/dl/')) {
      res.writeHead(200, { 'content-type': 'application/x-bittorrent' });
      return res.end('d8:announce0:e');
    }
    const send = (body) => {
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(body);
    };
    if (url.searchParams.get('apikey') === 'bad') return send(read('error-100.xml'));
    const t = url.searchParams.get('t');
    if (t === 'caps') return send(CAPS);
    if (t === 'indexers') return send(read('indexers-jackett.xml'));
    if (t === 'search') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      return send(/game|thrones|игра|престол|got/.test(q) ? read('search-jackett.xml') : EMPTY);
    }
    res.writeHead(404);
    res.end();
  })
  .listen(port, '127.0.0.1', () => console.log(`jackett stub on ${port}`));
