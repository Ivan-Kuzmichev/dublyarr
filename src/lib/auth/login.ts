import type { Db } from '../db/client';
import { findUserByName, getUser, getTotpSecret, markTotpStep } from './users';
import { hashPassword, verifyPassword } from './password';
import { verifyTotp } from './totp';
import { SecretDecryptError } from '../crypto/secretbox';
import { isBlocked, recordFailure, clearFailures } from './ratelimit';
import { logger } from '../log';

const alog = logger('auth');
import {
  createSession,
  createPendingLogin,
  getPendingLogin,
  deletePendingLogin,
  isTrustedDevice,
  createTrustedDevice,
} from './sessions';

type Ctx = { ip: string; userAgent: string | null; trustToken: string | null; now?: number };

const BLOCKED = 'Слишком много попыток. Подождите 15 минут.';
const WRONG_KEY = 'Ключ шифрования не подходит к базе. Выключите 2FA: dublyarr reset-password --disable-2fa';

// Для несуществующего логина всё равно считаем argon2 — время ответа не выдаёт, есть ли такой пользователь.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword('dublyarr-dummy-password'));

export type PasswordResult =
  | { kind: 'error'; message: string }
  | { kind: 'session'; token: string; expiresAt: number; persistent: boolean }
  | { kind: 'need-code'; pendingToken: string };

export async function passwordStep(
  db: Db,
  i: { username: string; password: string; remember: boolean },
  ctx: Ctx,
): Promise<PasswordResult> {
  const now = ctx.now ?? Date.now();
  const username = i.username.trim();
  const keys = [`ip:${ctx.ip}`, `user:${username}`];
  if (isBlocked(db, keys, now)) return { kind: 'error', message: BLOCKED };
  // Попытка считается неудачной заранее, до await: иначе параллельные запросы
  // успевают пройти isBlocked, пока считается argon2. При успехе счётчик сбрасывается.
  recordFailure(db, keys, now);
  const user = findUserByName(db, username);
  const ok = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), i.password);
  if (!user || !ok) {
    alog.info({ username, ip: ctx.ip }, 'login failed');
    return { kind: 'error', message: 'Неверный логин или пароль' };
  }
  if (user.totpEnabled && !(ctx.trustToken && isTrustedDevice(db, ctx.trustToken, user.id, now))) {
    return { kind: 'need-code', pendingToken: createPendingLogin(db, user.id, i.remember, now) };
  }
  clearFailures(db, keys);
  const s = createSession(db, { userId: user.id, persistent: i.remember, userAgent: ctx.userAgent, ip: ctx.ip }, now);
  alog.info({ username, ip: ctx.ip }, 'login');
  return { kind: 'session', ...s, persistent: i.remember };
}

export type CodeResult =
  | { kind: 'error'; message: string }
  | { kind: 'session'; token: string; expiresAt: number; persistent: boolean; trust?: { token: string; expiresAt: number } };

export function codeStep(db: Db, i: { pendingToken: string; code: string; trustDevice: boolean }, ctx: Ctx): CodeResult {
  const now = ctx.now ?? Date.now();
  const p = getPendingLogin(db, i.pendingToken, now);
  const user = p ? getUser(db, p.userId) : undefined;
  if (!p || !user) return { kind: 'error', message: 'Вход устарел, начните заново' };
  const keys = [`ip:${ctx.ip}`, `user:${user.username}`];
  if (isBlocked(db, keys, now)) return { kind: 'error', message: BLOCKED };
  let secret: string | null;
  try {
    secret = getTotpSecret(user);
  } catch (e) {
    if (e instanceof SecretDecryptError) return { kind: 'error', message: WRONG_KEY };
    throw e;
  }
  const v = secret ? verifyTotp(secret, i.code, now, user.totpLastStep) : ({ ok: false } as const);
  if (!v.ok) {
    recordFailure(db, keys, now);
    alog.info({ username: user.username, ip: ctx.ip }, 'login code failed');
    return { kind: 'error', message: 'Неверный код' };
  }
  markTotpStep(db, user.id, v.step);
  deletePendingLogin(db, i.pendingToken);
  clearFailures(db, keys);
  const s = createSession(db, { userId: user.id, persistent: p.remember, userAgent: ctx.userAgent, ip: ctx.ip }, now);
  const trust = i.trustDevice ? createTrustedDevice(db, user.id, ctx.userAgent, now) : undefined;
  alog.info({ username: user.username, ip: ctx.ip }, 'login');
  return { kind: 'session', ...s, persistent: p.remember, trust };
}
