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
