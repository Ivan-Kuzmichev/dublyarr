import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** Хеширует пароль: "scrypt:<salt-hex>:<hash-hex>". */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hex] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hex) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(hex, "hex");
  } catch {
    return false;
  }
  const candidate = scryptSync(password, salt, 32);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("hex");
}

/**
 * Токен сессии "exp.hmac". Ключ подписи — сам хеш пароля:
 * смена пароля автоматически инвалидирует все сессии.
 */
export function createSession(
  passwordHash: string,
  ttlMs: number = 30 * 24 * 3600 * 1000,
  now: number = Date.now(),
): string {
  if (!passwordHash) throw new Error("createSession: passwordHash обязателен");
  const exp = String(now + ttlMs);
  return `${exp}.${sign(exp, passwordHash)}`;
}

export function verifySession(
  token: string,
  passwordHash: string,
  now: number = Date.now(),
): boolean {
  if (!passwordHash) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const exp = token.slice(0, dot);
  const sig = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(exp, passwordHash));
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return false;
  const expMs = Number(exp);
  return Number.isFinite(expMs) && expMs > now;
}

/** Приватный адрес: RFC1918, loopback, link-local, ULA/fe80, ::ffff:-маппинг. */
export function isPrivateIp(ip: string): boolean {
  if (!ip) return false;
  if (ip === "::1") return true;
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const m = v4.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const oct = m.slice(1, 5).map(Number);
    if (oct.some((n) => n > 255)) return false; // не валидный IPv4 → не приватный
    const [a, b] = oct;
    if (a === 10 || a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  const low = ip.toLowerCase();
  return low.startsWith("fc") || low.startsWith("fd") || low.startsWith("fe80");
}
