import { expect, test } from 'vitest';
import { safeNext } from '@/lib/auth/safe-next';

test('после входа — только свои относительные пути', () => {
  expect(safeNext('/library')).toBe('/library');
  expect(safeNext('/settings/security?x=1')).toBe('/settings/security?x=1');
  expect(safeNext(null)).toBe('/');
  expect(safeNext('')).toBe('/');
  expect(safeNext('//evil.example')).toBe('/');
  expect(safeNext('/\\evil.example')).toBe('/');
  expect(safeNext('https://evil.example')).toBe('/');
  expect(safeNext('/login')).toBe('/');
});

test('управляющие символы не уводят на чужой сайт', () => {
  // браузер выбрасывает \t \n \r из URL: '/\t/evil.com' превращается в '//evil.com'
  expect(safeNext('/\t/evil.example')).toBe('/');
  expect(safeNext('/\n/evil.example')).toBe('/');
  expect(safeNext('/\r\n/evil.example')).toBe('/');
  expect(safeNext('/%09/evil.example')).toBe('/%09/evil.example'); // закодированный — безопасный путь
});
