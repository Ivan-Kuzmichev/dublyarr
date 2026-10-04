import { can, isAdmin } from './auth/permissions';
import { isMovieProfile } from './movie-profile';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import type { Db } from './db/client';
import { downloads, episodeFiles, episodes, studios, subscriptions, titles, wantedState, type Download } from './db/schema';
import type { Paths } from './downloads';
import { digitalReleased } from './movies';
import { forecastEpisode, formatDelay, studioDelays, titleSightings, type EpisodeForecast, type StudioDelay } from './forecast';
import { dubLabel, type Profile } from './profile-core';
import { wantedEpisodes } from './subscriptions';
import { addDays, formatAirDate, formatShortDate } from './dates';
import { formatSize } from './format';
import { activityQueue, type QueueRow } from './activity';
import { getQbit } from './qbit';
import { oldCopiesSummary, oldCopyRuleConfirmed } from './old-copies';
import { plural } from './plural';
import { recentNotices } from './notices';
import { getSetting } from './settings';
import { storageState } from './storage';

// Данные экранов «Сегодня», «Календарь» и колонки «Статус» в карточке сериала.

export type EpisodeStatus = {
  state: 'downloaded' | 'downloading' | 'waiting' | 'missing' | 'ask' | 'upcoming' | 'skipped';
  text: string;
  detail?: string;
};

const HOUR = 3_600_000;
const ACTIVE: Download['state'][] = ['adding', 'downloading', 'paused', 'stalled', 'completed'];
const pad = (n: number) => String(n).padStart(2, '0');
const code = (s: number, n: number) => (s === 0 && n === 0 ? 'фильм' : `S${pad(s)}E${pad(n)}`);
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
      detail: [f.studioLabel, [quality(f.resolution), f.hdr ? 'HDR' : ''].filter(Boolean).join(' '), formatSize(f.size), f.processed ? 'пересобран' : ''].filter(Boolean).join(' · '),
    });
  return out;
}

function ago(ms: number) {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} мин назад`;
  if (min < 24 * 60) return `${Math.round(min / 60)} ч назад`;
  return `${Math.round(min / 1440)} дн назад`;
}

/** Картинка карточки «Новые серии»: кадр серии или фон сериала — широкие, постер — запасной. */
export type FreshImage = { path: string | null; wide: boolean };
export type FreshItem = { tmdbId: number; movie: boolean; title: string; image: FreshImage; code: string; quality: string; state: string; loading: boolean; pct: number };
export type WaitingItem = {
  tmdbId: number;
  movie: boolean;
  title: string;
  posterPath: string | null;
  code: string;
  aired: string;
  until: string | null;
  reason: string;
  etaText: string;
  progress: number | null;
  fallbackMark: number | null;
  delayText: string;
  fallbackNote: string;
};
export type AttentionItem = { tmdbId: number; movie?: boolean; title: string; code: string; text: string; href: string };
export type WeekItem = { date: string; day: string; tmdbId: number; movie: boolean; title: string; code: string; kind: 'downloaded' | 'aired' | 'upcoming' | 'forecast'; sub: string };

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
      return { date: e.airDate!, day: dayLabel(e.airDate!), tmdbId, movie: false, title, code: code(e.season, e.number), kind, sub };
    });
}

const studioNames = (db: Db) => {
  const m = new Map(db.select().from(studios).all().map((x) => [x.id, x.name]));
  return (id: number) => m.get(id);
};
const shortDelay = (days: number) => `+${String(days).replace('.', ',')} д`;

/** Прогноз для серий, которые ждут озвучку: задержки считаются один раз на сериал. */
function forecaster(db: Db, today: string) {
  const name = studioNames(db);
  const cache = new Map<number, { delays: Map<number, StudioDelay>; sightings: ReturnType<typeof titleSightings> }>();
  return (titleId: number, profile: Profile, season: number, number: number, airDate: string): EpisodeForecast & { delayText: string; sub: string } => {
    if (!cache.has(titleId)) cache.set(titleId, { delays: studioDelays(db, titleId), sightings: titleSightings(db, titleId) });
    const c = cache.get(titleId)!;
    const f = forecastEpisode(profile, { season, number, airDate }, c.delays, c.sightings, name, today);
    const p = f.positions.find((x) => x.expected && x.delay?.days !== null && x.delay?.days !== undefined);
    return {
      ...f,
      delayText: p ? `${p.label} обычно ${formatDelay(p.delay!.days!)}` : '',
      sub: p ? `${p.label} ≈ ${shortDelay(p.delay!.days!)}` : '',
    };
  };
}

/** Серии, которые ждут озвучку, с прогнозом. */
function waitingWithForecast(db: Db, today: string) {
  const fc = forecaster(db, today);
  const air = new Map(db.select().from(episodes).all().map((e) => [`${e.titleId}:${key(e.season, e.number)}`, e.airDate]));
  return db
    .select()
    .from(wantedState)
    .innerJoin(subscriptions, eq(subscriptions.titleId, wantedState.titleId))
    .where(eq(wantedState.state, 'waiting'))
    .all()
    .map(({ wanted_state: w, subscriptions: sub }) => {
      const aired = air.get(`${w.titleId}:${key(w.season, w.number)}`) ?? null;
      return { w, aired, f: aired && !isMovieProfile(sub.profile) ? fc(w.titleId, sub.profile, w.season, w.number, aired) : null };
    });
}

/** «Новые серии» — скачанные за последние 48 ч. */
const FRESH_HOURS = 48;

export function todayData(db: Db, today: string, now = Date.now()) {
  const meta = new Map(
    db
      .select({ id: titles.id, tmdbId: titles.tmdbId, title: titles.nameRu, posterPath: titles.posterPath, backdropPath: titles.backdropPath, kind: titles.kind, releaseDates: titles.releaseDates, digitalSeenAt: titles.digitalSeenAt })
      .from(titles)
      .all()
      .map((t) => [t.id, { ...t, movie: t.kind === 'movie' }]),
  );
  const fresh: (FreshItem & { at: number })[] = [];
  const image = (t: { id: number; posterPath: string | null; backdropPath: string | null; movie: boolean }, ep?: { season: number; number: number }): FreshImage => {
    const still =
      ep && !t.movie
        ? db.select({ s: episodes.stillPath }).from(episodes).where(and(eq(episodes.titleId, t.id), eq(episodes.season, ep.season), eq(episodes.number, ep.number))).get()?.s
        : null;
    if (still) return { path: still, wide: true };
    if (t.backdropPath) return { path: t.backdropPath, wide: true };
    return { path: t.posterPath, wide: false };
  };
  for (const d of db.select().from(downloads).where(inArray(downloads.state, ACTIVE)).all()) {
    const t = meta.get(d.titleId)!;
    const pct = Math.round(d.progress * 100);
    const c = d.episodes.length === 1 ? code(d.episodes[0].season, d.episodes[0].number) : `S${pad(d.season)} · ${d.episodes.length} сер.`;
    fresh.push({ tmdbId: t.tmdbId, movie: t.movie, title: t.title, image: image(t, d.episodes[0]), code: d.kind === 'movie' ? 'фильм' : c, quality: quality(d.resolution), state: downloadingText(d), loading: true, pct, at: Number.MAX_SAFE_INTEGER - d.addedAt });
  }
  // замены на лучшую копию («Улучшение: …») — не новые серии: они видны в «Активности»
  const upgrades = new Set(db.select({ id: downloads.id, note: downloads.note }).from(downloads).all().filter((d) => d.note?.startsWith('Улучшение')).map((d) => d.id));
  const freshFiles = db.select().from(episodeFiles).where(gte(episodeFiles.importedAt, now - FRESH_HOURS * HOUR)).all().filter((f) => !(f.downloadId && upgrades.has(f.downloadId)));
  for (const f of freshFiles.sort((a, b) => b.importedAt - a.importedAt)) {
    const t = meta.get(f.titleId)!;
    fresh.push({
      tmdbId: t.tmdbId,
      movie: t.movie,
      title: t.title,
      image: image(t, { season: f.season, number: f.number }),
      code: code(f.season, f.number),
      quality: quality(f.resolution),
      state: `${f.studioLabel ? `${f.studioLabel} · ` : ''}скачано ${ago(now - f.importedAt)}`,
      loading: false,
      pct: 100,
      at: f.importedAt,
    });
  }
  fresh.sort((a, b) => Number(b.loading) - Number(a.loading) || b.at - a.at);

  const waiting: WaitingItem[] = waitingWithForecast(db, today)
    .map(({ w, aired, f }) => {
      const t = meta.get(w.titleId)!;
      // фильм: «вышел» — цифровой релиз, прогноз — конец ожидания дубляжа
      const digital = t.movie ? digitalReleased(t, today) : null;
      return {
        tmdbId: t.tmdbId,
        movie: t.movie,
        title: t.title,
        posterPath: t.posterPath,
        code: code(w.season, w.number),
        aired: t.movie ? (digital ? formatShortDate(digital, today) : '—') : aired ? formatShortDate(aired, today) : '—',
        until: w.until ? formatShortDate(w.until, today) : null,
        reason: w.reason,
        etaText: t.movie ? (w.until ? `Дубляж ≈ ${formatShortDate(w.until, today)}` : 'ждём цифровой релиз') : (f?.etaText ?? 'прогноза нет'),
        progress: f?.progress ?? null,
        fallbackMark: f?.fallbackMark ?? null,
        delayText: f?.delayText ?? '',
        fallbackNote: f?.fallbackNote ?? '',
        sortKey: f?.eta ?? w.until ?? '9999',
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
        const href = t.movie ? `/search/${t.tmdbId}?type=movie` : `/search/${t.tmdbId}?s=${w.season}&e=${w.number}`;
        return { tmdbId: t.tmdbId, ...(t.movie ? { movie: true } : {}), title: t.title, code: code(w.season, w.number), text: w.reason, href };
      }),
    ...db
      .select()
      .from(downloads)
      .where(eq(downloads.state, 'error'))
      .all()
      .map((d) => {
        const t = meta.get(d.titleId)!;
        const c = d.episodes.length === 1 ? code(d.episodes[0].season, d.episodes[0].number) : `S${pad(d.season)}`;
        return { tmdbId: t.tmdbId, ...(t.movie ? { movie: true } : {}), title: t.title, code: c, text: d.lastError ?? 'Ошибка загрузки', href: '/activity' };
      }),
  ];

  const old = oldCopiesSummary(db);
  if (old.count && !oldCopyRuleConfirmed(db))
    attention.push({
      tmdbId: 0,
      title: 'Старые копии после улучшения',
      code: '',
      text: `${old.count} ${plural(old.count, 'копия', 'копии', 'копий')} · ${formatSize(old.size)} — подтвердите удаление`,
      href: '/old-copies',
    });

  const movieSubs = db.select({ id: subscriptions.id }).from(subscriptions).innerJoin(titles, eq(titles.id, subscriptions.titleId)).where(eq(titles.kind, 'movie')).all();
  if (movieSubs.length && !getSetting<Paths>(db, 'paths')?.movies)
    attention.push({ tmdbId: 0, title: 'Не задана папка фильмов', code: '', text: 'Фильмы не скачиваются, пока её нет', href: '/settings/download' });

  const disk = storageState(db);
  if (disk && disk.level !== 'ok') attention.push({ tmdbId: 0, title: 'Мало места на диске', code: '', text: `Занято ${disk.pct} %${disk.level === 'pause' ? ' — загрузки на паузе' : ''}`, href: '/storage' });
  const retention = getSetting<{ count: number; size: number }>(db, 'retention.pending');
  if (retention?.count) attention.push({ tmdbId: 0, title: 'Уборка медиатеки', code: '', text: `${retention.count} · ${formatSize(retention.size)} — подтвердите удаление`, href: '/storage' });
  const cleanup = getSetting<{ count: number; size: number }>(db, 'cleanup.pending');
  if (cleanup?.count) attention.push({ tmdbId: 0, title: 'Уборка загрузок', code: '', text: `${cleanup.count} · ${formatSize(cleanup.size)} — подтвердите удаление`, href: '/cleanup' });

  const downloadsList: QueueRow[] = activityQueue(db, now).filter((r) => r.active);
  return {
    fresh: fresh.map(({ at: _a, ...rest }) => rest),
    waiting,
    attention,
    news: recentNotices(db, now),
    downloads: downloadsList,
    week: airing(db, today, addDays(today, 6), today),
    qbitConfigured: !!getQbit(db),
  };
}

/** Фильмы в подписках: цифровой релиз на этой неделе и прогноз дубляжа (конец ожидания). */
function movieWeek(db: Db, from: string, to: string, today: string): WeekItem[] {
  const out: WeekItem[] = [];
  const rows = db.select({ t: titles }).from(subscriptions).innerJoin(titles, eq(titles.id, subscriptions.titleId)).where(eq(titles.kind, 'movie')).all();
  for (const { t } of rows) {
    const file = db.select().from(episodeFiles).where(and(eq(episodeFiles.titleId, t.id), eq(episodeFiles.season, 0), eq(episodeFiles.number, 0))).get();
    const digital = t.releaseDates?.digital;
    if (digital && digital >= from && digital <= to)
      out.push({ date: digital, day: dayLabel(digital), tmdbId: t.tmdbId, movie: true, title: t.nameRu, code: 'фильм', kind: file ? 'downloaded' : digital <= today ? 'aired' : 'upcoming', sub: 'цифровой релиз' });
    const w = db.select().from(wantedState).where(and(eq(wantedState.titleId, t.id), eq(wantedState.state, 'waiting'))).get();
    if (w?.until && w.until >= from && w.until <= to) out.push({ date: w.until, day: dayLabel(w.until), tmdbId: t.tmdbId, movie: true, title: t.nameRu, code: 'фильм', kind: 'forecast', sub: 'дубляж' });
  }
  return out;
}

export function calendarWeek(db: Db, monday: string, today: string) {
  const sunday = addDays(monday, 6);
  const meta = new Map(db.select().from(titles).all().map((t) => [t.id, t]));
  const forecasts: WeekItem[] = waitingWithForecast(db, today)
    .filter(({ f }) => f?.eta && f.eta >= monday && f.eta <= sunday && f.sub)
    .map(({ w, f }) => ({ date: f!.eta!, day: dayLabel(f!.eta!), tmdbId: meta.get(w.titleId)!.tmdbId, movie: false, title: meta.get(w.titleId)!.nameRu, code: code(w.season, w.number), kind: 'forecast' as const, sub: f!.sub }));
  const items = [...airing(db, monday, sunday, today), ...movieWeek(db, monday, sunday, today), ...forecasts];
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    return { date, label: dayLabel(date), today: date === today, events: items.filter((x) => x.date === date) };
  });
  return { monday, days };
}

export type DubCell = { kind: 'done' | 'expected' | 'none'; text: string };
const NONE: DubCell = { kind: 'none', text: '—' };
const DAY_MS = 86_400_000;
const diffDays = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS);

/** «сег.», «завтра», «пт» на этой неделе, иначе «3 окт». */
function expectedText(date: string, today: string) {
  const d = diffDays(date, today);
  if (d === 0) return 'сег.';
  if (d === 1) return 'завтра';
  if (d > 1 && d <= 6) return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return formatShortDate(date, today);
}

/** Колонки озвучек профиля (до 3) в карточке сериала: вышла у студии — «+1д», ждём — дата прогноза. */
export function seriesDubColumns(db: Db, titleId: number, season: number, today: string): { columns: string[]; cells: Map<number, DubCell[]> } {
  const sub = db.select().from(subscriptions).where(eq(subscriptions.titleId, titleId)).get();
  const cells = new Map<number, DubCell[]>();
  if (!sub || isMovieProfile(sub.profile)) return { columns: [], cells };
  const name = studioNames(db);
  const dubs = sub.profile.dubs.filter((d) => d.kind !== 'original').slice(0, 3);
  const delays = studioDelays(db, titleId);
  const sightings = titleSightings(db, titleId).filter((x) => x.season === season);
  for (const e of db.select().from(episodes).where(and(eq(episodes.titleId, titleId), eq(episodes.season, season))).all()) {
    cells.set(
      e.number,
      dubs.map((d) => {
        if (!e.airDate) return NONE;
        const seen = sightings.filter((x) => x.number === e.number && (d.kind === 'any' || (d.kind === 'studio' && x.studioId === d.studioId))).sort((a, b) => a.seenAt - b.seenAt)[0];
        if (seen) return { kind: 'done', text: `+${Math.max(0, diffDays(new Date(seen.seenAt).toISOString().slice(0, 10), e.airDate))}д` };
        const days = d.kind === 'studio' ? delays.get(d.studioId)?.days : null;
        if (e.airDate <= today && days !== null && days !== undefined) return { kind: 'expected', text: expectedText(addDays(e.airDate, Math.ceil(days)), today) };
        return NONE;
      }),
    );
  }
  return { columns: dubs.map((d) => dubLabel(d, name)), cells };
}

/** «Скорость озвучки»: студии профиля и замеченные у сериала. */
export function speedBlock(db: Db, titleId: number): { name: string; text: string; width: string }[] {
  const sub = db.select().from(subscriptions).where(eq(subscriptions.titleId, titleId)).get();
  const name = studioNames(db);
  const delays = studioDelays(db, titleId);
  const ids = [...new Set([...(sub?.profile.dubs ?? []).flatMap((d) => (d.kind === 'studio' ? [d.studioId] : [])), ...delays.keys()])];
  const max = Math.max(0, ...ids.map((id) => delays.get(id)?.days ?? 0));
  return ids.map((id) => {
    const days = delays.get(id)?.days ?? null;
    return { name: name(id) ?? '?', text: days === null ? 'нет данных' : formatDelay(days), width: days === null || max === 0 ? '0%' : `${Math.round((days / max) * 100)}%` };
  });
}

/** Основание прогноза по студиям — для окна подписки. */
export function delayBasis(db: Db, titleId: number): Record<number, string> {
  return Object.fromEntries([...studioDelays(db, titleId).values()].map((d) => [d.studioId, d.basisText]));
}

/** «Требует внимания» для учётки: вопросы о раздачах — с правом ответа, уборка и старые копии — с хранилищем, настройки — админу. */
export function attentionFor<T extends { href: string }>(user: Parameters<typeof can>[0], items: T[]): T[] {
  return items.filter((i) =>
    i.href.startsWith('/search/') ? can(user, 'answer') : /^\/(cleanup|old-copies|storage)/.test(i.href) ? can(user, 'storage') : i.href.startsWith('/settings') ? isAdmin(user) : true,
  );
}
