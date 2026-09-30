import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { recordFailure, isBlocked, clearFailures, MAX_FAILURES, WINDOW_MS } from '@/lib/auth/ratelimit';

test('10 неудач за 15 минут блокируют, окно скользит, сброс по успеху', () => {
  const db = testDb();
  const keys = ['ip:1.1.1.1', 'user:admin'];
  const t = 1_800_000_000_000;
  for (let i = 0; i < MAX_FAILURES - 1; i++) recordFailure(db, keys, t + i);
  expect(isBlocked(db, keys, t + 100)).toBe(false);
  recordFailure(db, keys, t + 100);
  expect(isBlocked(db, keys, t + 101)).toBe(true);
  expect(isBlocked(db, ['user:admin'], t + 101)).toBe(true); // блок по логину с другого IP
  expect(isBlocked(db, ['ip:2.2.2.2'], t + 101)).toBe(false);
  expect(isBlocked(db, keys, t + 100 + WINDOW_MS + 1)).toBe(false);
  clearFailures(db, keys);
  expect(isBlocked(db, keys, t + 101)).toBe(false);
});
