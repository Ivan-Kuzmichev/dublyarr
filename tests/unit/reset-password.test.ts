import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { createUser, setTotpSecret, enableTotp, getUser, findUserByName } from '@/lib/auth/users';
import { createSession, validateSession } from '@/lib/auth/sessions';
import { verifyPassword } from '@/lib/auth/password';
import { resetPassword } from '@/cli/reset-password';
import { users } from '@/lib/db/schema';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');

test('сброс пароля завершает сеансы; --disable-2fa выключает 2FA', async () => {
  const db = testDb();
  await expect(resetPassword(db, { password: 'новый-пароль-1', disable2fa: false })).rejects.toThrow('Пользователь ещё не создан');
  const u = await createUser(db, 'admin', 'старый-пароль-1');
  setTotpSecret(db, u.id, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  enableTotp(db, u.id);
  const s = createSession(db, { userId: u.id, persistent: true, userAgent: null, ip: null });
  await expect(resetPassword(db, { password: 'короткий', disable2fa: false })).rejects.toThrow('не короче 10');
  expect(await resetPassword(db, { password: 'новый-пароль-1', disable2fa: false })).toEqual({ username: 'admin' });
  expect(await verifyPassword(findUserByName(db, 'admin')!.passwordHash, 'новый-пароль-1')).toBe(true);
  expect(validateSession(db, s.token)).toBeNull();
  expect(getUser(db, u.id)!.totpEnabled).toBe(true);
  await resetPassword(db, { password: 'новый-пароль-2', disable2fa: true });
  expect(getUser(db, u.id)!.totpEnabled).toBe(false);
});

test('--user: сброс нужной учётки; без него — первый админ; неизвестный логин — ошибка', async () => {
  const db = testDb();
  await createUser(db, 'admin', 'старый-пароль-1');
  db.insert(users).values({ username: 'anya', passwordHash: 'x', role: 'user', createdAt: 1, updatedAt: 1 }).run();
  expect(await resetPassword(db, { username: 'anya', password: 'новый-пароль-1', disable2fa: false })).toEqual({ username: 'anya' });
  expect(await verifyPassword(findUserByName(db, 'anya')!.passwordHash, 'новый-пароль-1')).toBe(true);
  expect(await resetPassword(db, { password: 'новый-пароль-2', disable2fa: false })).toEqual({ username: 'admin' });
  await expect(resetPassword(db, { username: 'nobody', password: 'новый-пароль-3', disable2fa: false })).rejects.toThrow('Нет учётки «nobody»');
});
