import { and, eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { wantedState, type EpisodeRef } from './db/schema';
import { notifyWanted } from './notify-events';

// Почему нужная серия (или фильм) ещё не качается: ждём до даты / нет раздач / нужен ответ.

export function setWanted(db: Db, titleId: number, ep: EpisodeRef, state: 'waiting' | 'missing' | 'ask', reason: string, until: string | null, now: number, releaseId: number | null = null) {
  const prev = db
    .select({ state: wantedState.state })
    .from(wantedState)
    .where(and(eq(wantedState.titleId, titleId), eq(wantedState.season, ep.season), eq(wantedState.number, ep.number)))
    .get();
  const row = { titleId, season: ep.season, number: ep.number, state, reason, until, releaseId, checkedAt: now };
  db.insert(wantedState)
    .values(row)
    .onConflictDoUpdate({ target: [wantedState.titleId, wantedState.season, wantedState.number], set: row })
    .run();
  notifyWanted(db, row, prev?.state ?? null, now);
}
export const clearWanted = (db: Db, titleId: number, ep: EpisodeRef) =>
  db.delete(wantedState).where(and(eq(wantedState.titleId, titleId), eq(wantedState.season, ep.season), eq(wantedState.number, ep.number))).run();
