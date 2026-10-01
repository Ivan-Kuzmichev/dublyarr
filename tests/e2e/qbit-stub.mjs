// Заглушка qBittorrent WebAPI v2 для e2e и ручных проверок.
// node tests/e2e/qbit-stub.mjs [порт] ; QBIT_DIR — куда «докачиваются» файлы (папка /downloads глазами qBittorrent).
import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readTorrent } from './bencode.mjs';

const port = Number(process.argv[2] ?? 3197);
const dir = process.env.QBIT_DIR ?? path.join(process.cwd(), '.data', 'qbit');
const step = Number(process.env.QBIT_STEP ?? 0.5);
const torrents = new Map();

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

/** multipart/form-data → { поле: Buffer } */
function multipart(body, type) {
  const boundary = Buffer.from(`--${/boundary=(.+)$/.exec(type)[1]}`);
  const out = {};
  let pos = body.indexOf(boundary);
  while (pos >= 0) {
    const next = body.indexOf(boundary, pos + boundary.length);
    if (next < 0) break;
    const part = body.subarray(pos + boundary.length + 2, next - 2);
    const sep = part.indexOf('\r\n\r\n');
    const name = /name="([^"]+)"/.exec(part.subarray(0, sep).toString())?.[1];
    if (name) out[name] = part.subarray(sep + 4);
    pos = next;
  }
  return out;
}

/** Каждый опрос info «докачивает» активные торренты на QBIT_STEP (по умолчанию +50 %), на 100 % — файлы на диске. */
function tick() {
  for (const t of torrents.values()) {
    if (t.paused || t.progress >= 1) continue;
    t.progress = Math.min(1, t.progress + step);
    if (t.progress >= 1) t.completion_on = Math.floor(Date.now() / 1000);
    if (t.progress >= 1)
      for (const f of t.files) {
        if (f.priority === 0) continue;
        f.progress = 1;
        const p = path.join(dir, t.save_path.replace(/^\/downloads\/?/, ''), f.name);
        mkdirSync(path.dirname(p), { recursive: true });
        writeFileSync(p, 'video');
      }
  }
}

const json = (res, v) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(v));
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const body = await readBody(req);
    const form = new URLSearchParams(req.headers['content-type']?.includes('urlencoded') ? body.toString() : '');
    const p = url.pathname;
    if (p === '/api/v2/auth/login') {
      if (form.get('password') === 'bad') return res.end('Fails.');
      res.writeHead(200, { 'set-cookie': 'SID=stub; HttpOnly; path=/' });
      return res.end('Ok.');
    }
    if (!/SID=stub/.test(req.headers.cookie ?? '')) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    if (p === '/api/v2/app/webapiVersion') return res.end('2.11.4');
    if (p === '/api/v2/app/version') return res.end('v5.1.2');
    if (p === '/api/v2/torrents/createCategory') return res.end('');
    if (p === '/api/v2/torrents/add') {
      const parts = multipart(body, req.headers['content-type']);
      const meta = parts.torrents
        ? readTorrent(parts.torrents)
        : { hash: /btih:([0-9a-f]{40})/i.exec(parts.urls.toString())[1].toLowerCase(), name: 'magnet', files: [{ name: 'magnet.mkv', size: 1024 }] };
      const paused = parts.paused?.toString() === 'true';
      torrents.set(meta.hash, {
        hash: meta.hash, name: meta.name, category: parts.category.toString(), save_path: parts.savepath.toString(),
        content_path: `${parts.savepath}/${meta.name}`, progress: 0, dlspeed: 5_000_000, eta: 120, num_seeds: 10, paused, ratio: 0, completion_on: -1, dl_limit: 0,
        size: meta.files.reduce((n, f) => n + f.size, 0), files: meta.files.map((f, i) => ({ index: i, name: f.name, size: f.size, progress: 0, priority: 1 })),
      });
      return res.end('Ok.');
    }
    if (p === '/api/v2/torrents/info') {
      tick();
      const cat = url.searchParams.get('category');
      return json(res, [...torrents.values()].filter((t) => !cat || t.category === cat).map(({ files: _f, paused, ...t }) => ({ ...t, state: paused ? 'stoppedDL' : t.progress >= 1 ? 'stalledUP' : 'downloading' })));
    }
    if (p === '/api/v2/torrents/files') return json(res, torrents.get(url.searchParams.get('hash'))?.files ?? []);
    const hashes = (form.get('hashes') ?? form.get('hash') ?? '').split('|');
    if (p === '/api/v2/torrents/filePrio') {
      const ids = form.get('id').split('|').map(Number);
      for (const f of torrents.get(form.get('hash'))?.files ?? []) if (ids.includes(f.index)) f.priority = Number(form.get('priority'));
      return res.end('');
    }
    if (p === '/api/v2/torrents/start' || p === '/api/v2/torrents/stop') {
      for (const h of hashes) if (torrents.has(h)) torrents.get(h).paused = p.endsWith('stop');
      return res.end('');
    }
    if (p === '/api/v2/torrents/setDownloadLimit') {
      for (const h of hashes) if (torrents.has(h)) torrents.get(h).dl_limit = Number(form.get('limit'));
      return res.end('');
    }
    if (p === '/api/v2/torrents/delete') {
      for (const h of hashes) torrents.delete(h);
      return res.end('');
    }
    res.writeHead(404);
    res.end();
  })
  .listen(port, '127.0.0.1', () => console.log(`qbit stub on ${port}, files → ${dir}`));
