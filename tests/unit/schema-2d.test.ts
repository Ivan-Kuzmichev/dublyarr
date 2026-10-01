import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { notifications, sources, titles, wantedState } from '@/lib/db/schema';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');

test('уведомления: уникальный ключ; новые колонки', () => {
  const db = testDb();
  const n = db.insert(notifications).values({ key: 'import:1', kind: 'downloaded', text: 'x', createdAt: 1, nextAt: 1 }).returning().get();
  expect(n).toMatchObject({ attempts: 0, sentAt: null, messageId: null, buttons: null, ref: null });
  expect(() => db.insert(notifications).values({ key: 'import:1', kind: 'downloaded', text: 'y', createdAt: 2, nextAt: 2 }).run()).toThrow();
  const t = db.insert(titles).values({ tmdbId: 1, kind: 'series', nameRu: 'A', nameOriginal: 'A', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  const w = db.insert(wantedState).values({ titleId: t.id, season: 1, number: 1, state: 'ask', reason: 'r', checkedAt: 1 }).returning().get();
  expect(w.releaseId).toBeNull();
  const s = db.insert(sources).values({ name: 'J', url: 'http://j', createdAt: 1 }).returning().get();
  expect(s).toMatchObject({ failingSince: null, downNotified: false });
});
