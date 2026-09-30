import { expect, test } from 'vitest';
import { hashPassword, verifyPassword, validateNewPassword } from '@/lib/auth/password';
import { newToken, hashToken } from '@/lib/auth/tokens';

test('argon2: верный/неверный пароль, битый хэш', async () => {
  const h = await hashPassword('длинный-пароль');
  expect(h).toMatch(/^\$argon2id\$/);
  expect(await verifyPassword(h, 'длинный-пароль')).toBe(true);
  expect(await verifyPassword(h, 'другой-пароль')).toBe(false);
  expect(await verifyPassword('мусор', 'x')).toBe(false);
});

test('правило пароля', () => {
  expect(validateNewPassword('123456789')).toBe('Пароль — не короче 10 символов');
  expect(validateNewPassword('1234567890')).toBeNull();
});

test('токены', () => {
  const t = newToken();
  expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(newToken()).not.toBe(t);
  expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
  expect(hashToken(t)).toBe(hashToken(t));
});
