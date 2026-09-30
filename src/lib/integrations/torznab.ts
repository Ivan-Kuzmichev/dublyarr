import { log, redactUrl } from '../log';

type Result = { ok: true; categories: number } | { ok: false; error: string };

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Проверка Torznab-источника (Jackett/Prowlarr) запросом t=caps. */
export async function checkTorznab(s: { url: string; apiKey: string }, fetchImpl: typeof fetch = fetch): Promise<Result> {
  const base = s.url.trim();
  const url = `${base}${base.includes('?') ? '&' : '?'}t=caps&apikey=${encodeURIComponent(s.apiKey)}`;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    const xml = await res.text();
    if (/<error[^>]*code="100"/.test(xml)) return { ok: false, error: 'Неверный API-ключ' };
    if (!/<caps[\s>]/.test(xml)) return { ok: false, error: 'Ответ не похож на Torznab' };
    return { ok: true, categories: (xml.match(/<category\s/g) ?? []).length };
  } catch (e) {
    log.warn({ url: redactUrl(url), err: reason(e) }, 'torznab caps failed');
    return { ok: false, error: `Источник не отвечает: ${reason(e)}` };
  }
}
