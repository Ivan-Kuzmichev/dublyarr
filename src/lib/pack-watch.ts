import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from './db/client';
import { downloads, episodeFiles, episodes, releases, subscriptions, type Download, type EpisodeRef } from './db/schema';
import { wantedEpisodes } from './subscriptions';
import { switchTorrent, type DownloadDeps } from './downloads';
import { todayIso } from './dates';
import { logger } from './log';
import { getSetting, setSetting } from './settings';

const log = logger('downloads');

// Проверка обновлений знакомых паков (spec §4 п. 1, §5): новая версия топика → докачка в ту же раздачу.

export const PACK_CHECK_EVERY = 30 * 60_000;
/** .torrent пака не скачался (трекер не отвечает) — следующая проверка этого пака не раньше чем через 6 ч. */
const RETRY_AFTER_FAIL = 6 * 3_600_000;
const RETRY_KEY = 'packs.retryAt';

const LIVE: Download['state'][] = ['adding', 'downloading', 'paused', 'stalled', 'completed', 'imported'];
const key = (e: { season: number; number: number }) => `${e.season}:${e.number}`;

type Candidate = { download: Download; release: typeof releases.$inferSelect; need: EpisodeRef[]; pending: boolean };

function candidates(db: Db, today: string): Candidate[] {
  const rows = db
    .select({ d: downloads, r: releases, s: subscriptions })
    .from(downloads)
    .innerJoin(releases, eq(releases.id, downloads.releaseId))
    .innerJoin(subscriptions, eq(subscriptions.titleId, downloads.titleId))
    .where(and(eq(downloads.kind, 'pack'), inArray(downloads.state, LIVE), isNotNull(releases.detailsUrl), isNotNull(releases.downloadEnc)))
    .all();
  const out: Candidate[] = [];
  for (const { d, r, s } of rows) {
    const eps = db.select().from(episodes).where(and(eq(episodes.titleId, d.titleId), eq(episodes.season, d.season))).all();
    const have = new Set(db.select().from(episodeFiles).where(eq(episodeFiles.titleId, d.titleId)).all().map(key));
    const busy = new Set(
      db
        .select()
        .from(downloads)
        .where(and(eq(downloads.titleId, d.titleId), inArray(downloads.state, LIVE)))
        .all()
        .filter((x) => x.id !== d.id)
        .flatMap((x) => x.episodes.map(key)),
    );
    const missing = wantedEpisodes(s, eps, today).filter((e) => !have.has(key(e)));
    // для смены версии — нужные серии, которые не качаются ни здесь, ни в другой загрузке
    const need = missing.filter((e) => !busy.has(key(e)) && !d.episodes.some((x) => key(x) === key(e)));
    const upcoming = eps.some((e) => e.season > 0 && !have.has(key(e)) && (!e.airDate || e.airDate > today));
    out.push({ download: d, release: r, need, pending: missing.length > 0 || upcoming });
  }
  return out;
}

/** Паки подписок, в сезоне которых ещё есть нескачанные нужные или будущие серии. */
export function watchedPacks(db: Db, today: string): Download[] {
  return candidates(db, today)
    .filter((c) => c.pending)
    .map((c) => c.download);
}

/** Скачать текущий .torrent каждого отслеживаемого пака; другой хэш и есть нужные серии → смена версии. */
export async function checkPacks(db: Db, deps: DownloadDeps & { today?: string }) {
  const res = { checked: 0, switched: 0, errors: 0 };
  const now = deps.now ?? Date.now();
  const retry = getSetting<Record<string, number>>(db, RETRY_KEY) ?? {};
  for (const c of candidates(db, deps.today ?? todayIso()).filter((x) => x.pending)) {
    if ((retry[c.download.id] ?? 0) > now) continue;
    res.checked++;
    try {
      // перечитываем: за время проверки предыдущих эта загрузка могла смениться
      const d = db.select().from(downloads).where(eq(downloads.id, c.download.id)).get();
      if (!d || !LIVE.includes(d.state) || !c.need.length) continue;
      const torrent = await deps.fetchTorrent(c.release);
      delete retry[c.download.id];
      if (!Buffer.isBuffer(torrent)) continue;
      const r = await switchTorrent(db, deps, d, torrent, c.need);
      if (r.switched) res.switched++;
    } catch (e) {
      res.errors++;
      retry[c.download.id] = now + RETRY_AFTER_FAIL;
      log.warn({ download: c.download.id, err: e instanceof Error ? e.message : String(e), retryAt: retry[c.download.id] }, 'pack check failed');
    }
  }
  setSetting(db, RETRY_KEY, retry);
  return res;
}
