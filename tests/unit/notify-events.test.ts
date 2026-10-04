import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDbWithChat } from './helpers';
import { checkSourcesDown, notifyWanted } from '@/lib/notify-events';
import { addNotice } from '@/lib/notices';
import { DEFAULT_EVENTS } from '@/lib/notify';
import { notifications, releases, sources, titles, users } from '@/lib/db/schema';
import { saveTelegramSettings } from '@/lib/telegram';
import type { ParsedRelease } from '@/lib/parse/types';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const MIN = 60_000;

function setup() {
  const db = testDbWithChat();
  const t = db.insert(titles).values({ tmdbId: 1399, kind: 'series', nameRu: 'Игра престолов', nameOriginal: 'GoT', originalLanguage: 'en', status: 'ended', createdAt: 1, refreshedAt: 1 }).returning().get();
  const s = db.insert(sources).values({ name: 'Jackett', url: 'http://j', createdAt: 1 }).returning().get();
  const parsed = { base: 'x', names: [], year: null, seasons: [1], episodes: null, totalInSeason: null, absolute: false, pack: true, resolution: 1080, source: null, hdr: false, dv: false, screener: false, dubs: [], original: false, subs: false } as ParsedRelease;
  const r = db.insert(releases).values({ titleId: t.id, sourceId: s.id, trackerName: 'RuTracker', title: 'Игра престолов S01 [сомнительно]', size: 1, firstSeenAt: 1, lastSeenAt: 1, parsed, match: { score: 0.6, level: 'doubt', reasons: [] } }).returning().get();
  const all = () => db.select().from(notifications).all();
  return { db, t, s, r, all };
}

test('вопрос «тот ли сериал» — с кнопками и ссылкой; только при переходе в ask', () => {
  const { db, t, r, all } = setup();
  saveTelegramSettings(db, { token: 'x', baseUrl: 'http://nas:3000/' });
  notifyWanted(db, { titleId: t.id, season: 1, number: 3, state: 'ask', reason: 'Похоже, но год не совпадает', releaseId: r.id, until: null }, null, 5);
  notifyWanted(db, { titleId: t.id, season: 1, number: 3, state: 'ask', reason: 'Похоже, но год не совпадает', releaseId: r.id, until: null }, 'ask', 6);
  expect(all()).toEqual([
    expect.objectContaining({
      kind: 'ask',
      text: '❓ Игра престолов · S01E03: Похоже, но год не совпадает\nИгра престолов S01 [сомнительно]',
      buttons: [[{ text: 'Это он', data: `m:${r.id}` }, { text: 'Не тот сериал', data: `r:${r.id}` }], [{ text: 'Открыть', url: 'http://nas:3000/search/1399?s=1&e=3' }]],
      ref: { releaseId: r.id, titleId: t.id },
    }),
  ]);
});

test('вышел оригинал — если событие включено', () => {
  const { db, t, all } = setup();
  notifyWanted(db, { titleId: t.id, season: 1, number: 4, state: 'waiting', reason: 'Рано', releaseId: null, until: '2026-10-02' }, null, 5);
  expect(all()).toEqual([]);
  db.update(users).set({ notifyEvents: { ...DEFAULT_EVENTS, original: true } }).run();
  notifyWanted(db, { titleId: t.id, season: 1, number: 4, state: 'waiting', reason: 'Рано', releaseId: null, until: '2026-10-02' }, null, 5);
  expect(all().map((n) => n.text)).toEqual(['🕐 Вышла Игра престолов · S01E04 в оригинале — озвучку ждём до 2 окт']);
});

test('источник не отвечает больше часа — одно сообщение; восстановился — одно', () => {
  const { db, s, all } = setup();
  db.update(sources).set({ failingSince: Date.parse('2026-09-30T11:20:00Z') }).run();
  checkSourcesDown(db, Date.parse('2026-09-30T11:50:00Z'));
  expect(all()).toEqual([]);
  checkSourcesDown(db, Date.parse('2026-09-30T12:21:00Z'));
  checkSourcesDown(db, Date.parse('2026-09-30T12:30:00Z'));
  expect(all().map((n) => n.text)).toEqual([expect.stringMatching(/^🔌 Jackett не отвечает с \d\d:\d\d$/)]);
  db.update(sources).set({ failingSince: null }).run();
  checkSourcesDown(db, Date.parse('2026-09-30T13:00:00Z'));
  checkSourcesDown(db, Date.parse('2026-09-30T13:01:00Z'));
  expect(all().map((n) => n.text)[1]).toBe('✅ Jackett снова отвечает');
  expect(all()).toHaveLength(2);
  void s;
  void MIN;
});

test('заметка о новом сезоне уходит в Telegram', () => {
  const { db, t, all } = setup();
  addNotice(db, t.id, 'season-subscribed', 'Подписался на 2-й сезон', 5);
  expect(all().map((n) => n.text)).toEqual(['🗓 Игра престолов: Подписался на 2-й сезон']);
});
