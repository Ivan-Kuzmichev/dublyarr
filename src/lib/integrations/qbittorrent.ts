import { createQbit, QbitError } from '../qbit';

export type QbitConfig = { url: string; username: string; password: string };
type Result = { ok: true; version: string } | { ok: false; error: string };

/** Проверка подключения к qBittorrent: вход и версия. */
export async function checkQbittorrent(cfg: QbitConfig, fetchImpl: typeof fetch = fetch): Promise<Result> {
  try {
    return { ok: true, version: await createQbit(cfg, { fetchImpl }).version() };
  } catch (e) {
    return { ok: false, error: e instanceof QbitError ? e.message : `qBittorrent не отвечает: ${e instanceof Error ? e.message : String(e)}` };
  }
}
