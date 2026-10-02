import { TorznabError, type TorznabItem } from './torznab';
import { logger } from './log';

// JacRed (jac.red и свои установки): JSON-поиск /api/v1.0/torrents. Раздачи — magnet, трекер — поле tracker.
// Публичный jac.red ограничивает частоту: к одному адресу — по одному запросу, пауза ≥ 1 с, 429 — одна пауза по Retry-After.

type Src = { url: string; apiKey: string; timeoutMs: number };
type Opts = { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> };
type Raw = { tracker?: string; url?: string; title?: string; size?: number; createTime?: string; sid?: number; pir?: number; magnet?: string | null; types?: string[] };

const log = logger('search');
const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const GAP_MS = 1000;
const MAX_RETRY_MS = 10_000;
const TYPES: Record<'series' | 'anime' | 'movie', string[]> = {
  series: ['serial', 'tvshow', 'multserial', 'docuserial'],
  anime: ['anime', 'serial', 'tvshow', 'multserial'],
  movie: ['movie', 'multfilm', 'documovie'],
};

const queues = new Map<string, Promise<unknown>>();
function serial<T>(key: string, sleep: (ms: number) => Promise<void>, fn: () => Promise<T>): Promise<T> {
  const next = (queues.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      try {
        return await fn();
      } finally {
        await sleep(GAP_MS);
      }
    });
  queues.set(key, next);
  return next;
}

async function get(src: Src, query: string, o: Opts): Promise<unknown> {
  const fetchImpl = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? sleepMs;
  const url = `${src.url.trim().replace(/\/+$/, '')}/api/v1.0/torrents?${query}${src.apiKey ? `&apikey=${encodeURIComponent(src.apiKey)}` : ''}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(url, { signal: AbortSignal.timeout(src.timeoutMs) });
    } catch (e) {
      if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError'))
        throw new TorznabError(`Нет ответа за ${String(src.timeoutMs / 1000).replace('.', ',')} с`, 'timeout');
      throw new TorznabError('JacRed не отвечает', 'network');
    }
    if (res.status === 429) {
      if (attempt === 1) break;
      const wait = Math.min(MAX_RETRY_MS, (Number(res.headers.get('retry-after')) || 5) * 1000);
      log.warn({ source: src.url, wait }, 'jacred 429');
      await sleep(wait);
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new TorznabError('Неверный ключ JacRed', 'auth');
    if (!res.ok) throw new TorznabError(`HTTP ${res.status}`, 'http');
    try {
      return await res.json();
    } catch {
      throw new TorznabError('Ответ не похож на JacRed', 'bad');
    }
  }
  throw new TorznabError('JacRed не ответил: слишком много запросов', 'http');
}

/** Имена трекеров JacRed, которые у Jackett называются иначе: иначе один трекер — два «основных» и дубли раздач. */
const SAME_AS_JACKETT: Record<string, string> = { aniliberty: 'anilibria' };
const trackerId = (t: string | undefined) => (t ? (SAME_AS_JACKETT[t.toLowerCase()] ?? t) : null);

const btih = (m: string) => /xt=urn:btih:([0-9a-f]{40})/i.exec(m)?.[1]?.toLowerCase() ?? null;

export async function jacredSearch(src: Src, q: string, kind: 'series' | 'anime' | 'movie', o: Opts = {}): Promise<TorznabItem[]> {
  const started = Date.now();
  const body = await serial(src.url, o.sleep ?? sleepMs, () => get(src, `search=${encodeURIComponent(q)}`, o));
  if (!Array.isArray(body)) throw new TorznabError('Ответ не похож на JacRed', 'bad');
  const want = new Set(TYPES[kind]);
  const items = (body as Raw[]).flatMap((r): TorznabItem[] => {
    const hash = r.magnet ? btih(r.magnet) : null;
    if (!hash || !r.title) return [];
    if (r.types?.length && !r.types.some((t) => want.has(t))) return [];
    return [
      {
        title: r.title,
        guid: r.url ?? hash,
        link: null,
        magnet: r.magnet!,
        details: r.url ?? null,
        publishedAt: r.createTime ? Date.parse(r.createTime) || null : null,
        size: r.size ?? 0,
        seeders: r.sid ?? null,
        peers: r.pir ?? null,
        infohash: hash,
        indexerId: trackerId(r.tracker),
        indexerName: r.tracker ?? null,
        categories: [],
        attrs: {},
      },
    ];
  });
  log.debug({ source: src.url, q, found: items.length, ms: Date.now() - started }, 'jacred search');
  return items;
}

/** «Проверить»: JacRed отвечает списком на пробный поиск. */
export async function jacredCheck(src: Src, o: Opts = {}): Promise<void> {
  const body = await serial(src.url, o.sleep ?? sleepMs, () => get(src, 'search=test', o));
  if (!Array.isArray(body)) throw new TorznabError('Ответ не похож на JacRed', 'bad');
}
