import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { can, isAdmin, DEFAULT_PERMISSIONS, migrateTelegramChat } from '@/lib/auth/permissions';
import { users } from '@/lib/db/schema';
import { getSecretSetting, getSetting, setSecretSetting, setSetting } from '@/lib/settings';

process.env.DUBLYARR_SECRET_KEY ??= randomBytes(32).toString('base64');

test('права: админ — всё, пользователь — флаги, выключенный — ничего', () => {
  const admin = { role: 'admin' as const, permissions: {}, disabled: false };
  const user = { role: 'user' as const, permissions: { ...DEFAULT_PERMISSIONS }, disabled: false };
  expect(isAdmin(admin)).toBe(true);
  expect(can(admin, 'storage')).toBe(true);
  expect(can(user, 'subscribe')).toBe(true);
  expect(can(user, 'storage')).toBe(false);
  expect(can({ ...admin, disabled: true }, 'subscribe')).toBe(false);
  expect(DEFAULT_PERMISSIONS).toEqual({ subscribe: true, search: true, answer: true, downloads: false, storage: false });
});

test('перенос чата Telegram и событий первому админу; повторно — ничего', () => {
  const db = testDb();
  const u = db.insert(users).values({ username: 'admin', passwordHash: 'x', createdAt: 1, updatedAt: 1 }).returning().get();
  expect(u.role).toBe('admin'); // существующие учётки — админы
  setSecretSetting(db, 'telegram', { token: 'T', chatId: '4242' });
  setSetting(db, 'telegram.events', { downloaded: false });
  migrateTelegramChat(db);
  const after = db.select().from(users).get()!;
  expect(after.telegramChatId).toBe('4242');
  expect(after.notifyEvents).toEqual({ downloaded: false });
  expect(getSecretSetting<{ chatId?: string }>(db, 'telegram')).toEqual({ token: 'T' });
  expect(getSetting(db, 'telegram.events')).toBeUndefined();
  migrateTelegramChat(db);
  expect(db.select().from(users).get()!.telegramChatId).toBe('4242');
});
