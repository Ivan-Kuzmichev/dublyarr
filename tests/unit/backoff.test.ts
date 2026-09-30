import { expect, test } from 'vitest';
import { restartDelay, shouldResetFailures } from '@/entry/backoff';

test('экспоненциальная задержка с потолком', () => {
  expect([0, 1, 2, 3, 4, 5, 10].map(restartDelay)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  expect(shouldResetFailures(59_999)).toBe(false);
  expect(shouldResetFailures(60_000)).toBe(true);
});
