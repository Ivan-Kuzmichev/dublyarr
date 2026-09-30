import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// TOTP по RFC 6238: SHA-1, 6 цифр, шаг 30 секунд — то, что понимают все приложения-аутентификаторы.

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHA[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHA[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHA.indexOf(ch);
    if (i < 0) throw new Error('Неверный base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const generateTotpSecret = () => base32Encode(randomBytes(20));
export const currentStep = (nowMs: number) => Math.floor(nowMs / 30_000);

export function totpAt(secretB32: string, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32Decode(secretB32)).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

/** Окно ±1 шаг; шаги не новее уже использованного отклоняются (защита от повтора кода). */
export function verifyTotp(
  secretB32: string,
  code: string,
  nowMs: number,
  lastUsedStep: number | null,
): { ok: true; step: number } | { ok: false } {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return { ok: false };
  const now = currentStep(nowMs);
  for (const step of [now - 1, now, now + 1]) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    if (timingSafeEqual(Buffer.from(totpAt(secretB32, step)), Buffer.from(c))) return { ok: true, step };
  }
  return { ok: false };
}

export function otpauthUri(secretB32: string, username: string): string {
  return `otpauth://totp/Dublyarr:${encodeURIComponent(username)}?secret=${secretB32}&issuer=Dublyarr&algorithm=SHA1&digits=6&period=30`;
}
