import { log, redactUrl } from '../log';
import { torznabCaps, TorznabError } from '../torznab';

type Result = { ok: true; categories: number } | { ok: false; error: string };

/** Проверка Torznab-источника (Jackett/Prowlarr) запросом t=caps. */
export async function checkTorznab(s: { url: string; apiKey: string; timeoutMs?: number }, fetchImpl: typeof fetch = fetch): Promise<Result> {
  try {
    return { ok: true, ...(await torznabCaps({ url: s.url, apiKey: s.apiKey, timeoutMs: s.timeoutMs ?? 15_000 }, fetchImpl)) };
  } catch (e) {
    const error = e instanceof TorznabError ? e.message : `Источник не отвечает: ${e instanceof Error ? e.message : String(e)}`;
    log.warn({ url: redactUrl(s.url), err: error }, 'torznab caps failed');
    return { ok: false, error };
  }
}
