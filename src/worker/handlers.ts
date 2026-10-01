import type { Db } from '../lib/db/client';
import type { Tmdb } from '../lib/tmdb/client';
import { getTmdb } from '../lib/tmdb';
import { syncTitle, titlesDueForRefresh } from '../lib/catalog';
import { syncMovie } from '../lib/movies';
import { log } from '../lib/log';
import type { Handler } from './jobs';
import { getQbit } from '../lib/qbit';
import { fetchTorrentFile, syncDownloads, type Paths } from '../lib/downloads';
import { searchAll, searchDueTitles } from '../lib/autosearch';
import { getSchedule } from '../lib/schedule';
import { applySpeed } from '../lib/speed';
import { checkDisk, diskUsage, fullestDisk } from '../lib/storage';
import { getCleanup, runCleanup } from '../lib/cleanup';
import { createTelegram, getTelegramSettings, telegramProxy } from '../lib/telegram';
import { sendPending } from '../lib/notify';
import { pollUpdates } from '../lib/telegram-updates';
import { checkPacks } from '../lib/pack-watch';
import { getSetting, setSetting } from '../lib/settings';
import { runRetention } from '../lib/retention';
import { getRetention, retentionDue } from '../lib/retention-settings';
import { beat } from '../lib/heartbeat';
import { downloads } from '../lib/db/schema';
import { eq } from 'drizzle-orm';

/** Обновляет сериалы по одному; ошибка одного не мешает остальным. */
export async function refreshAll(db: Db, tmdb: Tmdb | null, now = Date.now()) {
  const res = { ok: 0, failed: 0 };
  if (!tmdb) return res;
  for (const t of titlesDueForRefresh(db, now)) {
    try {
      if (t.kind === 'movie') await syncMovie(db, tmdb, t.tmdbId, now);
      else await syncTitle(db, tmdb, t.tmdbId, { now });
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
    checkDisk(db, fullestDisk([await diskUsage(paths.media), paths.movies ? await diskUsage(paths.movies) : null]), getRetention(db), Date.now());
    await applySpeed(db, qbit, new Date());
    const n = db.select().from(downloads).where(eq(downloads.state, 'downloading')).all().length;
    beat(db, 'qbit', true, n ? `${n} ↓` : 'ок');
  } catch (e) {
    beat(db, 'qbit', false, e instanceof Error ? e.message : String(e));
  }
}

async function retentionJob(db: Db) {
  const paths = getSetting<Paths>(db, 'paths');
  if (!paths) return;
  const r = await runRetention(db, paths, getRetention(db), Date.now());
  setSetting(db, 'retention.lastRun', Date.now());
  if (r.deleted || r.pending) log.info(r, 'retention done');
}

async function packsJob(db: Db) {
  const qbit = getQbit(db);
  const paths = getSetting<Paths>(db, 'paths');
  if (!qbit || !paths) return;
  const r = await checkPacks(db, { qbit, fetchTorrent: (rel) => fetchTorrentFile(rel), paths: { qbitDownloads: paths.qbitDownloads ?? paths.downloads } });
  if (r.checked) log.info(r, 'packs check done');
}

/** Клиент и чат Telegram, если бот настроен и чат привязан. */
function telegramFor(db: Db) {
  const s = getTelegramSettings(db);
  if (!s?.token || !s.chatId) return null;
  return { client: createTelegram({ token: s.token, proxy: telegramProxy(db, s) }), chatId: s.chatId };
}

export const buildHandlers = (db: Db): Record<string, Handler> => ({
  'downloads.sync': () => syncJob(db),
  'subscriptions.search': async () => {
    const paths = getSetting<Paths>(db, 'paths');
    if (!paths) return;
    const r = await searchAll(db, { qbit: getQbit(db), fetchTorrent: (rel) => fetchTorrentFile(rel), paths });
    log.info(r, 'subscriptions search done');
  },
  'subscriptions.tick': async () => {
    const paths = getSetting<Paths>(db, 'paths');
    if (!paths) return;
    const r = await searchDueTitles(db, { qbit: getQbit(db), fetchTorrent: (rel) => fetchTorrentFile(rel), paths });
    if (r.titles) log.info(r, 'scheduled search done');
    // проверка паков выключена отдельно — паки проверяются вместе с поиском
    if (r.titles && !getSchedule(db).packChecks) await packsJob(db);
  },
  'packs.check': () => packsJob(db),
  // уборка медиатеки: по расписанию (04:00) и «Запустить сейчас»
  'retention.tick': async () => {
    const settings = getRetention(db);
    if (retentionDue(settings.schedule, getSetting<number>(db, 'retention.lastRun') ?? null, new Date())) await retentionJob(db);
  },
  'retention.run': () => retentionJob(db),
  'telegram.poll': async () => {
    const s = getTelegramSettings(db);
    if (!s?.token) return;
    await pollUpdates(db, createTelegram({ token: s.token, proxy: telegramProxy(db, s) }));
  },
  'telegram.send': async () => {
    const tg = telegramFor(db);
    if (!tg) return;
    const r = await sendPending(db, tg.client, tg.chatId);
    if (r.sent || r.failed) log.info(r, 'telegram send');
  },
  'cleanup.run': async () => {
    const qbit = getQbit(db);
    const paths = getSetting<Paths>(db, 'paths');
    if (!qbit || !paths) return;
    const r = await runCleanup(db, qbit, paths, getCleanup(db), Date.now());
    if (r.removed || r.pending) log.info(r, 'cleanup done');
  },
  'tmdb.refresh-all': async () => {
    const r = await refreshAll(db, getTmdb(db));
    log.info(r, 'tmdb refresh done');
  },
});
