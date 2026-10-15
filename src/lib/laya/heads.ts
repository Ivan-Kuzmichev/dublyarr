import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Дообученные головы Laya (laya/heads из образа или {DATA_DIR}/laya/heads): включение — отсутствие файла heads.disabled;
// laya-serve перечитывает их по POST /reload (энкодер не перезагружается).

const flag = (dataDir: string) => path.join(dataDir, 'laya', 'heads.disabled');

export const headsEnabled = (dataDir: string) => !existsSync(flag(dataDir));

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
