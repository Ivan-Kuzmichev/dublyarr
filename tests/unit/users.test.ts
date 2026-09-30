import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { createUser, hasAnyUser, setTotpSecret, enableTotp, getUser, getTotpSecret, setPassword, findUserByName } from '@/lib/auth/users';
import { verifyPassword } from '@/lib/auth/password';
import { users } from '@/lib/db/schema';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');

test('второго пользователя создать нельзя', async () => {
  const db = testDb();
  expect(hasAnyUser(db)).toBe(false);
  await createUser(db, 'admin', 'пароль-длинный');
  expect(hasAnyUser(db)).toBe(true);
  await expect(createUser(db, 'other', 'пароль-длинный')).rejects.toThrow('Пользователь уже создан');
});

test('TOTP-секрет хранится зашифрованным; выключение сбрасывает', async () => {
  const db = testDb();
  const u = await createUser(db, 'admin', 'пароль-длинный');
  setTotpSecret(db, u.id, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  expect(db.select().from(users).get()!.totpSecretEnc).not.toContain('GEZD');
  expect(getUser(db, u.id)!.totpEnabled).toBe(false);
  enableTotp(db, u.id);
  expect(getTotpSecret(getUser(db, u.id)!)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  setTotpSecret(db, u.id, null);
  const after = getUser(db, u.id)!;
  expect(after.totpEnabled).toBe(false);
  expect(getTotpSecret(after)).toBeNull();
});

test('смена пароля', async () => {
  const db = testDb();
  const u = await createUser(db, 'admin', 'пароль-длинный');
  await setPassword(db, u.id, 'новый-пароль-123');
  expect(await verifyPassword(findUserByName(db, 'admin')!.passwordHash, 'новый-пароль-123')).toBe(true);
});
