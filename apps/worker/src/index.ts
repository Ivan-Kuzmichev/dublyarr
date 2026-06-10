import { join } from "node:path";
import pino from "pino";
import { openDb, getMonitorNumber, getSetting, MONITOR_DEFAULTS } from "@dublyarr/core/db";
import { QbtClient } from "@dublyarr/core/qbittorrent";
import { runTick } from "@dublyarr/core/tick";

const log = pino({ level: process.env.LOG_LEVEL ?? "info" });
// По умолчанию — та же БД, что у веба: next dev/start работает с cwd=apps/web
// и его "./data" = apps/web/data. Якоримся к файлу, а не к cwd, иначе
// `npm run worker` открыл бы собственную пустую apps/worker/data (split-brain).
// В Docker DATA_DIR задаётся явно (/data).
const dataDir =
  process.env.DATA_DIR ?? join(import.meta.dirname, "..", "..", "web", "data");
const { db } = openDb(join(dataDir, "dublyarr.db"));

let running = false;

async function tickOnce(): Promise<void> {
  if (running) {
    log.warn("предыдущий тик ещё идёт — пропускаю");
    return;
  }
  const url = getSetting(db, "qbit_url");
  if (!url) {
    log.info("qBittorrent не настроен — тик пропущен");
    return;
  }
  running = true;
  try {
    const qbt = new QbtClient({
      url,
      username: getSetting(db, "qbit_username") ?? "",
      password: getSetting(db, "qbit_password") ?? "",
    });
    const n = await runTick(db, { qbt });
    log.info({ candidates: n }, "тик завершён");
  } catch (e) {
    log.error({ err: e instanceof Error ? e.message : String(e) }, "ошибка тика");
  } finally {
    running = false;
  }
}

function intervalMs(): number {
  const min = getMonitorNumber(db, "monitor_interval_min") || MONITOR_DEFAULTS.monitor_interval_min;
  return Math.max(1, min) * 60_000;
}

log.info({ dataDir }, "воркер Dublyarr запущен");
void tickOnce();
let timer = setTimeout(function loop() {
  void tickOnce().finally(() => {
    timer = setTimeout(loop, intervalMs());
  });
}, intervalMs());

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    log.info("остановка воркера");
    clearTimeout(timer);
    process.exit(0);
  });
}
