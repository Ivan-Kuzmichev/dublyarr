import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Дообученные головы Laya (laya/heads из образа или {DATA_DIR}/laya/heads): включение — отсутствие файла heads.disabled;
// laya-serve перечитывает их по POST /reload (энкодер не перезагружается).

const flag = (dataDir: string) => path.join(dataDir, 'laya', 'heads.disabled');

export const headsEnabled = (dataDir: string) => !existsSync(flag(dataDir));

/** Есть ли что включать: головы (heads.safetensors) или надстройка (probe/*.json, 2.6) — свои в {DATA_DIR}/laya или из образа (laya/ рядом с приложением). */
export const headsAvailable = (dataDir: string, appDir = process.cwd()) =>
  [path.join(dataDir, 'laya'), path.join(appDir, 'laya')].some(
    (d) => existsSync(path.join(d, 'heads', 'heads.safetensors')) || (existsSync(path.join(d, 'probe')) && readdirSync(path.join(d, 'probe')).some((n) => n.endsWith('.json'))),
  );

export function setHeadsEnabled(dataDir: string, on: boolean) {
  if (on) rmSync(flag(dataDir), { force: true });
  else {
    mkdirSync(path.dirname(flag(dataDir)), { recursive: true });
    writeFileSync(flag(dataDir), '');
  }
}

/** Перечитать головы в laya-serve; модель после переключения или null — laya-serve недоступна. */
export async function reloadLaya(port: number, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const r = await fetchImpl(`http://127.0.0.1:${port}/reload`, { method: 'POST', signal: AbortSignal.timeout(30_000) });
    return r.ok ? (((await r.json()) as { model?: string }).model ?? null) : null;
  } catch {
    return null;
  }
}
