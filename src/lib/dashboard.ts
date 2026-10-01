import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import type { Db } from './db/client';
import { downloads, episodeFiles, episodes, subscriptions, titles, wantedState, type Download } from './db/schema';
import { wantedEpisodes } from './subscriptions';
import { addDays, formatAirDate, formatShortDate } from './dates';
import { formatSize } from './format';
import { activityQueue, type QueueRow } from './activity';
import { getQbit } from './qbit';

// Данные экранов «Сегодня», «Календарь» и колонки «Статус» в карточке сериала.

export type EpisodeStatus = {
  state: 'downloaded' | 'downloading' | 'waiting' | 'missing' | 'ask' | 'upcoming' | 'skipped';
  text: string;
  detail?: string;
};

const HOUR = 3_600_000;
const ACTIVE: Download['state'][] = ['adding', 'downloading', 'paused', 'stalled', 'completed'];
const pad = (n: number) => String(n).padStart(2, '0');
const code = (s: number, n: number) => `S${pad(s)}E${pad(n)}`;
const key = (s: number, n: number) => `${s}:${n}`;
const quality = (res: number | null) => (res ? `${res}p` : '');

function activeByEpisode(db: Db, titleIds?: number[]) {
  const rows = db
    .select()
    .from(downloads)
    .where(titleIds ? and(inArray(downloads.state, ACTIVE), inArray(downloads.titleId, titleIds)) : inArray(downloads.state, ACTIVE))
    .all();
  const map = new Map<string, Download>();
  for (const d of rows) for (const e of d.episodes) map.set(`${d.titleId}:${key(e.season, e.number)}`, d);
  return map;
}

const downloadingText = (d: Download) => `${d.state === 'paused' ? 'На паузе' : 'Качается'} · ${Math.round(d.progress * 100)} %`;

export function episodeStatuses(db: Db, titleId: number, today: string): Map<string, EpisodeStatus> {
  const out = new Map<string, EpisodeStatus>();
  const sub = db.select().from(subscriptions).where(eq(subscriptions.titleId, titleId)).get();
  const eps = db.select().from(episodes).where(eq(episodes.titleId, titleId)).all();
  if (sub) {
    const wanted = new Set(wantedEpisodes(sub, eps, today).map((e) => key(e.season, e.number)));
    for (const e of eps) {
      if (e.season === 0) continue;
      const k = key(e.season, e.number);
      if (!e.airDate) out.set(k, { state: 'upcoming', text: 'Дата не объявлена' });
      else if (e.airDate > today) out.set(k, { state: 'upcoming', text: `Эфир ${formatAirDate(e.airDate, today)}` });
      else out.set(k, wanted.has(k) ? { state: 'missing', text: 'Ищем' } : { state: 'skipped', text: 'Не по подписке' });
    }
    for (const w of db.select().from(wantedState).where(eq(wantedState.titleId, titleId)).all()) {
      const k = key(w.season, w.number);
      if (out.get(k)?.state !== 'missing') continue;
      if (w.state === 'waiting') out.set(k, { state: 'waiting', text: 'Ждём озвучку', ...(w.until ? { detail: `с ${formatShortDate(w.until, today)}` } : { detail: w.reason }) });
      else if (w.state === 'ask') out.set(k, { state: 'ask', text: 'Нужен ответ', detail: w.reason });
      else out.set(k, { state: 'missing', text: 'Не найдена', detail: w.reason });
    }
  }
  for (const [k, d] of activeByEpisode(db, [titleId])) out.set(k.slice(k.indexOf(':') + 1), { state: 'downloading', text: downloadingText(d) });
  for (const f of db.select().from(episodeFiles).where(eq(episodeFiles.titleId, titleId)).all())
    out.set(key(f.season, f.number), {
      state: 'downloaded',
      text: 'Скачана',
      detail: [f.studioLabel, quality(f.resolution), formatSize(f.size)].filter(Boolean).join(' · '),
    });
  return out;
}

function ago(ms: number) {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} мин назад`;
  if (min < 24 * 60) return `${Math.round(min / 60)} ч назад`;
  return `${Math.round(min / 1440)} дн назад`;
}

export type FreshItem = { tmdbId: number; title: string; posterPath: string | null; code: string; quality: string; state: string; loading: boolean; pct: number };
export type WaitingItem = { tmdbId: number; title: string; posterPath: string | null; code: string; aired: string; until: string | null; reason: string };
export type AttentionItem = { tmdbId: number; title: string; code: string; text: string; href: string };
export type WeekItem = { date: string; day: string; tmdbId: number; title: string; code: string; kind: 'downloaded' | 'aired' | 'upcoming'; sub: string };

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const dayLabel = (date: string) => `${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]} ${Number(date.slice(8))}`;

/** Понедельник недели, в которую попадает дата. */
export function mondayOf(date: string): string {
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((wd + 6) % 7));
}

/** Серии подписок с эфиром в [from, to] — скачана / вышел оригинал / ещё не вышла. */
function airing(db: Db, from: string, to: string, today: string): WeekItem[] {
  const rows = db
    .select({ e: episodes, tmdbId: titles.tmdbId, title: titles.nameRu })
    .from(episodes)
    .innerJoin(titles, eq(titles.id, episodes.titleId))
    .innerJoin(subscriptions, eq(subscriptions.titleId, episodes.titleId))
    .where(and(gte(episodes.airDate, from), lte(episodes.airDate, to)))
    .all()
    .filter((r) => r.e.season > 0);
  const files = new Map(
    db
      .select()
      .from(episodeFiles)
      .where(inArray(episodeFiles.titleId, [...new Set(rows.map((r) => r.e.titleId))]))
      .all()
      .map((f) => [`${f.titleId}:${key(f.season, f.number)}`, f]),
  );
  return rows
    .sort((a, b) => a.e.airDate!.localeCompare(b.e.airDate!) || a.title.localeCompare(b.title, 'ru'))
    .map(({ e, tmdbId, title }) => {
      const f = files.get(`${e.titleId}:${key(e.season, e.number)}`);
      const kind = f ? 'downloaded' : e.airDate! <= today ? 'aired' : 'upcoming';
      const sub = f ? [f.studioLabel, quality(f.resolution)].filter(Boolean).join(' · ') : kind === 'aired' ? 'оригинал' : 'эфир';
      return { date: e.airDate!, day: dayLabel(e.airDate!), tmdbId, title, code: code(e.season, e.number), kind, sub };
    });
}

export function todayData(db: Db, today: string, now = Date.now()) {
  const meta = new Map(db.select({ id: titles.id, tmdbId: titles.tmdbId, title: titles.nameRu, posterPath: titles.posterPath }).from(titles).all().map((t) => [t.id, t]));
  const fresh: (FreshItem & { at: number })[] = [];
  for (const d of db.select().from(downloads).where(inArray(downloads.state, ACTIVE)).all()) {
    const t = meta.get(d.titleId)!;
    const pct = Math.round(d.progress * 100);
    const c = d.episodes.length === 1 ? code(d.episodes[0].season, d.episodes[0].number) : `S${pad(d.season)} · ${d.episodes.length} сер.`;
    fresh.push({ ...t, code: c, quality: quality(d.resolution), state: downloadingText(d), loading: true, pct, at: Number.MAX_SAFE_INTEGER - d.addedAt });
  }
  for (const f of db.select().from(episodeFiles).where(gte(episodeFiles.importedAt, now - 72 * HOUR)).all().sort((a, b) => b.importedAt - a.importedAt)) {
    const t = meta.get(f.titleId)!;
    fresh.push({
      ...t,
      code: code(f.season, f.number),
      quality: quality(f.resolution),
      state: `${f.studioLabel ? `${f.studioLabel} · ` : ''}скачано ${ago(now - f.importedAt)}`,
      loading: false,
      pct: 100,
      at: f.importedAt,
    });
  }
  fresh.sort((a, b) => Number(b.loading) - Number(a.loading) || b.at - a.at);

  const airDates = new Map(db.select().from(episodes).all().map((e) => [`${e.titleId}:${key(e.season, e.number)}`, e.airDate]));
  const waiting: WaitingItem[] = db
    .select()
    .from(wantedState)
    .innerJoin(subscriptions, eq(subscriptions.titleId, wantedState.titleId))
    .where(eq(wantedState.state, 'waiting'))
    .all()
    .map(({ wanted_state: w }) => {
      const t = meta.get(w.titleId)!;
      const aired = airDates.get(`${w.titleId}:${key(w.season, w.number)}`);
      return {
        tmdbId: t.tmdbId,
        title: t.title,
        posterPath: t.posterPath,
        code: code(w.season, w.number),
        aired: aired ? formatShortDate(aired, today) : '—',
        until: w.until ? formatShortDate(w.until, today) : null,
        reason: w.reason,
        sortKey: w.until ?? '9999',
      };
    })
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .map(({ sortKey: _s, ...rest }) => rest);

  const attention: AttentionItem[] = [
    ...db
      .select()
      .from(wantedState)
      .innerJoin(subscriptions, eq(subscriptions.titleId, wantedState.titleId))
      .where(eq(wantedState.state, 'ask'))
      .all()
      .map(({ wanted_state: w }) => {
        const t = meta.get(w.titleId)!;
        return { tmdbId: t.tmdbId, title: t.title, code: code(w.season, w.number), text: w.reason, href: `/search/${t.tmdbId}?s=${w.season}&e=${w.number}` };
      }),
    ...db
      .select()
      .from(downloads)
      .where(eq(downloads.state, 'error'))
      .all()
      .map((d) => {
        const t = meta.get(d.titleId)!;
        const c = d.episodes.length === 1 ? code(d.episodes[0].season, d.episodes[0].number) : `S${pad(d.season)}`;
        return { tmdbId: t.tmdbId, title: t.title, code: c, text: d.lastError ?? 'Ошибка загрузки', href: '/activity' };
      }),
  ];

  const downloadsList: QueueRow[] = activityQueue(db, now).filter((r) => r.active);
  return {
    fresh: fresh.map(({ at: _a, ...rest }) => rest),
    waiting,
    attention,
    downloads: downloadsList,
    week: airing(db, today, addDays(today, 6), today),
    qbitConfigured: !!getQbit(db),
  };
}

export function calendarWeek(db: Db, monday: string, today: string) {
  const items = airing(db, monday, addDays(monday, 6), today);
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    return { date, label: dayLabel(date), today: date === today, events: items.filter((x) => x.date === date) };
  });
  return { monday, days };
}
