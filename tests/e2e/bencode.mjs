// Минимальный bencode для заглушек e2e (Jackett и qBittorrent).
import { createHash } from 'node:crypto';

export function bencode(v) {
  if (typeof v === 'number') return Buffer.from(`i${Math.trunc(v)}e`);
  if (typeof v === 'string') return bencode(Buffer.from(v));
  if (Buffer.isBuffer(v)) return Buffer.concat([Buffer.from(`${v.length}:`), v]);
  if (Array.isArray(v)) return Buffer.concat([Buffer.from('l'), ...v.map(bencode), Buffer.from('e')]);
  const keys = Object.keys(v).sort();
  return Buffer.concat([Buffer.from('d'), ...keys.flatMap((k) => [bencode(k), bencode(v[k])]), Buffer.from('e')]);
}

function decodeAt(buf, pos) {
  const c = buf[pos];
  if (c === 0x69) {
    const end = buf.indexOf(0x65, pos);
    return { value: Number(buf.subarray(pos + 1, end).toString()), end: end + 1 };
  }
  if (c === 0x6c || c === 0x64) {
    const out = c === 0x6c ? [] : {};
    const ranges = {};
    let p = pos + 1;
    while (buf[p] !== 0x65) {
      if (c === 0x6c) {
        const d = decodeAt(buf, p);
        out.push(d.value);
        p = d.end;
      } else {
        const k = decodeAt(buf, p);
        const v = decodeAt(buf, k.end);
        out[k.value.toString()] = v.value;
        ranges[k.value.toString()] = [k.end, v.end];
        p = v.end;
      }
    }
    if (c === 0x64) Object.defineProperty(out, '__ranges', { value: ranges });
    return { value: out, end: p + 1 };
  }
  const colon = buf.indexOf(0x3a, pos);
  const len = Number(buf.subarray(pos, colon).toString());
  return { value: buf.subarray(colon + 1, colon + 1 + len), end: colon + 1 + len };
}

/** Торрент → { hash, name, files: [{ name, size }] } (имена как у qBittorrent: с корневой папкой у многофайловых). */
export function readTorrent(buf) {
  const root = decodeAt(buf, 0).value;
  const [s, e] = root.__ranges.info;
  const info = root.info;
  const name = info.name.toString();
  const files = info.files
    ? info.files.map((f) => ({ name: `${name}/${f.path.map((x) => x.toString()).join('/')}`, size: f.length }))
    : [{ name, size: info.length }];
  return { hash: createHash('sha1').update(buf.subarray(s, e)).digest('hex'), name, files };
}

export function makeTorrent(name, files) {
  const info = { name, 'piece length': 262144, pieces: Buffer.alloc(20) };
  if (files) info.files = files.map((f) => ({ length: 1024, path: [f] }));
  else info.length = 1024;
  return bencode({ announce: 'http://tracker.local/announce', info });
}
