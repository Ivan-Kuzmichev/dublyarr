import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { getConfig, type Config } from '../config';

/** Мастер-ключ шифрования секретов: из env или из `${dataDir}/secret.key` (создаётся при первом запуске). */
export function loadMasterKey(cfg: Pick<Config, 'dataDir' | 'secretKeyEnv'>): Buffer {
  if (cfg.secretKeyEnv) {
    const k = Buffer.from(cfg.secretKeyEnv, 'base64');
    if (k.length !== 32) throw new Error('DUBLYARR_SECRET_KEY должен быть base64 от 32 байт (openssl rand -base64 32)');
    return k;
  }
  const file = path.join(cfg.dataDir, 'secret.key');
  if (existsSync(file)) {
    const k = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
    if (k.length !== 32) throw new Error(`${file}: ключ должен быть base64 от 32 байт`);
    return k;
  }
  mkdirSync(cfg.dataDir, { recursive: true });
  const k = randomBytes(32);
  writeFileSync(file, k.toString('base64') + '\n', { mode: 0o600, flag: 'wx' });
  chmodSync(file, 0o600);
  return k;
}

let cached: Buffer | undefined;
export function getMasterKey(): Buffer {
  return (cached ??= loadMasterKey(getConfig()));
}
