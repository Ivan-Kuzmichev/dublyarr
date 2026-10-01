import { and, eq, isNull, or } from 'drizzle-orm';
import type { Db } from './db/client';
import { releaseRules } from './db/schema';
import { baseOf } from './parse/names';

/** Ответ пользователя «это он / не он» для трекера (или любого трекера, если null) и основы заголовка. */
export function addRule(db: Db, titleId: number, trackerName: string | null, title: string, verdict: 'match' | 'reject') {
  const pattern = baseOf(title);
  const where = and(
    eq(releaseRules.titleId, titleId),
    eq(releaseRules.pattern, pattern),
    trackerName === null ? isNull(releaseRules.trackerName) : eq(releaseRules.trackerName, trackerName),
  );
  const existing = db.select().from(releaseRules).where(where).get();
  if (existing) db.update(releaseRules).set({ verdict }).where(eq(releaseRules.id, existing.id)).run();
  else db.insert(releaseRules).values({ titleId, trackerName, pattern, verdict, createdAt: Date.now() }).run();
}

/** Правило для раздачи: сначала для этого трекера, затем общее. */
export function ruleFor(db: Db, titleId: number, trackerName: string, title: string): 'match' | 'reject' | undefined {
  const rows = db
    .select()
    .from(releaseRules)
    .where(and(eq(releaseRules.titleId, titleId), eq(releaseRules.pattern, baseOf(title)), or(eq(releaseRules.trackerName, trackerName), isNull(releaseRules.trackerName))))
    .all();
  return (rows.find((r) => r.trackerName === trackerName) ?? rows.find((r) => r.trackerName === null))?.verdict;
}
