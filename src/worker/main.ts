import { getDb } from '../lib/db/client';
import { getConfig } from '../lib/config';
import { logger } from '../lib/log';
import { beat } from '../lib/heartbeat';
import { runOnce, requeueStale, pruneJobs } from './jobs';
import { buildHandlers } from './handlers';
import { getSchedule } from '../lib/schedule';

// поиск по расписанию: раз в 5 минут решается, каким подпискам пора
const TICK_EVERY = 5 * 60_000;
import { PACK_CHECK_EVERY } from '../lib/pack-watch';
import { backfillSightings } from '../lib/sightings';
import { cleanRemuxTmp } from '../lib/media/process';
import { getSetting } from '../lib/settings';
import { scheduleDaily, scheduleEvery } from './schedule';

const log = logger('worker');

const db = getDb();
const handlers = buildHandlers(db);
let stopping = false;
let lastLaya = 0;
let layaOk = false;

async function checkLaya() {
  try {
    const r = await fetch(`http://127.0.0.1:${getConfig().layaPort}/health`, { signal: AbortSignal.timeout(3000) });
    const text = await r.text();
    layaOk = r.ok && /"status":\s*"ready"/.test(text); // пока скачивает/загружает — проверяем чаще
    beat(db, 'laya', r.ok, text);
  } catch (e) {
    layaOk = false;
    beat(db, 'laya', false, e instanceof Error ? e.message : String(e));
  }
}

async function loop() {
  requeueStale(db);
  try {
    const media = getSetting<{ media: string }>(db, 'paths')?.media;
    if (media) await cleanRemuxTmp(media); // недоделанные пересборки после падения
  } catch (e) {
    log.warn({ err: e instanceof Error ? e.message : String(e) }, 'remux tmp cleanup failed');
  }
  try {
    backfillSightings(db);
  } catch (e) {
    log.warn({ err: e instanceof Error ? e.message : String(e) }, 'sightings backfill failed');
  }
  log.info('worker started');
  while (!stopping) {
    beat(db, 'worker', true);
    // Пока Laya не отвечает (например, ещё стартует) — проверяем чаще.
    if (Date.now() - lastLaya > (layaOk ? 60_000 : 10_000)) {
      lastLaya = Date.now();
      await checkLaya();
    }
    scheduleDaily(db, 'tmdb.refresh-all');
    scheduleEvery(db, 'downloads.sync', 60_000);
    scheduleEvery(db, 'subscriptions.tick', TICK_EVERY);
    scheduleEvery(db, 'cleanup.run', 60 * 60_000);
    scheduleEvery(db, 'retention.tick', TICK_EVERY);
    scheduleEvery(db, 'laya.train', 30 * 60_000);
    scheduleEvery(db, 'telegram.send', 15_000);
    scheduleEvery(db, 'telegram.poll', 15_000);
    if (getSchedule(db).packChecks) scheduleEvery(db, 'packs.check', PACK_CHECK_EVERY);
    pruneJobs(db);
    while (!stopping && (await runOnce(db, handlers))) {
      // разбираем очередь до конца
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  log.info('worker stopped');
  process.exit(0);
}

process.on('SIGTERM', () => {
  stopping = true;
});
void loop();
