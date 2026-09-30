import { expect, test } from 'vitest';
import { isSecureRequest, cookieOptions } from '@/lib/auth/cookies';

const h = (m: Record<string, string>) => ({ get: (n: string) => m[n.toLowerCase()] ?? null });

test('http в LAN — без Secure, за https-прокси — с Secure', () => {
  expect(isSecureRequest(h({}))).toBe(false);
  expect(isSecureRequest(h({ 'x-forwarded-proto': 'https' }))).toBe(true);
  expect(cookieOptions(false).secure).toBe(false);
  expect(cookieOptions(true, 1000)).toEqual({ httpOnly: true, sameSite: 'lax', path: '/', secure: true, expires: new Date(1000) });
  expect(cookieOptions(false)).not.toHaveProperty('expires');
});
