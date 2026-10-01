import { and, eq, or } from 'drizzle-orm';
import type { Db } from './db/client';
import { releases, sources, titles, trackers, type Release, type Title } from './db/schema';
import { listSeasons } from './catalog';
import { listStudios } from './studios';
import { sourcesForSearch } from './sources';
import { ensureTracker, markSourceTrackers } from './trackers';
import { torznabSearch, TorznabError, type TorznabItem } from './torznab';
import { parseRelease } from './parse/dubs';
import { normalizeTitle } from './parse/normalize';
import { absoluteCandidates, matchRelease, resolveAbsolute, toTitleInfo } from './match';
import { isDigital, matchMovie, movieSource } from './movie-evaluate';
import { ruleFor } from './release-rules';
import { encrypt } from './crypto/secretbox';
import { recordSightings } from './sightings';
import { checkSourcesDown } from './notify-events';
import { log } from './log';
import { animeKey, applyAnimeDecision, applyMatchDecision, matchKey, reviewAnime, reviewMatches, reviewStudios } from './laya/review';
import { cachedDecision, SEARCH_BUDGET } from './laya/decide';
import type { LayaClient } from './laya/client';

export type SourceStatus = { sourceId: number; name: string; ok: boolean; found: number; ms: number; error?: string };
export type SearchOptions = { fetchImpl?: typeof fetch; now?: number; layaClient?: LayaClient };

const CATEGORIES = [5000, 5070];
const MOVIE_CATEGORIES = [2000, 2040, 2045, 2050, 2060];
const MAX_QUERIES = 4;
const isLatin = (s: string) => /[a-z]/i.test(s) && !/[^\p{Script=Latin}\p{N}\p{P}\p{Zs}\p{S}]/u.test(s);
const isSearchable = (s: string) => /[a-zа-яё]/i.test(s); // японские иероглифы трекеры не находят

/** Запросы к трекерам: уникальные названия сериала; для аниме — сначала латиница (романдзи, английское). */
export function queriesFor(t: Pick<Title, 'kind' | 'nameRu' | 'nameOriginal' | 'altNames'> & { year?: number | null }): string[] {
  const all = [t.nameRu, t.nameOriginal, ...t.altNames].filter(isSearchable);
  // фильм — с годом: у ремейков и тёзок одно название
  if (t.kind === 'movie') return [...new Set(all.map(normalizeTitle))].slice(0, 2).map((k) => `${all.find((s) => normalizeTitle(s) === k)}${t.year ? ` ${t.year}` : ''}`);
  const ordered = t.kind === 'anime' ? [...all.filter(isLatin), ...all.filter((s) => !isLatin(s))] : all;
  const seen = new Set<string>();
  return ordered.filter((s) => {
    const k = normalizeTitle(s);
    return k && !seen.has(k) && seen.add(k);
  }).slice(0, MAX_QUERIES);
}

type Found = { sourceId: number; item: TorznabItem };

/** Поиск раздач сериала во всех источниках: параллельно, со склейкой дублей и основным/запасным источником трекера. */
export async function searchTitle(db: Db, titleId: number, opts: SearchOptions = {}): Promise<{ releases: Release[]; sources: SourceStatus[] }> {
  const now = opts.now ?? Date.now();
  const title = db.select().from(titles).where(eq(titles.id, titleId)).get();
  if (!title) throw new Error('Сериал не найден');
  const queries = queriesFor(title);
  const srcs = sourcesForSearch(db);

  const settled = await Promise.all(
    srcs.map(async (src) => {
      const started = Date.now();
      try {
        const lists = await Promise.all(queries.map((q) => torznabSearch(src, q, title.kind === 'movie' ? MOVIE_CATEGORIES : CATEGORIES, opts.fetchImpl)));
        const items = lists.flat();
        const distinct = new Set(items.map((i) => i.infohash ?? `${i.indexerId}|${i.title}|${i.size}`)).size;
        return { status: { sourceId: src.id, name: src.name, ok: true, found: distinct, ms: Date.now() - started } as SourceStatus, items };
      } catch (e) {
        const error = e instanceof TorznabError ? e.message : e instanceof Error ? e.message : String(e);
        log.warn({ source: src.name, err: error }, 'torznab search failed');
        return { status: { sourceId: src.id, name: src.name, ok: false, found: 0, ms: Date.now() - started, error }, items: [] as TorznabItem[] };
      }
    }),
  );
  const statuses = settled.map((s) => s.status);
  for (const s of statuses) {
    markSourceTrackers(db, s.sourceId, s.ok ? null : (s.error ?? 'ошибка'), now);
    // с какого момента источник не отвечает (для уведомления «не отвечает больше часа»)
    const src = db.select({ since: sources.failingSince }).from(sources).where(eq(sources.id, s.sourceId)).get();
    if (s.ok && src?.since) db.update(sources).set({ failingSince: null }).where(eq(sources.id, s.sourceId)).run();
    if (!s.ok && src && !src.since) db.update(sources).set({ failingSince: now }).where(eq(sources.id, s.sourceId)).run();
  }
  checkSourcesDown(db, now);
  const okSources = new Set(statuses.filter((s) => s.ok).map((s) => s.sourceId));

  // Трекеры результатов (создаются на лету, если источник не умеет t=indexers) и отброс запасных.
  const found: Found[] = settled.flatMap((s) => s.items.map((item) => ({ sourceId: s.status.sourceId, item })));
  const kept: (Found & { trackerId: number; trackerName: string })[] = [];
  for (const f of found) {
    const ixId = f.item.indexerId ?? `source-${f.sourceId}`;
    const tr = ensureTracker(db, f.sourceId, ixId, f.item.indexerName ?? ixId);
    if (tr.role === 'backup') {
      const primaryOk = db
        .select()
        .from(trackers)
        .where(and(eq(trackers.indexerId, tr.indexerId), eq(trackers.role, 'primary')))
        .all()
        .some((p) => okSources.has(p.sourceId));
      if (primaryOk) continue;
    }
    kept.push({ ...f, trackerId: tr.id, trackerName: tr.name });
  }

  // Склейка одинаковых раздач: infohash, иначе трекер + заголовок + размер.
  const unique = new Map<string, (typeof kept)[number]>();
  for (const k of kept) {
    const key = k.item.infohash ?? `${k.trackerName}|${k.item.title}|${k.item.size}`;
    if (!unique.has(key)) unique.set(key, k);
  }

  const seasons = listSeasons(db, title.id);
  const info = toTitleInfo(title, seasons);
  const studios = studioRefs(db);
  const saved: Release[] = [];
  for (const k of unique.values()) {
    const it = k.item;
    const { parsed, match } = analyze(db, title, info, studios, { title: it.title, attrs: it.attrs, size: it.size, indexerId: it.indexerId ?? '', trackerName: k.trackerName });
    const fields = {
      sourceId: k.sourceId,
      trackerId: k.trackerId,
      trackerName: k.trackerName,
      title: it.title,
      attrs: it.attrs,
      size: it.size,
      seeders: it.seeders,
      peers: it.peers,
      infohash: it.infohash,
      downloadEnc: it.link ? encrypt(it.link) : null,
      magnet: it.magnet,
      detailsUrl: it.details,
      publishedAt: it.publishedAt,
      lastSeenAt: now,
      parsed,
      match,
    };
    saved.push(upsertRelease(db, title.id, fields, now));
  }
  // Laya: сомнительные совпадения (бюджет вопросов на поиск — CPU NAS)
  const budget = { left: SEARCH_BUDGET };
  const matched = await reviewMatches(db, title, saved, { budget, client: opts.layaClient });
  const named = await reviewStudios(db, title, matched, { budget, client: opts.layaClient });
  const reviewed = await reviewAnime(db, title, named, { budget, client: opts.layaClient });
  if (title.kind === 'movie') noteDigital(db, title, reviewed, now);
  else recordSightings(db, titleId, reviewed);
  return { releases: reviewed, sources: statuses };
}

type StudioRefs = ReturnType<typeof studioRefs>;
const studioRefs = (db: Db) => listStudios(db).map((s) => ({ id: s.id, name: s.name, aliases: s.aliases, trackers: s.trackers }));

/** Разбор заголовка и оценка «тот ли сериал» (с учётом правил пользователя). */
function analyze(
  db: Db,
  title: Title,
  info: ReturnType<typeof toTitleInfo>,
  studios: StudioRefs,
  r: { title: string; attrs: Record<string, string | string[]>; size: number; indexerId: string; trackerName: string },
) {
  const rule = ruleFor(db, title.id, r.trackerName, r.title);
  const raw = parseRelease(r.title, r.attrs, { id: r.indexerId, name: r.trackerName }, studios);
  // сквозная нумерация: уже выбранная Laya раскладка (переразбор её не теряет), иначе эвристика
  const cands = title.kind === 'anime' ? absoluteCandidates(raw, info) : [];
  const parsed = title.kind === 'movie' ? raw : ((cands.length > 1 && applyAnimeDecision(cands, cachedDecision<string>(db, 'anime', animeKey(title, r)))) || resolveAbsolute(raw, info));
  const match = title.kind === 'movie' ? matchMovie(raw, r.size, title, rule, r.title) : matchRelease(parsed, r.size, info, rule);
  // уже известный ответ Laya по сомнительному совпадению (переразбор не спрашивает её заново)
  return { parsed, match: match.level === 'doubt' && !match.rule ? applyMatchDecision(match, cachedDecision<boolean>(db, 'match', matchKey(title, r))) : match };
}

/** Фильм: первая цифровая раздача (WEB-DL/BDRip/Remux) того же фильма — дата цифрового релиза, если TMDB её не знает. */
function noteDigital(db: Db, title: Title, saved: Release[], now: number) {
  if (title.digitalSeenAt) return;
  if (!saved.some((r) => r.match.level === 'match' && isDigital(movieSource(r.title, r.parsed)))) return;
  db.update(titles).set({ digitalSeenAt: new Date(now).toLocaleDateString('sv-SE') }).where(eq(titles.id, title.id)).run();
}

/** Переразобрать сохранённые раздачи сериала (после правки словаря или ответа «это он / не он»), без запросов к источникам. */
export function reparseReleases(db: Db, titleId: number) {
  const title = db.select().from(titles).where(eq(titles.id, titleId)).get();
  if (!title) return;
  const info = toTitleInfo(title, listSeasons(db, titleId));
  const studios = studioRefs(db);
  const ixById = new Map(db.select().from(trackers).all().map((t) => [t.id, t.indexerId]));
  db.transaction(() => {
    for (const r of db.select().from(releases).where(eq(releases.titleId, titleId)).all()) {
      const res = analyze(db, title, info, studios, { ...r, indexerId: (r.trackerId && ixById.get(r.trackerId)) || '' });
      db.update(releases).set(res).where(eq(releases.id, r.id)).run();
    }
  });
}

type ReleaseFields = Omit<typeof releases.$inferInsert, 'id' | 'titleId' | 'firstSeenAt'>;

/** Найти раздачу по infohash или по трекеру+заголовку+размеру (у неё мог не быть хэша раньше). */
function findRelease(db: Db, titleId: number, f: ReleaseFields) {
  const byKey = and(eq(releases.trackerName, f.trackerName), eq(releases.title, f.title), eq(releases.size, f.size));
  return db
    .select()
    .from(releases)
    .where(and(eq(releases.titleId, titleId), f.infohash ? or(eq(releases.infohash, f.infohash), byKey) : byKey))
    .get();
}

function upsertRelease(db: Db, titleId: number, f: ReleaseFields, now: number): Release {
  for (let attempt = 0; ; attempt++) {
    const existing = findRelease(db, titleId, f);
    if (existing) return db.update(releases).set(f).where(eq(releases.id, existing.id)).returning().get();
    try {
      return db.insert(releases).values({ ...f, titleId, firstSeenAt: now }).returning().get();
    } catch (e) {
      // другой процесс (воркер) успел вставить ту же раздачу — обновляем её
      if (attempt === 0 && e instanceof Error && /UNIQUE/.test(e.message)) continue;
      throw e;
    }
  }
}
