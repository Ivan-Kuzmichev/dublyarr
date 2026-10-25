import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

// Дообученная Laya (laya/heads и laya/probe из образа или свои в {DATA_DIR}/laya): есть — используется всегда (2.8, без выключателя).

/** Есть ли дообучение: головы (heads.safetensors) или надстройка (probe/*.json, 2.6) — свои в {DATA_DIR}/laya или из образа (laya/ рядом с приложением). */
export const headsAvailable = (dataDir: string, appDir = process.cwd()) =>
  [path.join(dataDir, 'laya'), path.join(appDir, 'laya')].some(
    (d) => existsSync(path.join(d, 'heads', 'heads.safetensors')) || (existsSync(path.join(d, 'probe')) && readdirSync(path.join(d, 'probe')).some((n) => n.endsWith('.json'))),
  );
