import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "./index.js";
import { episodes, files } from "./schema.js";

export type LibFile = typeof files.$inferSelect;

export interface FileInput {
  titleId: number;
  episodeId: number | null;
  path: string;
  size: number;
  qualitySource: string | null;
  qualityResolution: string | null;
  voiceoverStudio: string | null;
  releaseGuid: string | null;
}

/**
 * Добавляет файл и связывает с эпизодом если episodeId указан.
 * Если у эпизода уже есть файл, file_id перезаписывается.
 * Удаление старой записи (deleteFileRecord) на совести вызывающего.
 */
export function addFile(db: Db, input: FileInput): LibFile {
  return db.transaction((tx) => {
    const row = tx.insert(files).values(input).returning().get();
    if (input.episodeId != null) {
      tx.update(episodes)
        .set({ fileId: row.id })
        .where(eq(episodes.id, input.episodeId))
        .run();
    }
    return row;
  });
}

export function getFile(db: Db, id: number): LibFile | null {
  return db.select().from(files).where(eq(files.id, id)).get() ?? null;
}

export function listFiles(db: Db, titleId: number): LibFile[] {
  return db
    .select()
    .from(files)
    .where(eq(files.titleId, titleId))
    .orderBy(asc(files.path))
    .all();
}

/**
 * Удаляет запись и отвязывает эпизоды; саму запись возвращает для unlink на диске.
 */
export function deleteFileRecord(db: Db, id: number): LibFile | null {
  return db.transaction((tx) => {
    const row = getFile(db, id);
    if (!row) return null;
    tx.update(episodes).set({ fileId: null }).where(eq(episodes.fileId, id)).run();
    tx.delete(files).where(eq(files.id, id)).run();
    return row;
  });
}

export interface TitleFileStats {
  files: number;
  missingWanted: number;
}

/**
 * Для бейджей «✓ / ⏳» на главной: число файлов и wanted-эпизодов без файла.
 * Тайтлы без файлов и без missing-wanted отсутствуют в Map.
 * Потребитель должен коалесцировать: `?? {files:0, missingWanted:0}`.
 */
export function titleFileStats(db: Db): Map<number, TitleFileStats> {
  const out = new Map<number, TitleFileStats>();
  const fileCounts = db
    .select({ titleId: files.titleId, c: sql<number>`count(*)` })
    .from(files)
    .groupBy(files.titleId)
    .all();
  for (const r of fileCounts) out.set(r.titleId, { files: r.c, missingWanted: 0 });
  const missing = db
    .select({ titleId: episodes.titleId, c: sql<number>`count(*)` })
    .from(episodes)
    .where(and(eq(episodes.wanted, 1), isNull(episodes.fileId)))
    .groupBy(episodes.titleId)
    .all();
  for (const r of missing) {
    const e = out.get(r.titleId) ?? { files: 0, missingWanted: 0 };
    e.missingWanted = r.c;
    out.set(r.titleId, e);
  }
  return out;
}
