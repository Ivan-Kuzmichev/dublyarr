import { and, eq, gte, gt, max, min } from 'drizzle-orm';
import type { Db } from './db/client';
import { episodes, seasons, subscriptions, titles, type Episode, type Subscription, type Title } from './db/schema';
import type { Profile } from './profile';

export class SubscriptionError extends Error {}

export const getSubscription = (db: Db, titleId: number) => db.select().from(subscriptions).where(eq(subscriptions.titleId, titleId)).get();

export function subscribe(db: Db, titleId: number, profile: Profile, now = Date.now()): Subscription {
  if (!db.select({ id: titles.id }).from(titles).where(eq(titles.id, titleId)).get()) throw new SubscriptionError('Сериал не найден');
  if (getSubscription(db, titleId)) throw new SubscriptionError('Уже есть подписка');
  const maxSeason = db.select({ n: max(seasons.number) }).from(seasons).where(eq(seasons.titleId, titleId)).get()?.n ?? null;
  return db.insert(subscriptions).values({ titleId, profile, maxSeason, subscribedAt: now, updatedAt: now }).returning().get();
}

export function updateSubscription(db: Db, titleId: number, profile: Profile, now = Date.now()): Subscription {
  // правка подписки, как и подписка, включает все известные сезоны (иначе новый сезон не включить)
  const maxSeason = db.select({ n: max(seasons.number) }).from(seasons).where(eq(seasons.titleId, titleId)).get()?.n ?? null;
  const row = db.update(subscriptions).set({ profile, maxSeason, updatedAt: now }).where(eq(subscriptions.titleId, titleId)).returning().get();
  if (!row) throw new SubscriptionError('Подписки нет');
  return row;
}

export const unsubscribe = (db: Db, titleId: number) => db.delete(subscriptions).where(eq(subscriptions.titleId, titleId)).run();

type Ep = Pick<Episode, 'season' | 'number' | 'airDate'>;

/** Какие вышедшие серии нужны по подписке (без спецвыпусков и серий без даты). Сегодняшняя — уже нужна. */
export function wantedEpisodes(sub: Pick<Subscription, 'profile' | 'subscribedAt'> & { maxSeason?: number | null }, eps: Ep[], today: string) {
  const since = new Date(sub.subscribedAt).toLocaleDateString('sv-SE');
  const s = sub.profile.scope;
  return eps
    .filter((e): e is Ep & { airDate: string } => e.season > 0 && !!e.airDate && e.airDate <= today)
    // сезоны за границей подписки (без «подписаться на новый сезон») не нужны
    .filter((e) => sub.maxSeason === null || sub.maxSeason === undefined || e.season <= sub.maxSeason)
    .filter((e) => {
      if (s.mode === 'all') return true;
      if (s.mode === 'new') return e.airDate >= since;
      const fromHere = e.season === s.season && e.number >= s.episode;
      return s.until === 'season_end' ? fromHere : fromHere || e.season > s.season;
    })
    .sort((a, b) => a.season - b.season || a.number - b.number)
    .map((e) => ({ season: e.season, number: e.number }));
}

export type LibraryFilter = 'all' | 'airing' | 'ended';
export type LibraryItem = { title: Title; profile: Profile; next: { season: number; number: number; airDate: string } | null };

const isEnded = (t: Title) => t.status === 'ended' || t.status === 'canceled';

export function libraryItems(db: Db, today: string): LibraryItem[] {
  const rows = db.select({ title: titles, profile: subscriptions.profile }).from(subscriptions).innerJoin(titles, eq(titles.id, subscriptions.titleId)).all();
  const items = rows.map(({ title, profile }) => {
    const firstDate = db
      .select({ d: min(episodes.airDate) })
      .from(episodes)
      .where(and(eq(episodes.titleId, title.id), gt(episodes.season, 0), gte(episodes.airDate, today)))
      .get()?.d;
    const next = firstDate
      ? db
          .select({ season: episodes.season, number: episodes.number, airDate: episodes.airDate })
          .from(episodes)
          .where(and(eq(episodes.titleId, title.id), gt(episodes.season, 0), eq(episodes.airDate, firstDate)))
          .orderBy(episodes.season, episodes.number)
          .get()
      : undefined;
    return { title, profile, next: next ? { season: next.season, number: next.number, airDate: next.airDate! } : null };
  });
  return items.sort((a, b) => {
    if (a.next && b.next) return a.next.airDate.localeCompare(b.next.airDate) || a.title.nameRu.localeCompare(b.title.nameRu, 'ru');
    if (a.next || b.next) return a.next ? -1 : 1;
    return a.title.nameRu.localeCompare(b.title.nameRu, 'ru');
  });
}

export const filterLibrary = (items: LibraryItem[], f: LibraryFilter) =>
  f === 'all' ? items : items.filter((i) => (f === 'ended' ? isEnded(i.title) : !isEnded(i.title)));

export const libraryCounts = (items: LibraryItem[]): Record<LibraryFilter, number> => ({
  all: items.length,
  airing: items.filter((i) => !isEnded(i.title)).length,
  ended: items.filter((i) => isEnded(i.title)).length,
});
