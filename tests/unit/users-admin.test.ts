import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { createUser } from '@/lib/auth/users';
import { createSession, validateSession } from '@/lib/auth/sessions';
import { verifyPassword } from '@/lib/auth/password';
import { createUserByAdmin, updateUser, deleteUser, resetUserPassword, listUsers, UserAdminError } from '@/lib/users-admin';
import { subscriptions, titles, users } from '@/lib/db/schema';
import { DEFAULT_PERMISSIONS } from '@/lib/auth/permissions';

process.env.DUBLYARR_SECRET_KEY ??= randomBytes(32).toString('base64');

async function setup() {
  const db = testDb();
  const admin = await createUser(db, 'admin', 'пароль-длинный');
  return { db, admin };
}

test('создание: логин, временный пароль, права по умолчанию; логин занят — ошибка', async () => {
  const { db } = await setup();
  const u = await createUserByAdmin(db, { username: ' anya ', password: 'временный-пароль', role: 'user' });
  expect(u).toMatchObject({ username: 'anya', role: 'user', permissions: DEFAULT_PERMISSIONS, disabled: false });
  expect(await verifyPassword(u.passwordHash, 'временный-пароль')).toBe(true);
  await expect(createUserByAdmin(db, { username: 'anya', password: 'временный-пароль', role: 'user' })).rejects.toThrow('Логин занят');
  await expect(createUserByAdmin(db, { username: 'x', password: 'короткий', role: 'user' })).rejects.toThrow(UserAdminError);
  expect(listUsers(db).map((x) => x.username)).toEqual(['admin', 'anya']);
});

test('последний активный админ: нельзя разжаловать, выключить, удалить; себя удалить нельзя', async () => {
  const { db, admin } = await setup();
  expect(() => updateUser(db, admin.id, admin.id, { role: 'user' })).toThrow('Нельзя оставить Dublyarr без администратора');
  expect(() => updateUser(db, admin.id, admin.id, { disabled: true })).toThrow('Нельзя оставить Dublyarr без администратора');
  expect(() => deleteUser(db, admin.id, admin.id)).toThrow('Нельзя удалить себя');
  const second = await createUserByAdmin(db, { username: 'boss', password: 'временный-пароль', role: 'admin' });
  expect(() => deleteUser(db, second.id, admin.id)).not.toThrow(); // второй админ удаляет первого — админ остаётся
});

test('выключение и сброс пароля завершают сеансы; права сохраняются', async () => {
  const { db, admin } = await setup();
  const u = await createUserByAdmin(db, { username: 'anya', password: 'временный-пароль', role: 'user' });
  const s = createSession(db, { userId: u.id, persistent: false, userAgent: null, ip: null });
  updateUser(db, admin.id, u.id, { permissions: { ...DEFAULT_PERMISSIONS, storage: true } });
  expect(db.select().from(users).all().find((x) => x.id === u.id)!.permissions.storage).toBe(true);
  updateUser(db, admin.id, u.id, { disabled: true });
  expect(validateSession(db, s.token)).toBeNull();
  updateUser(db, admin.id, u.id, { disabled: false });
  const s2 = createSession(db, { userId: u.id, persistent: false, userAgent: null, ip: null });
  await resetUserPassword(db, u.id, 'новый-пароль-1');
  expect(validateSession(db, s2.token)).toBeNull();
});

test('удаление: подписки остаются без автора', async () => {
  const { db, admin } = await setup();
  const u = await createUserByAdmin(db, { username: 'anya', password: 'временный-пароль', role: 'user' });
  const t = db.insert(titles).values({ tmdbId: 1, kind: 'series', nameRu: 'A', nameOriginal: 'A', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  db.insert(subscriptions).values({ titleId: t.id, profile: {} as never, subscribedAt: 1, updatedAt: 1, addedBy: u.id }).run();
  deleteUser(db, admin.id, u.id);
  expect(db.select().from(subscriptions).get()!.addedBy).toBeNull();
  expect(listUsers(db).map((x) => x.username)).toEqual(['admin']);
});
