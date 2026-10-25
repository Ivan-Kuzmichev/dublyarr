import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from './db/client';
import { episodes, subscriptions, titles, wantedState } from './db/schema';
import { getSetting, setSetting } from './settings';
import { isMovieProfile } from './movie-profile';
import { addDays, todayIso } from './dates';
import { notify } from './notify';
import { codeRange, linkButton } from './notify-events';
import { plural } from './plural';

// «Серия не нашлась за N дней» (2.8): вышла в эфир, прошло N дней (или ожидание профиля, если оно дольше), а она не скачана и не качается —
// по любой причине (раздач нет, не та озвучка или качество, сомнительные). Одно сообщение на серию; серии сериала за один проход — одним.

export const DEFAULT_NOT_FOUND_DAYS = 7;
export const getNotFoundDays = (db: Db) => getSetting<{ days: number }>(db, 'notFound')?.days ?? DEFAULT_NOT_FOUND_DAYS;
export const setNotFoundDays = (db: Db, days: number) => setSetting(db, 'notFound', { days });

export function parseNotFoundDays(v: FormDataEntryValue | null): number | { error: string } {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 90 ? n : { error: 'Дней — от 1 до 90' };
}

/** Проверить нужные серии и отправить «не нашлась» тем, кому пора. Возвращает, о скольких сериях сообщено. */
export function checkNotFound(db: Db, today = todayIso(), now = Date.now()): number {
  const days = getNotFoundDays(db);
  const rows = db
    .select({ w: wantedState, kind: titles.kind, tmdbId: titles.tmdbId, nameRu: titles.nameRu, profile: subscriptions.profile, airDate: episodes.airDate })
    .from(wantedState)
    .innerJoin(titles, eq(titles.id, wantedState.titleId))
    .innerJoin(subscriptions, eq(subscriptions.titleId, wantedState.titleId))
    .innerJoin(episodes, and(eq(episodes.titleId, wantedState.titleId), eq(episodes.season, wantedState.season), eq(episodes.number, wantedState.number)))
    .where(and(inArray(wantedState.state, ['missing', 'ask']), isNull(wantedState.notFoundAt)))
    .all();
  const due = rows.filter((r) => {
    if (r.kind === 'movie' || !r.airDate || isMovieProfile(r.profile)) return false;
    // ожидание запасной озвучки дольше N — сообщаем после него
    const wait = Math.max(days, ...r.profile.dubs.map((d) => d.waitDays));
    return addDays(r.airDate, wait) <= today;
  });
  const byTitle = new Map<number, typeof due>();
  for (const r of due) byTitle.set(r.w.titleId, [...(byTitle.get(r.w.titleId) ?? []), r]);
  for (const [titleId, list] of byTitle) {
    const eps = list.map((r) => ({ season: r.w.season, number: r.w.number }));
    const first = [...eps].sort((a, b) => a.season - b.season || a.number - b.number)[0];
    const why = list.length === 1 ? `\n${list[0].w.reason}` : '';
    notify(
      db,
      {
        key: `not-found:${titleId}:${eps.map((e) => `${e.season}.${e.number}`).join(',')}`,
        kind: 'not-found',
        text: `🔍 ${list[0].nameRu} · ${codeRange(eps)}: не ${list.length === 1 ? 'нашлась' : 'нашлись'} за ${days} ${plural(days, 'день', 'дня', 'дней')} после выхода${why}`,
        buttons: linkButton(db, `/search/${list[0].tmdbId}?s=${first.season}&e=${first.number}`, 'Искать вручную'),
        ref: { titleId, eps },
      },
      now,
    );
    // отмечаем и без получателей: иначе после привязки чата пришла бы пачка старых
    db.update(wantedState)
      .set({ notFoundAt: now })
      .where(inArray(wantedState.id, list.map((r) => r.w.id)))
      .run();
  }
  return due.length;
}
