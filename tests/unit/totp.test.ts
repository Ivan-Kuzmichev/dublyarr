import { expect, test } from 'vitest';
import { base32Encode, base32Decode, totpAt, verifyTotp, generateTotpSecret, otpauthUri, currentStep } from '@/lib/auth/totp';

// Векторы RFC 6238 (SHA-1, секрет ASCII "12345678901234567890"); из 8-значных кодов берём последние 6 цифр.
const secret = base32Encode(Buffer.from('12345678901234567890'));

test('base32', () => {
  expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  expect(base32Decode(secret.toLowerCase()).toString()).toBe('12345678901234567890');
});

test.each([
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
])('RFC 6238 t=%i', (t, code) => {
  expect(totpAt(secret, Math.floor(t / 30))).toBe(code);
});

test('окно ±1 шаг и нормализация', () => {
  const now = 1234567890_000;
  const s = currentStep(now);
  expect(verifyTotp(secret, totpAt(secret, s - 1), now, null)).toEqual({ ok: true, step: s - 1 });
  expect(verifyTotp(secret, ' ' + totpAt(secret, s + 1).replace(/(\d{3})/, '$1 '), now, null).ok).toBe(true);
  expect(verifyTotp(secret, totpAt(secret, s - 2), now, null).ok).toBe(false);
  expect(verifyTotp(secret, '12345', now, null).ok).toBe(false);
});

test('повтор того же кода отклоняется', () => {
  const now = 1234567890_000;
  const code = totpAt(secret, currentStep(now));
  const first = verifyTotp(secret, code, now, null);
  expect(first.ok).toBe(true);
  expect(verifyTotp(secret, code, now + 1000, first.ok ? first.step : null).ok).toBe(false);
});

test('секрет и URI', () => {
  const s = generateTotpSecret();
  expect(s).toMatch(/^[A-Z2-7]{32}$/);
  expect(otpauthUri(s, 'admin')).toBe(`otpauth://totp/Dublyarr:admin?secret=${s}&issuer=Dublyarr&algorithm=SHA1&digits=6&period=30`);
});
