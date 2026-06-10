import { randomUUID } from "node:crypto";
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./index.js";
import { downloads } from "./schema.js";

export type DownloadStatus =
  | "queued"
  | "downloading"
  | "completed"
  | "failed"
  | "imported";

/** Статусы, которые обновляются по qBittorrent при GET /api/downloads. */
export const REFRESHABLE_STATUSES: DownloadStatus[] = [
  "queued",
  "downloading",
  "completed",
];

export interface Download {
  id: number;
  titleId: number;
  releaseGuid: string;
  releaseTitle: string;
  qbitHash: string | null;
  tag: string;
  episodesCovered: number[];
  voiceoverStudio: string | null;
  qualitySource: string | null;
  qualityResolution: string | null;
  status: DownloadStatus;
  progress: number;
  error: string | null;
  createdAt: string;
}

export interface DownloadInput {
  titleId: number;
  releaseGuid: string;
  releaseTitle: string;
  episodesCovered: number[];
  voiceoverStudio: string | null;
  qualitySource: string | null;
  qualityResolution: string | null;
}

type Row = typeof downloads.$inferSelect;

function rowToDownload(row: Row): Download {
  return { ...row, episodesCovered: JSON.parse(row.episodesCovered) as number[] };
}

export function createDownload(db: Db, input: DownloadInput): Download {
  const row = db
    .insert(downloads)
    .values({
      titleId: input.titleId,
      releaseGuid: input.releaseGuid,
      releaseTitle: input.releaseTitle,
      tag: `dublyarr-${randomUUID()}`,
      episodesCovered: JSON.stringify(input.episodesCovered),
      voiceoverStudio: input.voiceoverStudio,
      qualitySource: input.qualitySource,
      qualityResolution: input.qualityResolution,
    })
    .returning()
    .get();
  return rowToDownload(row);
}

export function getDownload(db: Db, id: number): Download | null {
  const row = db.select().from(downloads).where(eq(downloads.id, id)).get();
  return row ? rowToDownload(row) : null;
}

export function listDownloadsForTitle(db: Db, titleId: number): Download[] {
  return db
    .select()
    .from(downloads)
    .where(eq(downloads.titleId, titleId))
    .orderBy(desc(downloads.id))
    .all()
    .map(rowToDownload);
}

export interface DownloadPatch {
  qbitHash?: string | null;
  status?: DownloadStatus;
  progress?: number;
  error?: string | null;
}

export function updateDownload(
  db: Db,
  id: number,
  patch: DownloadPatch,
): Download | null {
  if (Object.keys(patch).length === 0) return getDownload(db, id);
  const row = db
    .update(downloads)
    .set(patch)
    .where(eq(downloads.id, id))
    .returning()
    .get();
  return row ? rowToDownload(row) : null;
}

export function deleteDownload(db: Db, id: number): void {
  db.delete(downloads).where(eq(downloads.id, id)).run();
}

export function listActiveDownloads(db: Db): Download[] {
  return db
    .select()
    .from(downloads)
    .where(inArray(downloads.status, REFRESHABLE_STATUSES))
    .orderBy(desc(downloads.id))
    .all()
    .map(rowToDownload);
}

export function countActiveDownloads(db: Db): number {
  const row = db
    .select({ c: sql<number>`count(*)` })
    .from(downloads)
    .where(inArray(downloads.status, REFRESHABLE_STATUSES))
    .get();
  return row?.c ?? 0;
}
