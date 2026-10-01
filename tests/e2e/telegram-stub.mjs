// Заглушка Telegram Bot API для e2e: node tests/e2e/telegram-stub.mjs [порт]
// POST /__push — добавить входящее обновление (JSON без update_id), GET /__sent — что бот отправил.
import http from 'node:http';

const port = Number(process.argv[2] ?? 3196);
const updates = [];
const sent = [];
let nextUpdate = 1;
let nextMessage = 100;

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const read = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}));
  });

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/__push') {
      updates.push({ update_id: nextUpdate++, ...(await read(req)) });
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/__sent') return json(res, 200, sent);
    const m = url.pathname.match(/^\/bot([^/]+)\/(\w+)$/);
    if (!m) return json(res, 404, { ok: false, error_code: 404, description: 'Not Found' });
    if (m[1] === 'bad') return json(res, 401, { ok: false, error_code: 401, description: 'Unauthorized' });
    const body = await read(req);
    const method = m[2];
    if (method === 'getMe') return json(res, 200, { ok: true, result: { id: 1, is_bot: true, username: 'dublyarr_test_bot' } });
    if (method === 'getUpdates') return json(res, 200, { ok: true, result: updates.filter((u) => u.update_id >= (body.offset ?? 0)) });
    sent.push({ method, ...body });
    if (method === 'sendMessage') return json(res, 200, { ok: true, result: { message_id: nextMessage++ } });
    return json(res, 200, { ok: true, result: true });
  })
  .listen(port, '127.0.0.1', () => console.log(`telegram stub on ${port}`));
