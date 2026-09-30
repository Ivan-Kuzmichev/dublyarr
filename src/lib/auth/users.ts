import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { hashPassword } from './password';
import { encrypt, decrypt } from '../crypto/secretbox';

export type User = typeof users.$inferSelect;

const countUsers = (db: Pick<Db, 'select'>) => db.select({ n: sql<number>`count(*)` }).from(users).get()?.n ?? 0;

export const hasAnyUser = (db: Db) => countUsers(db) > 0;

/** Пользователь в системе один: второй не создаётся. */
export async function createUser(db: Db, username: string, password: string): Promise<User> {
  const hash = await hashPassword(password);
  return db.transaction((tx) => {
    if (countUsers(tx) > 0) throw new Error('Пользователь уже создан');
    const now = Date.now();
    return tx.insert(users).values({ username: username.trim(), passwordHash: hash, createdAt: now, updatedAt: now }).returning().get();
  });
}

export const findUserByName = (db: Db, username: string) => db.select().from(users).where(eq(users.username, username.trim())).get();
export const getUser = (db: Db, id: number) => db.select().from(users).where(eq(users.id, id)).get();

export async function setPassword(db: Db, userId: number, password: string) {
  const passwordHash = await hashPassword(password);
  db.update(users).set({ passwordHash, updatedAt: Date.now() }).where(eq(users.id, userId)).run();
}

/** Сохраняет новый (ещё не включённый) секрет; `null` выключает 2FA. */
export function setTotpSecret(db: Db, userId: number, secretB32: string | null) {
  db.update(users)
    .set({ totpSecretEnc: secretB32 ? encrypt(secretB32) : null, totpEnabled: false, totpLastStep: null, updatedAt: Date.now() })
    .where(eq(users.id, userId))
    .run();
}

export const enableTotp = (db: Db, userId: number) =>
  db.update(users).set({ totpEnabled: true, updatedAt: Date.now() }).where(eq(users.id, userId)).run();

export const getTotpSecret = (u: User) => (u.totpSecretEnc ? decrypt(u.totpSecretEnc) : null);

export const markTotpStep = (db: Db, userId: number, step: number) =>
  db.update(users).set({ totpLastStep: step }).where(eq(users.id, userId)).run();
