import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { getSetting, setSetting, getSecretSetting, setSecretSetting } from '@/lib/settings';
import { appSettings } from '@/lib/db/schema';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');

test('обычные и секретные настройки', () => {
  const db = testDb();
  setSetting(db, 'paths', { media: '/media' });
  expect(getSetting(db, 'paths')).toEqual({ media: '/media' });
  setSecretSetting(db, 'qbittorrent', { url: 'http://q', password: 'pw' });
  expect(getSecretSetting(db, 'qbittorrent')).toEqual({ url: 'http://q', password: 'pw' });
  const raw = db.select().from(appSettings).all().find((r) => r.key === 'qbittorrent')!;
  expect(raw.encrypted).toBe(true);
  expect(raw.value).not.toContain('pw');
  expect(getSetting(db, 'nope')).toBeUndefined();
});
