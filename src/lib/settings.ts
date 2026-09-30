import { eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { appSettings } from './db/schema';
import { encrypt, decrypt } from './crypto/secretbox';

function write(db: Db, key: string, value: string, encrypted: boolean) {
  const row = { key, value, encrypted, updatedAt: Date.now() };
  db.insert(appSettings).values(row).onConflictDoUpdate({ target: appSettings.key, set: row }).run();
}

function read(db: Db, key: string) {
  return db.select().from(appSettings).where(eq(appSettings.key, key)).get();
}

export function setSetting(db: Db, key: string, value: unknown) {
  write(db, key, JSON.stringify(value), false);
}

export function getSetting<T>(db: Db, key: string): T | undefined {
  const r = read(db, key);
  return r && !r.encrypted ? (JSON.parse(r.value) as T) : undefined;
}

export function setSecretSetting(db: Db, key: string, value: unknown) {
  write(db, key, encrypt(JSON.stringify(value)), true);
}

export function getSecretSetting<T>(db: Db, key: string): T | undefined {
  const r = read(db, key);
  return r && r.encrypted ? (JSON.parse(decrypt(r.value)) as T) : undefined;
}
