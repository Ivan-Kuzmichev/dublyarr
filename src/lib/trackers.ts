import { and, eq, ne } from 'drizzle-orm';
import type { Db } from './db/client';
import { sources, trackers, type Tracker } from './db/schema';
import type { TorznabIndexer } from './torznab';

// Трекеры источников. Один трекер (indexerId) может быть виден через несколько источников:
// основной — у источника, добавленного раньше; результаты запасного берутся, только если основной не ответил.

export function kindFromCategories(cats: number[]): Tracker['kind'] {
  const anime = cats.includes(5070);
  const series = cats.some((c) => c >= 5000 && c < 6000 && c !== 5070);
  return anime && series ? 'both' : anime ? 'anime' : series ? 'series' : 'unknown';
}

export function ensureTracker(db: Db, sourceId: number, indexerId: string, name: string, kind?: Tracker['kind']): Tracker {
  const existing = db
    .select()
    .from(trackers)
    .where(and(eq(trackers.sourceId, sourceId), eq(trackers.indexerId, indexerId)))
    .get();
  if (existing) {
    if (existing.name !== name || (kind && existing.kind !== kind))
      return db
        .update(trackers)
        .set({ name, ...(kind ? { kind } : {}) })
        .where(eq(trackers.id, existing.id))
        .returning()
        .get();
    return existing;
  }
  const other = db
    .select()
    .from(trackers)
    .where(and(eq(trackers.indexerId, indexerId), ne(trackers.sourceId, sourceId)))
    .get();
  db.insert(trackers)
    .values({ sourceId, indexerId, name, kind: kind ?? 'unknown', role: other ? 'backup' : 'primary' })
    .onConflictDoNothing() // другой процесс мог вставить его одновременно
    .run();
  return db
    .select()
    .from(trackers)
    .where(and(eq(trackers.sourceId, sourceId), eq(trackers.indexerId, indexerId)))
    .get()!;
}

export function syncTrackers(db: Db, sourceId: number, indexers: TorznabIndexer[]) {
  db.transaction(() => {
    for (const ix of indexers) ensureTracker(db, sourceId, ix.id, ix.name, kindFromCategories(ix.categories));
  });
}

export function setPrimary(db: Db, trackerId: number) {
  const t = db.select().from(trackers).where(eq(trackers.id, trackerId)).get();
  if (!t) return;
  db.transaction(() => {
    db.update(trackers).set({ role: 'backup' }).where(eq(trackers.indexerId, t.indexerId)).run();
    db.update(trackers).set({ role: 'primary' }).where(eq(trackers.id, trackerId)).run();
  });
}

export function markSourceTrackers(db: Db, sourceId: number, error: string | null, now = Date.now()) {
  db.update(trackers)
    .set(error ? { lastError: error, lastErrorAt: now } : { lastOkAt: now, lastError: null })
    .where(eq(trackers.sourceId, sourceId))
    .run();
}

export type TrackerRow = {
  indexerId: string;
  name: string;
  kind: Tracker['kind'];
  primary: { sourceName: string; trackerId: number } | null;
  backups: { sourceName: string; trackerId: number }[];
  status: 'ok' | 'error' | 'unknown';
  error?: string;
};

/** Таблица «Трекер · Основной · Запасной · Статус» для настроек. */
export function trackersTable(db: Db): TrackerRow[] {
  const rows = db.select({ t: trackers, sourceName: sources.name }).from(trackers).innerJoin(sources, eq(sources.id, trackers.sourceId)).orderBy(trackers.id).all();
  const byIndexer = new Map<string, TrackerRow>();
  for (const { t, sourceName } of rows) {
    const row = byIndexer.get(t.indexerId) ?? { indexerId: t.indexerId, name: t.name, kind: t.kind, primary: null, backups: [], status: 'unknown' as const };
    if (row.kind === 'unknown') row.kind = t.kind;
    const ref = { sourceName, trackerId: t.id };
    if (t.role === 'primary') {
      row.primary = ref;
      row.status = t.lastError && (t.lastErrorAt ?? 0) >= (t.lastOkAt ?? 0) ? 'error' : t.lastOkAt ? 'ok' : 'unknown';
      if (row.status === 'error') row.error = t.lastError ?? undefined;
    } else row.backups.push(ref);
    byIndexer.set(t.indexerId, row);
  }
  return [...byIndexer.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export type SourceCard = { id: number; name: string; url: string; trackers: number; lastOkAt: number | null; lastError: string | null };

/** Карточки источников в настройках: число трекеров и последнее состояние. */
export function sourceCards(db: Db): SourceCard[] {
  const all = db.select().from(trackers).all();
  return db
    .select()
    .from(sources)
    .orderBy(sources.id)
    .all()
    .map((s) => {
      const mine = all.filter((t) => t.sourceId === s.id);
      const ok = Math.max(0, ...mine.map((t) => t.lastOkAt ?? 0));
      const errAt = Math.max(0, ...mine.map((t) => t.lastErrorAt ?? 0));
      const lastError = errAt > ok ? (mine.find((t) => t.lastErrorAt === errAt)?.lastError ?? null) : null;
      return { id: s.id, name: s.name, url: s.url, trackers: mine.length, lastOkAt: ok || null, lastError };
    });
}
