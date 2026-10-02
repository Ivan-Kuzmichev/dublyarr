import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Config } from '../lib/config';
import type { Db } from '../lib/db/client';
import { getTmdbSettings } from '../lib/tmdb';
import type { ChildSpec } from './supervisor';

const VENV_PYTHON = '/opt/laya/bin/python';

/** laya-serve: Python из venv образа (в разработке — системный), модель в {DATA_DIR}/laya, прокси — как у TMDB. */
export function layaChild(cfg: Config, db: Db, exists: (p: string) => boolean = existsSync): ChildSpec {
  const proxy = getTmdbSettings(db)?.proxy;
  return {
    name: 'laya',
    command: exists(VENV_PYTHON) ? VENV_PYTHON : 'python3',
    args: ['laya/serve.py', '--port', String(cfg.layaPort)],
    // полоски прогресса Hugging Face идут в stderr — в журнале они выглядели бы ошибками
    env: { LAYA_DIR: path.join(cfg.dataDir, 'laya'), HF_HUB_DISABLE_PROGRESS_BARS: '1', TQDM_DISABLE: '1', ...(proxy ? { HTTPS_PROXY: proxy, HTTP_PROXY: proxy } : {}) },
  };
}
