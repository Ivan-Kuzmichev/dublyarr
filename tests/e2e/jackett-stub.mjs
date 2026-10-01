// Заглушка Jackett (Torznab) для e2e и ручных проверок. Запуск: node tests/e2e/jackett-stub.mjs [порт] (по умолчанию 3198)
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { makeTorrent } from './bencode.mjs';

const port = Number(process.argv[2] ?? 3198);
const dir = path.join(import.meta.dirname, '..', 'fixtures', 'torznab');
const read = (n) => readFileSync(path.join(dir, n), 'utf8');
// Для e2e — ещё одна раздача с неизвестной студией (в фикстуре её нет, чтобы не менять unit-тесты).
const EXTRA = `<item><title>Game of Thrones / S1E1-10 of 10 [2011, WEB-DL 1080p] MVO (Zaycev Studio)</title><guid>https://rutracker.org/forum/viewtopic.php?t=3003</guid>
<jackettindexer id="rutracker">RuTracker.org</jackettindexer><size>12884901888</size><link>http://127.0.0.1:3198/dl/rutracker/?path=z</link>
<torznab:attr name="seeders" value="7" /></item>`;
// POST /__add2160 — в выдаче появляется пак LostFilm 2160p (для замены на лучшее качество)
const UHD = `<item><title>Game of Thrones / S1E1-10 of 10 [2011, WEB-DL 2160p] MVO (LostFilm)</title><guid>https://rutracker.org/forum/viewtopic.php?t=4004</guid>
<comments>https://rutracker.org/forum/viewtopic.php?t=4004</comments>
<jackettindexer id="rutracker">RuTracker.org</jackettindexer><size>42949672960</size><link>http://127.0.0.1:3198/dl/rutracker/?path=uhd</link>
<torznab:attr name="seeders" value="50" /></item>`;
let uhd = false;
const EMPTY = '<?xml version="1.0"?><rss version="2.0"><channel><title>empty</title></channel></rss>';
const CAPS = '<?xml version="1.0"?><caps><server title="Jackett stub"/><categories><category id="5000" name="TV"/><category id="5070" name="Anime"/></categories></caps>';

// Фильм «Матрица»: сначала только многоголосый WEB-DL; POST /__movie?stage=dub — появляется дубляж
let movieStage = 'mvo';
const movieItem = (title, hash, t) => `<item><title>${title}</title><guid>https://rutracker.org/forum/viewtopic.php?t=${t}</guid>
<comments>https://rutracker.org/forum/viewtopic.php?t=${t}</comments>
<jackettindexer id="rutracker">RuTracker.org</jackettindexer><size>10737418240</size><link>http://127.0.0.1:3198/dl/rutracker/?path=${hash}</link>
<category>2000</category><torznab:attr name="seeders" value="40" /></item>`;
const MOVIE_MVO = movieItem('The Matrix [1999, WEB-DL 1080p] MVO (Jaskier) + Original Eng', 'movie-mvo', 9001);
const MOVIE_DUB = movieItem('The Matrix [1999, WEB-DL 1080p] Dub + Original Eng', 'movie-dub', 9002);

// POST /__update — топики паков «обновились»: новая версия .torrent (другой хэш, те же файлы)
let version = 1;

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'POST' && url.pathname === '/__add2160') {
      uhd = true;
      return res.end('ok');
    }
    if (req.method === 'POST' && url.pathname === '/__movie') {
      movieStage = url.searchParams.get('stage') ?? 'mvo';
      return res.end(movieStage);
    }
    if (req.method === 'POST' && url.pathname === '/__update') {
      version++;
      return res.end(String(version));
    }
    if (url.pathname.startsWith('/dl/')) {
      // настоящие .torrent для раздач из фикстуры: пак сезона из 10 серий или одна серия
      const p = url.searchParams.get('path') ?? '';
      if (p.startsWith('movie-')) {
        res.writeHead(200, { 'content-type': 'application/x-bittorrent' });
        return res.end(makeTorrent(`The.Matrix.1999.1080p.${p}`, ['The.Matrix.1999.1080p.mkv', 'The.Matrix.1999.Sample.mkv']));
      }
      const eps = Array.from({ length: 10 }, (_, i) => `Game.of.Thrones.S01E${String(i + 1).padStart(2, '0')}.1080p.mkv`);
      const body = p === 'lf3' ? makeTorrent('Game.of.Thrones.S01E03.1080p.LostFilm.mkv', null) : makeTorrent(`Game of Thrones S01 ${p}`, eps, version);
      res.writeHead(200, { 'content-type': 'application/x-bittorrent' });
      return res.end(body);
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
      // ссылки на .torrent — на эту же заглушку, а не на настоящий Jackett из фикстуры
      const body = read('search-jackett.xml').replace('</channel>', `${EXTRA}${uhd ? UHD : ''}</channel>`).replaceAll('http://127.0.0.1:9117/', `http://127.0.0.1:${port}/`);
      if (/matrix|матриц/.test(q)) return send(`<?xml version="1.0"?><rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>${MOVIE_MVO}${movieStage === 'dub' ? MOVIE_DUB : ''}</channel></rss>`);
      return send(/game|thrones|игра|престол|got/.test(q) ? body : EMPTY);
    }
    res.writeHead(404);
    res.end();
  })
  .listen(port, '127.0.0.1', () => console.log(`jackett stub on ${port}`));
