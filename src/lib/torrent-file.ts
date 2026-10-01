import { createHash } from 'node:crypto';
import { base32Decode } from './auth/totp';

// Разбор .torrent (bencode): infohash и список файлов. Хэш — SHA-1 исходных байт словаря info, без перекодирования.

export class TorrentFileError extends Error {}

type Decoded = { value: unknown; end: number };

function decodeAt(buf: Buffer, pos: number, onInfo?: (start: number, end: number) => void, key?: string): Decoded {
  const c = buf[pos];
  if (c === 0x69) {
    // i<число>e
    const end = buf.indexOf(0x65, pos);
    if (end < 0) throw new TorrentFileError('Это не торрент-файл');
    return { value: Number(buf.subarray(pos + 1, end).toString()), end: end + 1 };
  }
  if (c === 0x6c) {
    // l…e
    const list: unknown[] = [];
    let p = pos + 1;
    while (buf[p] !== 0x65) {
      if (p >= buf.length) throw new TorrentFileError('Это не торрент-файл');
      const d = decodeAt(buf, p, onInfo);
      list.push(d.value);
      p = d.end;
    }
    return { value: list, end: p + 1 };
  }
  if (c === 0x64) {
    // d…e
    const map = new Map<string, unknown>();
    let p = pos + 1;
    while (buf[p] !== 0x65) {
      if (p >= buf.length) throw new TorrentFileError('Это не торрент-файл');
      const k = decodeAt(buf, p);
      if (!Buffer.isBuffer(k.value)) throw new TorrentFileError('Это не торрент-файл');
      const name = k.value.toString('utf8');
      const v = decodeAt(buf, k.end, onInfo, name);
      if (name === 'info' && key === undefined) onInfo?.(k.end, v.end);
      map.set(name, v.value);
      p = v.end;
    }
    return { value: map, end: p + 1 };
  }
  if (c >= 0x30 && c <= 0x39) {
    // <длина>:<байты>
    const colon = buf.indexOf(0x3a, pos);
    const len = Number(buf.subarray(pos, colon).toString());
    if (colon < 0 || !Number.isFinite(len) || colon + 1 + len > buf.length) throw new TorrentFileError('Это не торрент-файл');
    return { value: buf.subarray(colon + 1, colon + 1 + len), end: colon + 1 + len };
  }
  throw new TorrentFileError('Это не торрент-файл');
}

export function bdecode(buf: Buffer): unknown {
  return decodeAt(buf, 0).value;
}

export function bencode(v: unknown): Buffer {
  if (typeof v === 'number') return Buffer.from(`i${Math.trunc(v)}e`);
  if (typeof v === 'string') return bencode(Buffer.from(v));
  if (Buffer.isBuffer(v)) return Buffer.concat([Buffer.from(`${v.length}:`), v]);
  if (Array.isArray(v)) return Buffer.concat([Buffer.from('l'), ...v.map(bencode), Buffer.from('e')]);
  if (v instanceof Map) {
    const keys = [...v.keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    return Buffer.concat([Buffer.from('d'), ...keys.flatMap((k) => [bencode(Buffer.from(k)), bencode(v.get(k))]), Buffer.from('e')]);
  }
  throw new TorrentFileError('Нельзя закодировать значение');
}

export type TorrentMeta = { infohash: string; name: string; files: { index: number; path: string; size: number }[] };

const str = (v: unknown) => (Buffer.isBuffer(v) ? v.toString('utf8') : '');

export function parseTorrent(buf: Buffer): TorrentMeta {
  let range: [number, number] | null = null;
  let root: unknown;
  try {
    root = decodeAt(buf, 0, (s, e) => (range = [s, e])).value;
  } catch {
    throw new TorrentFileError('Это не торрент-файл');
  }
  const info = root instanceof Map ? root.get('info') : undefined;
  if (!(info instanceof Map) || !range) throw new TorrentFileError('Это не торрент-файл');
  const [s, e] = range as [number, number];
  const name = str(info.get('name'));
  const filesRaw = info.get('files');
  const files = Array.isArray(filesRaw)
    ? filesRaw.map((f, index) => {
        const m = f as Map<string, unknown>;
        return { index, path: ((m.get('path') as unknown[]) ?? []).map(str).join('/'), size: Number(m.get('length') ?? 0) };
      })
    : [{ index: 0, path: name, size: Number(info.get('length') ?? 0) }];
  return { infohash: createHash('sha1').update(buf.subarray(s, e)).digest('hex'), name, files };
}

/** Хэш из magnet-ссылки: btih в hex (40) или base32 (32). */
export function magnetHash(magnet: string): string | null {
  const m = /xt=urn:btih:([a-z0-9]+)/i.exec(magnet);
  if (!m) return null;
  if (/^[0-9a-f]{40}$/i.test(m[1])) return m[1].toLowerCase();
  if (/^[a-z2-7]{32}$/i.test(m[1])) return base32Decode(m[1]).toString('hex');
  return null;
}
