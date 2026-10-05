import { expect, test } from 'vitest';
import { api } from './api-helpers';
import { setSecretSetting } from '@/lib/settings';
import { handleApi } from '@/lib/api/router';
import { downloads, titles } from '@/lib/db/schema';

test('status: версия и сервисы', async () => {
  const { call } = api();
  const r = await call('GET', 'status');
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({ version: '2.1.0', services: expect.any(Array), jobs: expect.any(Array) });
});

test('без доступа — ответ проверки доступа', async () => {
  const { db } = api();
  const r = await handleApi(db, { method: 'GET', path: ['status'], query: new URLSearchParams(), body: undefined, headers: { authorization: null, forwardedFor: '127.0.0.1', realIp: null, forwarded: null } }, { qbit: null, logDir: '/x', today: '2026-10-01', now: 1, version: 'x' });
  expect(r).toEqual({ status: 401, body: { error: 'Нужен токен API' } });
});

test('неизвестный адрес — 404, неверный метод — 405', async () => {
  const { call } = api();
  expect((await call('GET', 'nope')).status).toBe(404);
  expect((await call('DELETE', 'status')).status).toBe(405);
});

test('настройки: секреты только «задан / не задан»', async () => {
  const { db, call } = api();
  setSecretSetting(db, 'qbittorrent', { url: 'http://q', username: 'u', password: 'СЕКРЕТ' });
  const r = await call('GET', 'settings/qbittorrent');
  expect(JSON.stringify(r.body)).not.toContain('СЕКРЕТ');
  expect(r.body).toMatchObject({ url: 'http://q', username: 'u', password: 'задан' });
});

test('«Безопасность» и API-доступ через API недоступны', async () => {
  const { call } = api();
  expect((await call('GET', 'settings/security')).status).toBe(404);
  expect((await call('GET', 'settings/api')).status).toBe(404);
});

test('загрузки: список и одна — с состоянием в qBittorrent', async () => {
  const { db, fq, call } = api();
  const t = db.insert(titles).values({ tmdbId: 7, kind: 'series', nameRu: 'Эль', nameOriginal: 'Elle', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  const d = db.insert(downloads).values({ hash: 'h1', titleId: t.id, season: 1, kind: 'episode', episodes: [], state: 'downloading', name: 'x', size: 1, addedAt: 1 }).returning().get();
  fq.torrents.set('h1', { hash: 'h1', name: 'x', state: 'stoppedDL', progress: 0.1, dlspeed: 0, eta: 0, size: 1, num_seeds: 0, save_path: '/d', content_path: '/d/x', category: 'dublyarr', files: [], paused: true });
  const list = await call('GET', 'downloads');
  expect(list.body).toEqual([expect.objectContaining({ id: d.id, hash: 'h1', state: 'downloading', title: 'Эль' })]);
  const one = await call('GET', `downloads/${d.id}`);
  expect(one.body).toMatchObject({ id: d.id, qbit: { state: 'stoppedDL' }, qbitFiles: [] });
  expect((await call('GET', 'downloads/999')).status).toBe(404);
});

test('logs: каталога нет — пустой список', async () => {
  const { call } = api();
  expect(await call('GET', 'logs?area=qbit')).toEqual({ status: 200, body: [] });
});

test('журнал запросов API: имя токена видно (не маскируется как секрет)', async () => {
  const { Writable } = await import('node:stream');
  const { setLogDestination, applyLogSettings } = await import('@/lib/log');
  const lines: Record<string, unknown>[] = [];
  setLogDestination(new Writable({ write(c, _e, cb) { for (const l of String(c).trim().split('\n')) lines.push(JSON.parse(l)); cb(); } }));
  applyLogSettings({ level: 'info', areas: {} });
  const { call, token } = api();
  await call('GET', 'status');
  const row = lines.find((l) => l.area === 'api' && l.msg === 'api')!;
  expect(row).toMatchObject({ tokenName: 'claude', status: 200 });
  expect(JSON.stringify(lines)).not.toContain(token);
});

test('notifications: последние события с доставками и получатели (чат и события учёток)', async () => {
  const { call, db } = api();
  const { users } = await import('@/lib/db/schema');
  const { notify } = await import('@/lib/notify');
  const u = db.insert(users).values({ username: 'admin', passwordHash: 'x', telegramChatId: '42', createdAt: 1, updatedAt: 1 }).returning().get();
  db.insert(users).values({ username: 'anya', passwordHash: 'x', role: 'user', permissions: {}, createdAt: 1, updatedAt: 1 }).run();
  notify(db, { key: 'import:1', kind: 'downloaded', text: '📥 A · S01E01' }, 5);
  const r = await call('GET', 'notifications');
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({
    recipients: [
      { user: 'admin', chat: '42', disabled: false, events: { downloaded: true, ask: true } },
      { user: 'anya', chat: null },
    ],
    notifications: [{ key: 'import:1', kind: 'downloaded', text: '📥 A · S01E01', createdAt: 5, sentAt: null, deliveries: [{ user: 'admin', chatId: '42', sentAt: null, error: null, attempts: 0 }] }],
  });
  expect(u.id).toBeGreaterThan(0);
});
