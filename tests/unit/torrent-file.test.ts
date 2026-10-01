import { expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { bencode, bdecode, parseTorrent, magnetHash, TorrentFileError } from '@/lib/torrent-file';

const b = (s: string) => Buffer.from(s);
const single = new Map<string, unknown>([
  ['name', b('Game.of.Thrones.S01E03.mkv')],
  ['length', 2147483648],
  ['piece length', 262144],
  ['pieces', Buffer.alloc(20)],
]);
const multi = new Map<string, unknown>([
  [
    'files',
    [
      new Map<string, unknown>([['length', 100], ['path', [b('Season 1'), b('S01E01.mkv')]]]),
      new Map<string, unknown>([['length', 200], ['path', [b('Season 1'), b('S01E02.mkv')]]]),
      new Map<string, unknown>([['length', 5], ['path', [b('readme.txt')]]]),
    ],
  ],
  ['name', b('Game of Thrones S01')],
  ['piece length', 262144],
  ['pieces', Buffer.alloc(20)],
]);
const torrent = (info: Map<string, unknown>, extra: [string, unknown][] = []) =>
  bencode(new Map<string, unknown>([['announce', b('http://tracker/ann')], ...extra, ['info', info]]));
const sha1 = (buf: Buffer) => createHash('sha1').update(buf).digest('hex');

test('bencode ↔ bdecode', () => {
  const v = new Map<string, unknown>([['a', 1], ['b', [b('x'), 2]]]);
  const back = bdecode(bencode(v)) as Map<string, unknown>;
  expect(back.get('a')).toBe(1);
  expect((back.get('b') as unknown[])[1]).toBe(2);
  expect(bencode(-3).toString()).toBe('i-3e');
});

test('однофайловый торрент', () => {
  const m = parseTorrent(torrent(single));
  expect(m).toEqual({ infohash: sha1(bencode(single)), name: 'Game.of.Thrones.S01E03.mkv', files: [{ index: 0, path: 'Game.of.Thrones.S01E03.mkv', size: 2147483648 }] });
});

test('многофайловый торрент; хэш не зависит от полей вне info', () => {
  const m = parseTorrent(torrent(multi));
  expect(m.name).toBe('Game of Thrones S01');
  expect(m.files).toEqual([
    { index: 0, path: 'Season 1/S01E01.mkv', size: 100 },
    { index: 1, path: 'Season 1/S01E02.mkv', size: 200 },
    { index: 2, path: 'readme.txt', size: 5 },
  ]);
  expect(parseTorrent(torrent(multi, [['comment', b('другой')]])).infohash).toBe(m.infohash);
  expect(m.infohash).toBe(sha1(bencode(multi)));
});

test('мусор', () => {
  expect(() => parseTorrent(Buffer.from('<html>not found</html>'))).toThrow(TorrentFileError);
  expect(() => parseTorrent(bencode(new Map([['announce', b('x')]])))).toThrow('Это не торрент-файл');
});

test('хэш из magnet', () => {
  expect(magnetHash('magnet:?xt=urn:btih:AAAA1111BBBB2222CCCC3333DDDD4444EEEE5555&dn=x')).toBe('aaaa1111bbbb2222cccc3333dddd4444eeee5555');
  // base32 тех же 20 байт
  const hex = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555';
  const bytes = Buffer.from(hex, 'hex');
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0, b32 = '';
  for (const x of bytes) {
    value = (value << 8) | x;
    bits += 8;
    while (bits >= 5) {
      b32 += ALPHA[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  expect(magnetHash(`magnet:?xt=urn:btih:${b32}`)).toBe(hex);
  expect(magnetHash('magnet:?dn=x')).toBeNull();
});
