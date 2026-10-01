import { and, asc, between, eq, lt, notInArray, or } from 'drizzle-orm';
import type { Db } from './db/client';
import { episodes, seasons, titles, type Episode, type Season, type Title } from './db/schema';
import type { Tmdb } from './tmdb/client';
import { mapDetails, mapEpisodes, mapSeasons } from './tmdb/map';
import type { TmdbSeason } from './tmdb/types';
import { extendSeasons } from './seasons-watch';

/** Карточку старше этого обновляем при открытии. */
export const STALE_MS = 12 * 3_600_000;
const MONTH = 30 * 86_400_000;

export const getTitleByTmdbId = (db: Db, tmdbId: number) => db.select().from(titles).where(eq(titles.tmdbId, tmdbId)).get();

export const listSeasons = (db: Db, titleId: number): Season[] =>
  db.select().from(seasons).where(eq(seasons.titleId, titleId)).orderBy(asc(seasons.number)).all();

export const listEpisodes = (db: Db, titleId: number, season: number): Episode[] =>
  db
    .select()
    .from(episodes)
    .where(and(eq(episodes.titleId, titleId), eq(episodes.season, season)))
    .orderBy(asc(episodes.number))
    .all();

/** Тип, выбранный руками, обновление из TMDB больше не меняет. */
export function setKind(db: Db, titleId: number, kind: Title['kind']) {
  db.update(titles).set({ kind, kindManual: true }).where(eq(titles.id, titleId)).run();
}

/**
 * Загружает сериал из TMDB и записывает в базу. Новый сериал (или allSeasons) — все сезоны;
 * иначе только сезоны с изменившимся числом серий и последний сезон.
 */
export async function syncTitle(db: Db, tmdb: Tmdb, tmdbId: number, opts: { allSeasons?: boolean; now?: number } = {}): Promise<Title> {
  const now = opts.now ?? Date.now();
  const d = await tmdb.details(tmdbId);
  const fields = mapDetails(d);
  const newSeasons = mapSeasons(d);
  const existing = getTitleByTmdbId(db, tmdbId);
  const stored = new Map(existing ? listSeasons(db, existing.id).map((s) => [s.number, s.episodeCount]) : []);
  const last = Math.max(0, ...newSeasons.map((s) => s.number));
  const toFetch = newSeasons
    .filter((s) => !existing || opts.allSeasons || stored.get(s.number) !== s.episodeCount || (s.number === last && last > 0))
    .map((s) => s.number);
  const fetched: TmdbSeason[] = [];
  for (const n of toFetch) fetched.push(await tmdb.season(tmdbId, n));

  // Все запросы сделаны — пишем одной транзакцией. Строку перечитываем внутри: пока шли запросы,
  // пользователь мог сменить тип, а параллельное открытие — уже вставить сериал.
  const title = db.transaction((tx) => {
    const current = tx.select().from(titles).where(eq(titles.tmdbId, tmdbId)).get();
    const kind = current?.kindManual ? current.kind : fields.kind;
    const row = tx
      .insert(titles)
      .values({ ...fields, kind, refreshedAt: now, createdAt: now })
      .onConflictDoUpdate({ target: titles.tmdbId, set: { ...fields, kind, refreshedAt: now } })
      .returning()
      .get();
    const numbers = newSeasons.map((s) => s.number);
    tx.delete(seasons)
      .where(and(eq(seasons.titleId, row.id), notInArray(seasons.number, numbers)))
      .run();
    tx.delete(episodes)
      .where(and(eq(episodes.titleId, row.id), notInArray(episodes.season, numbers)))
      .run();
    for (const s of newSeasons) {
      tx.insert(seasons)
        .values({ titleId: row.id, ...s })
        .onConflictDoUpdate({ target: [seasons.titleId, seasons.number], set: s })
        .run();
    }
    for (const s of fetched) {
      const eps = mapEpisodes(s);
      tx.delete(episodes)
        .where(
          and(
            eq(episodes.titleId, row.id),
            eq(episodes.season, s.season_number),
            notInArray(
              episodes.number,
              eps.map((e) => e.number),
            ),
          ),
        )
        .run();
      for (const e of eps) {
        tx.insert(episodes)
          .values({ titleId: row.id, ...e })
          .onConflictDoUpdate({ target: [episodes.titleId, episodes.season, episodes.number], set: e })
          .run();
      }
    }
    return row;
  });
  // новый сезон у сериала из подписки — расширить подписку или оставить заметку (spec §11)
  extendSeasons(db, title.id, now);
  return title;
}

// Если TMDB не ответил, карточка какое-то время не ждёт его снова (иначе каждое открытие — таймаут).
const RETRY_AFTER_FAILURE_MS = 10 * 60_000;
const failuresByDb = new WeakMap<Db, Map<number, { at: number; error: string }>>();
const failuresOf = (db: Db) => {
  let m = failuresByDb.get(db);
  if (!m) failuresByDb.set(db, (m = new Map()));
  return m;
};

export type OpenResult = { title: Title; stale: false } | { title: Title; stale: true; error: string };

/** Для карточки: из базы, при необходимости освежив; TMDB недоступен — показываем сохранённое. */
export async function openTitle(db: Db, tmdb: Tmdb | null, tmdbId: number, now = Date.now()): Promise<OpenResult> {
  const existing = getTitleByTmdbId(db, tmdbId);
  if (!existing) {
    if (!tmdb) throw new Error('Добавьте ключ TMDB в настройках');
    return { title: await syncTitle(db, tmdb, tmdbId, { allSeasons: true, now }), stale: false };
  }
  if (now - existing.refreshedAt < STALE_MS || !tmdb) return { title: existing, stale: false };
  const recentFailures = failuresOf(db);
  const failed = recentFailures.get(tmdbId);
  if (failed && now - failed.at < RETRY_AFTER_FAILURE_MS) return { title: existing, stale: true, error: failed.error };
  try {
    const title = await syncTitle(db, tmdb, tmdbId, { now });
    recentFailures.delete(tmdbId);
    return { title, stale: false };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    recentFailures.set(tmdbId, { at: now, error });
    return { title: existing, stale: true, error };
  }
}

/** Выходящие — каждый день; завершённые и закрытые — раз в месяц. */
export const titlesDueForRefresh = (db: Db, now: number) =>
  db
    .select()
    .from(titles)
    .where(or(notInArray(titles.status, ['ended', 'canceled']), lt(titles.refreshedAt, now - MONTH)))
    .orderBy(asc(titles.refreshedAt))
    .all();

export function upcomingTitles(db: Db, today: string, days = 60): Title[] {
  const end = new Date(Date.parse(today) + days * 86_400_000).toISOString().slice(0, 10);
  return db
    .select()
    .from(titles)
    .where(and(eq(titles.status, 'returning'), between(titles.nextAirDate, today, end)))
    .orderBy(asc(titles.nextAirDate))
    .all();
}
