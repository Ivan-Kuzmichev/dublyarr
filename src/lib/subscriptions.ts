import { movieCard } from './movie-card';
import { isMovieProfile, type MovieProfile } from './movie-profile';
import { and, eq, gte, gt, max, min } from 'drizzle-orm';
import type { Db } from './db/client';
import { episodes, retiredEpisodes, seasons, subscriptions, titles, users, type Episode, type Subscription, type Title } from './db/schema';
import type { Profile } from './profile';

export class SubscriptionError extends Error {}

export const getSubscription = (db: Db, titleId: number) => db.select().from(subscriptions).where(eq(subscriptions.titleId, titleId)).get();

export function subscribe(db: Db, titleId: number, profile: Profile | MovieProfile, now = Date.now(), addedBy: number | null = null): Subscription {
  const t = db.select({ id: titles.id, kind: titles.kind }).from(titles).where(eq(titles.id, titleId)).get();
  if (!t) throw new SubscriptionError('Сериал не найден');
  if ((t.kind === 'movie') !== isMovieProfile(profile)) throw new SubscriptionError('Профиль не подходит к этому виду');
  if (getSubscription(db, titleId)) throw new SubscriptionError('Уже есть подписка');
  const maxSeason = db.select({ n: max(seasons.number) }).from(seasons).where(eq(seasons.titleId, titleId)).get()?.n ?? null;
  // новая подписка — заново: удалённые раньше серии снова нужны
  db.delete(retiredEpisodes).where(eq(retiredEpisodes.titleId, titleId)).run();
  return db.insert(subscriptions).values({ titleId, profile, maxSeason, addedBy, subscribedAt: now, updatedAt: now }).returning().get();
}

export function updateSubscription(db: Db, titleId: number, profile: Profile | MovieProfile, now = Date.now()): Subscription {
  const t = db.select({ kind: titles.kind }).from(titles).where(eq(titles.id, titleId)).get();
  if (t && (t.kind === 'movie') !== isMovieProfile(profile)) throw new SubscriptionError('Профиль не подходит к этому виду');
  // правка подписки, как и подписка, включает все известные сезоны (иначе новый сезон не включить)
  const maxSeason = db.select({ n: max(seasons.number) }).from(seasons).where(eq(seasons.titleId, titleId)).get()?.n ?? null;
  const row = db.update(subscriptions).set({ profile, maxSeason, updatedAt: now }).where(eq(subscriptions.titleId, titleId)).returning().get();
  if (!row) throw new SubscriptionError('Подписки нет');
  return row;
}

export const unsubscribe = (db: Db, titleId: number) => db.delete(subscriptions).where(eq(subscriptions.titleId, titleId)).run();

type Ep = Pick<Episode, 'season' | 'number' | 'airDate'>;

/** Какие вышедшие серии нужны по подписке (без спецвыпусков и серий без даты). Сегодняшняя — уже нужна. */
export function wantedEpisodes(sub: Pick<Subscription, 'subscribedAt' | 'profile'> & { maxSeason?: number | null }, eps: Ep[], today: string) {
  if (isMovieProfile(sub.profile)) return []; // у фильма нет серий
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

export type LibraryFilter = 'all' | 'airing' | 'ended' | 'movies';
/** status — у фильма: «Дубляж · 2160p · 24 ГБ» / «Ждём дубляж до …». */
export type LibraryItem = { title: Title; profile: Profile | MovieProfile; next: { season: number; number: number; airDate: string } | null; status?: string };

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
    if (title.kind === 'movie') return { title, profile, next: null, status: movieCard(db, title, today).status };
    return { title, profile, next: next ? { season: next.season, number: next.number, airDate: next.airDate! } : null };
  });
  return items.sort((a, b) => {
    if (a.next && b.next) return a.next.airDate.localeCompare(b.next.airDate) || a.title.nameRu.localeCompare(b.title.nameRu, 'ru');
    if (a.next || b.next) return a.next ? -1 : 1;
    return a.title.nameRu.localeCompare(b.title.nameRu, 'ru');
  });
}

const isMovie = (t: Title) => t.kind === 'movie';

/** «В эфире» и «Завершены» — только сериалы; фильмы — своим фильтром. */
export const filterLibrary = (items: LibraryItem[], f: LibraryFilter) =>
  f === 'all' ? items : f === 'movies' ? items.filter((i) => isMovie(i.title)) : items.filter((i) => !isMovie(i.title) && (f === 'ended' ? isEnded(i.title) : !isEnded(i.title)));

export const libraryCounts = (items: LibraryItem[]): Record<Exclude<LibraryFilter, 'movies'>, number> => ({
  all: items.length,
  airing: filterLibrary(items, 'airing').length,
  ended: filterLibrary(items, 'ended').length,
});

/** Кто добавил подписку: логин; учётку удалили — «удалённая учётка»; подписка до 2.3 — null. */
export function subscriptionAuthor(db: Db, sub: { addedBy: number | null }): string | null {
  if (sub.addedBy === null) return null;
  return db.select({ u: users.username }).from(users).where(eq(users.id, sub.addedBy)).get()?.u ?? 'удалённая учётка';
}
