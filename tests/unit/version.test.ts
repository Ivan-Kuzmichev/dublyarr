import { afterEach, expect, test } from 'vitest';
import { appVersion } from '@/lib/version';
import pkg from '../../package.json';

afterEach(() => void delete process.env.DUBLYARR_VERSION);

test('версия: из образа (DUBLYARR_VERSION), иначе — из package.json', () => {
  process.env.DUBLYARR_VERSION = '9.9.9';
  expect(appVersion()).toBe('9.9.9');
  delete process.env.DUBLYARR_VERSION;
  expect(appVersion()).toBe(pkg.version);
  process.env.DUBLYARR_VERSION = 'edge'; // сборка из main
  expect(appVersion()).toBe(`${pkg.version} (edge)`);
});
