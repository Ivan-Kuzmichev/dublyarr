// Заглушка TMDB для e2e и ручных проверок: отдаёт фикстуры из tests/fixtures/tmdb.
// Запуск: node tests/e2e/tmdb-stub.mjs [порт]  (по умолчанию 3199)
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const port = Number(process.argv[2] ?? 3199);
const dir = path.join(import.meta.dirname, '..', 'fixtures', 'tmdb');
const fx = (name) => JSON.parse(readFileSync(path.join(dir, `${name}.json`), 'utf8'));
// PNG 1×1 цвета surface-2
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNQUlL6DwACSQFb7m/3VgAAAABJRU5ErkJggg==',
  'base64',
);

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

// POST /__air?ep=3&date=2011-05-01 — у серии сезона 1 появляется дата эфира
const aired = new Map();

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = url.pathname;
    if (req.method === 'POST' && p === '/__air') {
      aired.set(Number(url.searchParams.get('ep')), url.searchParams.get('date'));
      return res.end('ok');
    }
    const key = url.searchParams.get('api_key') ?? req.headers.authorization?.replace('Bearer ', '');
    if (p.startsWith('/t/p/')) {
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(PNG);
    }
    if (key === 'bad') return json(res, 401, { status_message: 'Invalid API key' });
    if (p === '/3/configuration') return json(res, 200, { images: {} });
    if (p === '/3/trending/tv/week') return json(res, 200, fx('trending'));
    // фильм «Матрица» без дат релиза: цифровой релиз Dublyarr узнаёт по раздачам
    const matrix = () => ({ ...fx('movie-603'), release_dates: { results: [] } });
    const movieItem = { id: 603, media_type: 'movie', title: 'Матрица', original_title: 'The Matrix', release_date: '1999-03-30', poster_path: null };
    if (p === '/3/trending/all/week') return json(res, 200, { page: 1, results: [movieItem], total_results: 1 });
    if (p === '/3/search/multi') {
      const q = (url.searchParams.get('query') ?? '').toLowerCase();
      const results = /матриц|matrix/.test(q) ? [movieItem] : [];
      return json(res, 200, { page: 1, results, total_results: results.length });
    }
    if (p === '/3/movie/603') return json(res, 200, matrix());
    if (p === '/3/search/tv') {
      const q = (url.searchParams.get('query') ?? '').toLowerCase();
      const all = fx('trending');
      const results = all.results.filter((t) => t.name.toLowerCase().includes(q) || t.original_name.toLowerCase().includes(q));
      return json(res, 200, { ...all, results, total_results: results.length });
    }
    let m = p.match(/^\/3\/tv\/(\d+)$/);
    if (m) return existsSync(path.join(dir, `tv-${m[1]}.json`)) ? json(res, 200, fx(`tv-${m[1]}`)) : json(res, 404, {});
    m = p.match(/^\/3\/tv\/(\d+)\/season\/(\d+)$/);
    if (m) {
      const name = `tv-${m[1]}-season-${m[2]}`;
      const season = existsSync(path.join(dir, `${name}.json`)) ? fx(name) : { season_number: Number(m[2]), episodes: [] };
      if (m[2] === '1') for (const e of season.episodes) if (aired.has(e.episode_number)) e.air_date = aired.get(e.episode_number);
      return json(res, 200, season);
    }
    json(res, 404, {});
  })
  .listen(port, '127.0.0.1', () => console.log(`tmdb stub on ${port}`));
