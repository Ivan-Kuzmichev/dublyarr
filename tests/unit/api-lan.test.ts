import { expect, test } from 'vitest';
import { isPrivateAddress, allLocal } from '@/lib/api/lan';

test('частные адреса', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.1', '192.168.1.10', '169.254.1.1', '::1', 'fd00::1', 'fe80::1', '::ffff:192.168.1.10', '::ffff:127.0.0.1'])
    expect(isPrivateAddress(ip), ip).toBe(true);
  for (const ip of ['8.8.8.8', '172.32.0.1', '100.64.0.1', '2a00:1450::1', '::ffff:8.8.8.8', '', 'мусор'])
    expect(isPrivateAddress(ip), ip).toBe(false);
});

test('цепочка прокси: все адреса частные — локальный; внешний где угодно — нет', () => {
  expect(allLocal({ forwardedFor: '192.168.1.5', realIp: null, forwarded: null })).toBe(true);
  // Pangolin: внешний клиент, затем туннель
  expect(allLocal({ forwardedFor: '203.0.113.7, 172.18.0.3', realIp: null, forwarded: null })).toBe(false);
  // подделка: клиент прислал частный адрес, прокси дописал настоящий внешний
  expect(allLocal({ forwardedFor: '192.168.1.5, 203.0.113.7', realIp: null, forwarded: null })).toBe(false);
  expect(allLocal({ forwardedFor: '192.168.1.5', realIp: '203.0.113.7', forwarded: null })).toBe(false);
  expect(allLocal({ forwardedFor: '192.168.1.5', realIp: null, forwarded: 'for=203.0.113.7;proto=https' })).toBe(false);
  expect(allLocal({ forwardedFor: '192.168.1.5', realIp: null, forwarded: 'for="[2a00:1450::1]:443"' })).toBe(false);
  expect(allLocal({ forwardedFor: null, realIp: null, forwarded: null })).toBe(false); // адрес неизвестен — не пускаем
});
