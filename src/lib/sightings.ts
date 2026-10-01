import { eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { episodes, releases, studioSightings, type Release } from './db/schema';
import { getSetting, setSetting } from './settings';

// Когда Dublyarr впервые увидел серию в озвучке студии (spec §9) — основа прогноза.

/** Наблюдения из раздач сериала: только «тот сериал» и распознанные студии; остаётся более ранняя дата. */
export function recordSightings(db: Db, titleId: number, list: Release[]) {
  const dated = db.select().from(episodes).where(eq(episodes.titleId, titleId)).all();
  const airOf = new Map(dated.map((e) => [`${e.season}:${e.number}`, e.airDate]));
  const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  db.transaction((tx) => {
    // все наблюдения сериала — одним запросом; записи — одной транзакцией
    const known = new Map(
      tx
        .select()
        .from(studioSightings)
        .where(eq(studioSightings.titleId, titleId))
        .all()
        .map((x) => [`${x.studioId}:${x.season}:${x.number}`, x]),
    );
    for (const r of list) {
      if (r.titleId !== titleId || r.match.level !== 'match') continue;
      const p = r.parsed;
      if (p.seasons.length !== 1) continue;
      const season = p.seasons[0];
      const studioIds = [...new Set(p.dubs.map((d) => d.studioId).filter((x): x is number => x !== null))];
      if (!studioIds.length) continue;
      const published = r.publishedAt !== null && r.publishedAt < r.firstSeenAt;
      const seenAt = published ? r.publishedAt! : r.firstSeenAt;
      const seenDay = isoOf(seenAt);
      // пак без диапазона — только серии, вышедшие к моменту наблюдения
      const numbers = p.episodes
        ? Array.from({ length: p.episodes.to - p.episodes.from + 1 }, (_, i) => p.episodes!.from + i)
        : dated.filter((e) => e.season === season && e.airDate && e.airDate <= seenDay).map((e) => e.number);
      const fromPack = p.pack || numbers.length > 1;
      const basis = published ? ('published' as const) : ('seen' as const);
      for (const studioId of studioIds)
        for (const number of numbers) {
          const k = `${studioId}:${season}:${number}`;
          const prev = known.get(k);
          if (!prev) {
            const row = tx.insert(studioSightings).values({ titleId, studioId, season, number, seenAt, basis, fromPack }).onConflictDoNothing().returning().get();
            if (row) known.set(k, row);
            continue;
          }
          const air = airOf.get(`${season}:${number}`);
          // прежнее наблюдение раньше эфира — ошибочное (пак до выхода серии), его можно заменить более поздним
          const prevPreAir = !!air && isoOf(prev.seenAt) < air && seenDay >= air;
          const earlier = seenAt < prev.seenAt && !(air && seenDay < air && isoOf(prev.seenAt) >= air);
          const single = prev.fromPack && !fromPack;
          if (!earlier && !single && !prevPreAir) continue;
          const set = { ...(earlier || prevPreAir ? { seenAt, basis } : {}), fromPack: prev.fromPack && fromPack };
          tx.update(studioSightings).set(set).where(eq(studioSightings.id, prev.id)).run();
          known.set(k, { ...prev, ...set });
        }
    }
  });
}

/** Раздачи, найденные до появления наблюдений, — один раз за жизнь базы. */
export function backfillSightings(db: Db) {
  if (getSetting<boolean>(db, 'sightings.backfilled')) return;
  const all = db.select().from(releases).all();
  const byTitle = new Map<number, Release[]>();
  for (const r of all) byTitle.set(r.titleId, [...(byTitle.get(r.titleId) ?? []), r]);
  for (const [titleId, list] of byTitle) recordSightings(db, titleId, list);
  setSetting(db, 'sightings.backfilled', true);
}
