// Точка входа контейнера: ключ → миграции → web + worker + laya.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../lib/config';
import { openDb, migrateDb } from '../lib/db/client';
import { loadMasterKey } from '../lib/crypto/key';
import { startSupervisor } from './supervisor';
import { layaChild } from './laya-child';
import { layaEnabled } from '../lib/laya/settings';
import { createLogSink } from './log-sink';

const cfg = loadConfig();
const keyFile = path.join(cfg.dataDir, 'secret.key');
const hadKeyFile = existsSync(keyFile);
loadMasterKey(cfg);
if (!cfg.secretKeyEnv && !hadKeyFile) {
  console.warn(`[supervisor] DUBLYARR_SECRET_KEY не задан — ключ сохранён в ${keyFile}; держите его в бэкапе вместе с базой`);
}

const db = openDb(cfg.dbPath);
migrateDb(db);
const laya = layaChild(cfg, db);

const sink = createLogSink(path.join(cfg.dataDir, 'logs'));
if (sink.error) console.warn(`[supervisor] ${sink.error}`);

const sup = startSupervisor({
  sink,
  children: [
    { name: 'web', command: process.execPath, args: ['node_modules/next/dist/bin/next', 'start', '-p', String(cfg.port), '-H', '0.0.0.0'] },
    { name: 'worker', command: process.execPath, args: ['dist/worker.cjs'] },
    laya,
  ],
  // выключатель Laya (Настройки → AI): выключена — laya-serve не держит память и процессор NAS
  wanted: (name) => {
    if (name !== 'laya') return true;
    try {
      return layaEnabled(db);
    } catch {
      return true;
    }
  },
});

const shutdown = () => {
  void sup.stop().then(() => {
    db.$client.close();
    process.exit(0);
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
