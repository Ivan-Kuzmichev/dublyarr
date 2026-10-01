import { and, eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { releases, titles, trackers, type Release, type Title } from './db/schema';
import { listSeasons } from './catalog';
import { listStudios } from './studios';
import { sourcesForSearch } from './sources';
import { ensureTracker, markSourceTrackers } from './trackers';
import { torznabSearch, TorznabError, type TorznabItem } from './torznab';
import { parseRelease } from './parse/dubs';
import { normalizeTitle } from './parse/normalize';
import { matchRelease, resolveAbsolute, toTitleInfo } from './match';
import { ruleFor } from './release-rules';
import { encrypt } from './crypto/secretbox';
import { log } from './log';

export type SourceStatus = { sourceId: number; name: string; ok: boolean; found: number; ms: number; error?: string };
export type SearchOptions = { fetchImpl?: typeof fetch; now?: number };

const CATEGORIES = [5000, 5070];
const MAX_QUERIES = 4;
const isLatin = (s: string) => /[a-z]/i.test(s) && !/[^\p{Script=Latin}\p{N}\p{P}\p{Zs}\p{S}]/u.test(s);
const isSearchable = (s: string) => /[a-zа-яё]/i.test(s); // японские иероглифы трекеры не находят

/** Запросы к трекерам: уникальные названия сериала; для аниме — сначала латиница (романдзи, английское). */
export function queriesFor(t: Pick<Title, 'kind' | 'nameRu' | 'nameOriginal' | 'altNames'>): string[] {
  const all = [t.nameRu, t.nameOriginal, ...t.altNames].filter(isSearchable);
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
        const lists = await Promise.all(queries.map((q) => torznabSearch(src, q, CATEGORIES, opts.fetchImpl)));
        const items = lists.flat();
        return { status: { sourceId: src.id, name: src.name, ok: true, found: items.length, ms: Date.now() - started } as SourceStatus, items };
      } catch (e) {
        const error = e instanceof TorznabError ? e.message : e instanceof Error ? e.message : String(e);
        log.warn({ source: src.name, err: error }, 'torznab search failed');
        return { status: { sourceId: src.id, name: src.name, ok: false, found: 0, ms: Date.now() - started, error }, items: [] as TorznabItem[] };
      }
    }),
  );
  const statuses = settled.map((s) => s.status);
  for (const s of statuses) markSourceTrackers(db, s.sourceId, s.ok ? null : (s.error ?? 'ошибка'), now);
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
  const studios = listStudios(db).map((s) => ({ id: s.id, name: s.name, aliases: s.aliases, trackers: s.trackers }));
  const saved: Release[] = [];
  for (const k of unique.values()) {
    const it = k.item;
    const parsed = resolveAbsolute(parseRelease(it.title, it.attrs, { id: it.indexerId ?? '', name: k.trackerName }, studios), info);
    const match = matchRelease(parsed, it.size, info, ruleFor(db, title.id, k.trackerName, it.title));
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
    const existing = db
      .select()
      .from(releases)
      .where(
        it.infohash
          ? and(eq(releases.titleId, title.id), eq(releases.infohash, it.infohash))
          : and(eq(releases.titleId, title.id), eq(releases.trackerName, k.trackerName), eq(releases.title, it.title), eq(releases.size, it.size)),
      )
      .get();
    saved.push(
      existing
        ? db.update(releases).set(fields).where(eq(releases.id, existing.id)).returning().get()
        : db
            .insert(releases)
            .values({ ...fields, titleId: title.id, firstSeenAt: now })
            .returning()
            .get(),
    );
  }
  return { releases: saved, sources: statuses };
}
