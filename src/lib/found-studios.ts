import { eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { releases } from './db/schema';

/** Студии, чьи раздачи этого сериала уже нашлись (studioId → сколько раздач); отклонённые («не тот сериал») не считаются. */
export function foundStudios(db: Db, titleId: number): Record<number, number> {
  const out: Record<number, number> = {};
  for (const r of db.select({ parsed: releases.parsed, match: releases.match }).from(releases).where(eq(releases.titleId, titleId)).all()) {
    if (r.match.level === 'reject') continue;
    for (const id of new Set(r.parsed.dubs.map((d) => d.studioId).filter((x): x is number => x !== null))) out[id] = (out[id] ?? 0) + 1;
  }
  return out;
}
