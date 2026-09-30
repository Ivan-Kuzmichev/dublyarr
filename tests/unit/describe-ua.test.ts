import { expect, test } from 'vitest';
import { describeUserAgent } from '@/lib/auth/describe-ua';

test.each([
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 'Safari · iPhone'],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36', 'Chrome · macOS'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0', 'Firefox · Windows'],
  ['Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36', 'Chrome · Android'],
  [null, 'Неизвестное устройство'],
  ['curl/8.0', 'Неизвестное устройство'],
])('%s', (ua, expected) => expect(describeUserAgent(ua)).toBe(expected));
