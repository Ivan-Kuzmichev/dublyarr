import { and, asc, eq, gte, isNotNull, lte } from "drizzle-orm";
import type { Db } from "./index.js";
import { episodes, titles } from "./schema.js";

export interface CalendarEntry {
  titleId: number;
  titleRu: string;
  season: number;
  episode: number;
  nameRu: string;
  airDate: string;
  wanted: boolean;
  hasFile: boolean;
  voiceover: string;
}

/** Серии трекаемых сериалов с датой выхода в [from, to] (ISO YYYY-MM-DD), по возрастанию даты. */
export function listCalendar(db: Db, from: string, to: string): CalendarEntry[] {
  const rows = db
    .select({
      titleId: titles.id,
      titleRu: titles.titleRu,
      voiceover: titles.voiceover,
      season: episodes.season,
      episode: episodes.episode,
      nameRu: episodes.nameRu,
      airDate: episodes.airDate,
      wanted: episodes.wanted,
      fileId: episodes.fileId,
    })
    .from(episodes)
    .innerJoin(titles, eq(episodes.titleId, titles.id))
    .where(
      and(
        eq(titles.tracked, 1),
        eq(titles.type, "tv"),
        isNotNull(episodes.airDate),
        gte(episodes.airDate, from),
        lte(episodes.airDate, to),
      ),
    )
    .orderBy(
      asc(episodes.airDate),
      asc(episodes.season),
      asc(episodes.episode),
    )
    .all();

  return rows.map((r) => ({
    titleId: r.titleId,
    titleRu: r.titleRu,
    season: r.season,
    episode: r.episode,
    nameRu: r.nameRu,
    airDate: r.airDate as string,
    wanted: r.wanted === 1,
    hasFile: r.fileId != null,
    voiceover: r.voiceover,
  }));
}
