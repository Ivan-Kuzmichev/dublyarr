import { eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { sources } from './db/schema';
import { decrypt, encrypt } from './crypto/secretbox';

export function addSource(db: Db, s: { name: string; url: string; apiKey: string }) {
  return db
    .insert(sources)
    .values({ name: s.name.trim(), url: s.url.trim(), apiKeyEnc: s.apiKey ? encrypt(s.apiKey) : null, createdAt: Date.now() })
    .returning({ id: sources.id })
    .get();
}

/** Без ключей: они нужны только воркеру. */
export const listSources = (db: Db) =>
  db.select({ id: sources.id, name: sources.name, url: sources.url, enabled: sources.enabled }).from(sources).all();

export const removeSource = (db: Db, id: number) => db.delete(sources).where(eq(sources.id, id)).run();

/** Включённые источники с расшифрованными ключами — только для запросов к ним. */
export function sourcesForSearch(db: Db) {
  return db
    .select()
    .from(sources)
    .where(eq(sources.enabled, true))
    .orderBy(sources.id)
    .all()
    .map((s) => ({ id: s.id, name: s.name, url: s.url, apiKey: s.apiKeyEnc ? decrypt(s.apiKeyEnc) : '', timeoutMs: s.timeoutMs }));
}
