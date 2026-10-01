import { getDb } from '../lib/db/client';
import { getConfig } from '../lib/config';
import { log } from '../lib/log';
import { beat } from '../lib/heartbeat';
import { runOnce, requeueStale, pruneJobs } from './jobs';
import { buildHandlers } from './handlers';
import { SEARCH_EVERY } from '../lib/autosearch';
import { scheduleDaily, scheduleEvery } from './schedule';

const db = getDb();
const handlers = buildHandlers(db);
let stopping = false;
let lastLaya = 0;
let layaOk = false;

async function checkLaya() {
  try {
    const r = await fetch(`http://127.0.0.1:${getConfig().layaPort}/health`, { signal: AbortSignal.timeout(3000) });
    layaOk = r.ok;
    beat(db, 'laya', r.ok, await r.text());
  } catch (e) {
    layaOk = false;
    beat(db, 'laya', false, e instanceof Error ? e.message : String(e));
  }
}

async function loop() {
  requeueStale(db);
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
    scheduleEvery(db, 'subscriptions.search', SEARCH_EVERY);
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
