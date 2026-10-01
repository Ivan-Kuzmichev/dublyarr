import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { apiTokens } from '../db/schema';
import { getSetting, setSetting } from '../settings';
import { hashToken, newToken } from '../auth/tokens';
import { allLocal } from './lan';

// Токены API: в базе только хэш; API по умолчанию выключен и доступен только из локальной сети.

export const getApiEnabled = (db: Db) => getSetting<{ enabled: boolean }>(db, 'api')?.enabled ?? false;
export const setApiEnabled = (db: Db, on: boolean) => setSetting(db, 'api', { enabled: on });

/** Новый токен — показывается один раз. */
export function createApiToken(db: Db, name: string, now = Date.now()) {
  const token = `dy_${newToken()}`;
  const row = db
    .insert(apiTokens)
    .values({ name: name.trim() || 'Токен', hash: hashToken(token), prefix: token.slice(0, 8), createdAt: now })
    .returning({ id: apiTokens.id })
    .get();
  return { id: row.id, token };
}

export const listApiTokens = (db: Db) =>
  db
    .select({ id: apiTokens.id, name: apiTokens.name, prefix: apiTokens.prefix, createdAt: apiTokens.createdAt, lastUsedAt: apiTokens.lastUsedAt, lastIp: apiTokens.lastIp })
    .from(apiTokens)
    .orderBy(apiTokens.id)
    .all();

export const revokeApiToken = (db: Db, id: number) => db.delete(apiTokens).where(eq(apiTokens.id, id)).run();

export type ApiHeaders = { authorization: string | null; forwardedFor: string | null; realIp: string | null; forwarded: string | null };

/** Порядок: выключен → 403; не локальная сеть → 403; нет/чужой токен → 401. */
export function checkApiAccess(db: Db, h: ApiHeaders, now = Date.now()): { ok: true; tokenName: string } | { status: 401 | 403; error: string } {
  if (!getApiEnabled(db)) return { status: 403, error: 'API выключен' };
  if (!allLocal(h)) return { status: 403, error: 'Только из локальной сети' };
  const token = /^Bearer\s+(\S+)$/i.exec(h.authorization ?? '')?.[1];
  const row = token ? db.select().from(apiTokens).where(eq(apiTokens.hash, hashToken(token))).get() : undefined;
  if (!row) return { status: 401, error: 'Нужен токен API' };
  db.update(apiTokens)
    .set({ lastUsedAt: now, lastIp: h.forwardedFor?.split(',')[0].trim() || null })
    .where(eq(apiTokens.id, row.id))
    .run();
  return { ok: true, tokenName: row.name };
}
