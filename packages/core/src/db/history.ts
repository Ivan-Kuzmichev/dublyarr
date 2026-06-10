import { and, desc, eq, max } from "drizzle-orm";
import type { Db } from "./index.js";
import { history } from "./schema.js";

export type HistoryKind =
  | "search"
  | "grab"
  | "import"
  | "upgrade"
  | "fail"
  | "not_found";

export interface HistoryEvent {
  id: number;
  titleId: number | null;
  kind: HistoryKind;
  message: string;
  createdAt: string;
}

export interface HistoryInput {
  titleId: number | null;
  kind: HistoryKind;
  message: string;
  /** По умолчанию — datetime('now') на стороне БД. */
  createdAt?: string;
}

export function addHistory(db: Db, input: HistoryInput): HistoryEvent {
  const values = {
    titleId: input.titleId,
    kind: input.kind,
    message: input.message,
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
  };
  return db.insert(history).values(values).returning().get() as HistoryEvent;
}

export function listHistory(db: Db, limit: number, offset: number): HistoryEvent[] {
  return db
    .select()
    .from(history)
    .orderBy(desc(history.id))
    .limit(limit)
    .offset(offset)
    .all() as HistoryEvent[];
}

/** ISO-время последнего события kind=search для тайтла (для рейт-лимита) или null. */
export function recentSearchAt(db: Db, titleId: number): string | null {
  const row = db
    .select({ t: max(history.createdAt) })
    .from(history)
    .where(and(eq(history.titleId, titleId), eq(history.kind, "search")))
    .get();
  return row?.t ?? null;
}
