import { and, eq } from "drizzle-orm";
import type { Db } from "./index.js";
import { blacklist } from "./schema.js";

export type BlacklistRow = typeof blacklist.$inferSelect;

/** Заносит раздачу в blacklist; повторный вызов с тем же guid — no-op (UNIQUE). */
export function blacklistRelease(
  db: Db,
  titleId: number,
  releaseGuid: string,
  reason: string,
): void {
  db.insert(blacklist)
    .values({ titleId, releaseGuid, reason })
    .onConflictDoNothing({ target: [blacklist.titleId, blacklist.releaseGuid] })
    .run();
}

export function isBlacklisted(db: Db, titleId: number, releaseGuid: string): boolean {
  const row = db
    .select({ id: blacklist.id })
    .from(blacklist)
    .where(and(eq(blacklist.titleId, titleId), eq(blacklist.releaseGuid, releaseGuid)))
    .get();
  return row != null;
}

export function listBlacklist(db: Db, titleId: number): BlacklistRow[] {
  return db.select().from(blacklist).where(eq(blacklist.titleId, titleId)).all();
}
