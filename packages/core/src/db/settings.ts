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
  "monitor_interval_min",
  "monitor_min_seeders",
  "monitor_stall_hours",
  "auth_password_hash",
  "auth_lan_bypass",
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

export const MONITOR_DEFAULTS = {
  monitor_interval_min: 15,
  monitor_min_seeders: 1,
  monitor_stall_hours: 6,
} as const;

/** Число из настроек с дефолтом и нижней границей 0; нечисло → дефолт. */
export function getMonitorNumber(
  db: Db,
  key: keyof typeof MONITOR_DEFAULTS,
): number {
  const raw = getSetting(db, key)?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : MONITOR_DEFAULTS[key];
}
