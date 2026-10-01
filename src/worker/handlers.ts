import type { Db } from '../lib/db/client';
import type { Tmdb } from '../lib/tmdb/client';
import { getTmdb } from '../lib/tmdb';
import { syncTitle, titlesDueForRefresh } from '../lib/catalog';
import { log } from '../lib/log';
import type { Handler } from './jobs';
import { getQbit } from '../lib/qbit';
import { fetchTorrentFile, syncDownloads, type Paths } from '../lib/downloads';
import { searchAll } from '../lib/autosearch';
import { getSetting } from '../lib/settings';
import { beat } from '../lib/heartbeat';
import { downloads } from '../lib/db/schema';
import { eq } from 'drizzle-orm';

/** Обновляет сериалы по одному; ошибка одного не мешает остальным. */
export async function refreshAll(db: Db, tmdb: Tmdb | null, now = Date.now()) {
  const res = { ok: 0, failed: 0 };
  if (!tmdb) return res;
  for (const t of titlesDueForRefresh(db, now)) {
    try {
      await syncTitle(db, tmdb, t.tmdbId, { now });
      res.ok++;
    } catch (e) {
      res.failed++;
      log.warn({ tmdbId: t.tmdbId, err: e instanceof Error ? e.message : String(e) }, 'tmdb refresh failed');
    }
  }
  return res;
}

/** Синхронизация загрузок; результат — в статус qBittorrent. */
export async function syncJob(db: Db) {
  const qbit = getQbit(db);
  const paths = getSetting<Paths>(db, 'paths');
  if (!qbit || !paths) {
    beat(db, 'qbit', false, 'не настроен');
    return;
  }
  try {
    await syncDownloads(db, { qbit, paths });
    const n = db.select().from(downloads).where(eq(downloads.state, 'downloading')).all().length;
    beat(db, 'qbit', true, n ? `${n} ↓` : 'ок');
  } catch (e) {
    beat(db, 'qbit', false, e instanceof Error ? e.message : String(e));
  }
}

export const buildHandlers = (db: Db): Record<string, Handler> => ({
  'downloads.sync': () => syncJob(db),
  'subscriptions.search': async () => {
    const paths = getSetting<Paths>(db, 'paths');
    if (!paths) return;
    const r = await searchAll(db, { qbit: getQbit(db), fetchTorrent: (rel) => fetchTorrentFile(rel), paths });
    log.info(r, 'subscriptions search done');
  },
  'tmdb.refresh-all': async () => {
    const r = await refreshAll(db, getTmdb(db));
    log.info(r, 'tmdb refresh done');
  },
});
