import { eq } from "drizzle-orm";
import { QUALITY_LADDER } from "../quality.js";
import type { Db } from "./index.js";
import { qualityPresets } from "./schema.js";

export interface QualityPreset {
  id: number;
  name: string;
  allowed: string[];
  preferred: string;
  upgradeEnabled: boolean;
}

export interface PresetInput {
  name: string;
  allowed: string[];
  preferred: string;
  upgradeEnabled: boolean;
}

export type PresetResult =
  | { ok: true; preset: QualityPreset }
  | { ok: false; error: string };

type Row = typeof qualityPresets.$inferSelect;

function rowToPreset(row: Row): QualityPreset {
  return {
    id: row.id,
    name: row.name,
    allowed: JSON.parse(row.allowed) as string[],
    preferred: row.preferred,
    upgradeEnabled: row.upgradeEnabled === 1,
  };
}

function validate(input: PresetInput): string | null {
  if (!input.name.trim()) return "Укажите имя пресета";
  if (input.allowed.length === 0) return "Отметьте хотя бы одно качество";
  const known = new Set(QUALITY_LADDER.map((q) => q.key));
  for (const key of input.allowed) {
    if (!known.has(key)) return `Неизвестное качество: ${key}`;
  }
  if (!input.allowed.includes(input.preferred)) {
    return "Предпочитаемое качество должно быть среди отмеченных";
  }
  return null;
}

function toRow(input: PresetInput) {
  return {
    name: input.name.trim(),
    allowed: JSON.stringify(input.allowed),
    preferred: input.preferred,
    upgradeEnabled: input.upgradeEnabled ? 1 : 0,
  };
}

export function listPresets(db: Db): QualityPreset[] {
  return db.select().from(qualityPresets).all().map(rowToPreset);
}

export function getPreset(db: Db, id: number): QualityPreset | null {
  const row = db.select().from(qualityPresets).where(eq(qualityPresets.id, id)).get();
  return row ? rowToPreset(row) : null;
}

export function createPreset(db: Db, input: PresetInput): PresetResult {
  const error = validate(input);
  if (error) return { ok: false, error };
  try {
    const row = db.insert(qualityPresets).values(toRow(input)).returning().get();
    return { ok: true, preset: rowToPreset(row) };
  } catch {
    return { ok: false, error: "Пресет с таким именем уже существует" };
  }
}

export function updatePreset(db: Db, id: number, input: PresetInput): PresetResult {
  const error = validate(input);
  if (error) return { ok: false, error };
  try {
    const row = db
      .update(qualityPresets)
      .set(toRow(input))
      .where(eq(qualityPresets.id, id))
      .returning()
      .get();
    if (!row) return { ok: false, error: "Пресет не найден" };
    return { ok: true, preset: rowToPreset(row) };
  } catch {
    return { ok: false, error: "Пресет с таким именем уже существует" };
  }
}

export function deletePreset(db: Db, id: number): { ok: boolean; error?: string } {
  try {
    db.delete(qualityPresets).where(eq(qualityPresets.id, id)).run();
    return { ok: true };
  } catch {
    return { ok: false, error: "Пресет используется отслеживаемыми тайтлами" };
  }
}
