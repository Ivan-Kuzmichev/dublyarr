import { isIP } from 'node:net';

// «Только локальная сеть»: адрес клиента и все адреса цепочки прокси должны быть частными.

function v4Private(ip: string) {
  const [a, b] = ip.split('.').map(Number);
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

export function isPrivateAddress(raw: string): boolean {
  const ip = raw.trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return v4Private(mapped[1]);
  if (isIP(ip) === 4) return v4Private(ip);
  if (isIP(ip) === 6) {
    const l = ip.toLowerCase();
    return l === '::1' || /^f[cd][0-9a-f]{2}:/.test(l) || /^fe[89ab][0-9a-f]:/.test(l);
  }
  return false;
}

/** Адреса из заголовка Forwarded: for=1.2.3.4, for="[2001:db8::1]:443". */
function forwardedFor(v: string): string[] {
  return [...v.matchAll(/for="?([^;,"]+)"?/gi)].map((m) => {
    const a = m[1].trim();
    if (a.startsWith('[')) return a.slice(1, a.indexOf(']'));
    return /^\d+\.\d+\.\d+\.\d+:\d+$/.test(a) ? a.replace(/:\d+$/, '') : a;
  });
}

/** Next.js сам ставит X-Forwarded-For = адрес сокета, если заголовка нет; прокси (Pangolin) передаёт внешний адрес клиента. */
export function allLocal(h: { forwardedFor: string | null; realIp: string | null; forwarded: string | null }): boolean {
  const all = [...(h.forwardedFor?.split(',') ?? []), ...(h.realIp ? [h.realIp] : []), ...(h.forwarded ? forwardedFor(h.forwarded) : [])].map((s) => s.trim()).filter(Boolean);
  return all.length > 0 && all.every(isPrivateAddress);
}
