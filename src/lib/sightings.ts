import { and, eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { episodes, releases, studioSightings, type Release } from './db/schema';
import { getSetting, setSetting } from './settings';

// Когда Dublyarr впервые увидел серию в озвучке студии (spec §9) — основа прогноза.

/** Наблюдения из раздач сериала: только «тот сериал» и распознанные студии; остаётся более ранняя дата. */
export function recordSightings(db: Db, titleId: number, list: Release[]) {
  const dated = db.select().from(episodes).where(eq(episodes.titleId, titleId)).all();
  for (const r of list) {
    if (r.titleId !== titleId || r.match.level !== 'match') continue;
    const p = r.parsed;
    if (p.seasons.length !== 1) continue;
    const season = p.seasons[0];
    const studioIds = [...new Set(p.dubs.map((d) => d.studioId).filter((x): x is number => x !== null))];
    if (!studioIds.length) continue;
    const numbers = p.episodes
      ? Array.from({ length: p.episodes.to - p.episodes.from + 1 }, (_, i) => p.episodes!.from + i)
      : dated.filter((e) => e.season === season && e.airDate).map((e) => e.number);
    const published = r.publishedAt !== null && r.publishedAt < r.firstSeenAt;
    const seenAt = published ? r.publishedAt! : r.firstSeenAt;
    const fromPack = p.pack || numbers.length > 1;
    for (const studioId of studioIds)
      for (const number of numbers) {
        const key = and(eq(studioSightings.titleId, titleId), eq(studioSightings.studioId, studioId), eq(studioSightings.season, season), eq(studioSightings.number, number));
        const prev = db.select().from(studioSightings).where(key).get();
        if (!prev) {
          db.insert(studioSightings).values({ titleId, studioId, season, number, seenAt, basis: published ? 'published' : 'seen', fromPack }).onConflictDoNothing().run();
          continue;
        }
        const earlier = seenAt < prev.seenAt;
        const single = prev.fromPack && !fromPack;
        if (earlier || single)
          db.update(studioSightings)
            .set({ ...(earlier ? { seenAt, basis: published ? ('published' as const) : ('seen' as const) } : {}), fromPack: prev.fromPack && fromPack })
            .where(eq(studioSightings.id, prev.id))
            .run();
      }
  }
}

/** Раздачи, найденные до появления наблюдений, — один раз за жизнь базы. */
export function backfillSightings(db: Db) {
  if (getSetting<boolean>(db, 'sightings.backfilled')) return;
  const all = db.select().from(releases).all();
  for (const titleId of new Set(all.map((r) => r.titleId))) recordSightings(db, titleId, all.filter((r) => r.titleId === titleId));
  setSetting(db, 'sightings.backfilled', true);
}
