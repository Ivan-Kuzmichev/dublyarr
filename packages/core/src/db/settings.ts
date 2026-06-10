import { eq } from "drizzle-orm";
import type { Db } from "./index.js";
import { settings } from "./schema.js";

export const SETTING_KEYS = [
  "tmdb_api_key",
  "jackett_url",
  "jackett_api_key",
  "qbit_url",
  "qbit_username",
  "qbit_password",
  "library_movies",
  "library_tv",
  "staging_dir",
  "naming_tv",
  "naming_movie",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

export function getSetting(db: Db, key: SettingKey): string | null {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? null;
}

export function setSetting(db: Db, key: SettingKey, value: string): void {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

export function getAllSettings(db: Db): Record<SettingKey, string | null> {
  const out = {} as Record<SettingKey, string | null>;
  for (const k of SETTING_KEYS) out[k] = getSetting(db, k);
  return out;
}
