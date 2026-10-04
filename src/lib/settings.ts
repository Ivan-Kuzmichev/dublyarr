import { eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { appSettings } from './db/schema';
import { encrypt, decrypt, SecretDecryptError } from './crypto/secretbox';

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

/** Для форм: секрет, который не расшифровать (сменили ключ), считается не сохранённым — его введут заново. */
export function tryGetSecretSetting<T>(db: Db, key: string): T | undefined {
  try {
    return getSecretSetting<T>(db, key);
  } catch (e) {
    if (e instanceof SecretDecryptError) return undefined;
    throw e;
  }
}

export function deleteSetting(db: Db, key: string) {
  db.delete(appSettings).where(eq(appSettings.key, key)).run();
}
