import type { Db } from '../lib/db/client';
import type { Tmdb } from '../lib/tmdb/client';
import { getTmdb } from '../lib/tmdb';
import { syncTitle, titlesDueForRefresh } from '../lib/catalog';
import { log } from '../lib/log';
import type { Handler } from './jobs';

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

export const buildHandlers = (db: Db): Record<string, Handler> => ({
  'tmdb.refresh-all': async () => {
    const r = await refreshAll(db, getTmdb(db));
    log.info(r, 'tmdb refresh done');
  },
});
