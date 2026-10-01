import { expect, test } from 'vitest';
import { formatSize, qualityLabel } from '@/lib/format';

test('размер', () => {
  expect(formatSize(2.3 * 1024 ** 3)).toBe('2,3 ГБ');
  expect(formatSize(20 * 1024 ** 3)).toBe('20 ГБ');
  expect(formatSize(612 * 1024 ** 2)).toBe('612 МБ');
  expect(formatSize(1.5 * 1024 ** 4)).toBe('1,5 ТБ');
});

test('качество', () => {
  expect(qualityLabel({ resolution: 2160, source: 'webdl', hdr: true, dv: true })).toBe('2160p · WEB-DL · DV');
  expect(qualityLabel({ resolution: 1080, source: 'remux', hdr: false, dv: false })).toBe('1080p · Remux');
  expect(qualityLabel({ resolution: null, source: 'webrip', hdr: true, dv: false })).toBe('WEBRip · HDR');
  expect(qualityLabel({ resolution: null, source: null, hdr: false, dv: false })).toBe('—');
});
