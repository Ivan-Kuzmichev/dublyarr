import { and, desc, eq, gt, lte, ne } from 'drizzle-orm';
import type { Db } from '../db/client';
import { sessions, pendingLogins, trustedDevices } from '../db/schema';
import { newToken, hashToken } from './tokens';
import { getUser, type User } from './users';

// В БД хранятся только sha256 от токенов: утечка базы не даёт готовых cookie.

const DAY = 86_400_000;
export const SESSION_TTL_PERSISTENT = 30 * DAY;
export const SESSION_TTL_SHORT = DAY;
export const PENDING_TTL = 5 * 60_000;
export const TRUST_TTL = 30 * DAY;

export type Session = typeof sessions.$inferSelect;

const ttl = (persistent: boolean) => (persistent ? SESSION_TTL_PERSISTENT : SESSION_TTL_SHORT);

export function createSession(
  db: Db,
  a: { userId: number; persistent: boolean; userAgent: string | null; ip: string | null },
  now = Date.now(),
) {
  const token = newToken();
  const expiresAt = now + ttl(a.persistent);
  db.insert(sessions)
    .values({ id: hashToken(token), ...a, createdAt: now, lastSeenAt: now, expiresAt })
    .run();
  return { token, expiresAt };
}

/** Проверяет сеанс и продлевает его (скользящее окно). */
export function validateSession(db: Db, token: string, now = Date.now()): { session: Session; user: User } | null {
  const id = hashToken(token);
  const s = db.select().from(sessions).where(eq(sessions.id, id)).get();
  if (!s) return null;
  if (s.expiresAt <= now) {
    db.delete(sessions).where(eq(sessions.id, id)).run();
    return null;
  }
  const user = getUser(db, s.userId);
  if (!user) return null;
  const upd = { lastSeenAt: now, expiresAt: now + ttl(s.persistent) };
  db.update(sessions).set(upd).where(eq(sessions.id, id)).run();
  return { session: { ...s, ...upd }, user };
}

export const revokeSession = (db: Db, token: string) => db.delete(sessions).where(eq(sessions.id, hashToken(token))).run();
export const revokeSessionById = (db: Db, id: string) => db.delete(sessions).where(eq(sessions.id, id)).run();

export function revokeAllSessions(db: Db, userId: number, exceptId?: string) {
  db.delete(sessions)
    .where(exceptId ? and(eq(sessions.userId, userId), ne(sessions.id, exceptId)) : eq(sessions.userId, userId))
    .run();
}

export function listSessions(db: Db, userId: number, now = Date.now()): Session[] {
  db.delete(sessions).where(lte(sessions.expiresAt, now)).run();
  return db.select().from(sessions).where(eq(sessions.userId, userId)).orderBy(desc(sessions.lastSeenAt)).all();
}

export function createPendingLogin(db: Db, userId: number, remember: boolean, now = Date.now()): string {
  const token = newToken();
  db.insert(pendingLogins)
    .values({ id: hashToken(token), userId, remember, expiresAt: now + PENDING_TTL })
    .run();
  return token;
}

/** Не удаляет запись: при неверном коде можно попробовать ещё раз. */
export function getPendingLogin(db: Db, token: string, now = Date.now()) {
  const p = db
    .select()
    .from(pendingLogins)
    .where(and(eq(pendingLogins.id, hashToken(token)), gt(pendingLogins.expiresAt, now)))
    .get();
  return p ? { userId: p.userId, remember: p.remember } : null;
}

export const deletePendingLogin = (db: Db, token: string) =>
  db.delete(pendingLogins).where(eq(pendingLogins.id, hashToken(token))).run();

export function createTrustedDevice(db: Db, userId: number, userAgent: string | null, now = Date.now()) {
  const token = newToken();
  const expiresAt = now + TRUST_TTL;
  db.insert(trustedDevices).values({ id: hashToken(token), userId, userAgent, createdAt: now, expiresAt }).run();
  return { token, expiresAt };
}

export function isTrustedDevice(db: Db, token: string, userId: number, now = Date.now()) {
  return !!db
    .select()
    .from(trustedDevices)
    .where(and(eq(trustedDevices.id, hashToken(token)), eq(trustedDevices.userId, userId), gt(trustedDevices.expiresAt, now)))
    .get();
}

export const revokeTrustedDevices = (db: Db, userId: number) =>
  db.delete(trustedDevices).where(eq(trustedDevices.userId, userId)).run();

export function getPendingUsername(db: Db, token: string, now = Date.now()): string | null {
  const p = getPendingLogin(db, token, now);
  return p ? (getUser(db, p.userId)?.username ?? null) : null;
}
