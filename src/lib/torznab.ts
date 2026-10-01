import { XMLParser } from 'fast-xml-parser';

// Клиент Torznab (Jackett, Prowlarr): поиск, список трекеров, возможности.

export type TorznabSource = { url: string; apiKey: string; timeoutMs: number };

export type TorznabItem = {
  title: string;
  guid: string;
  link: string | null;
  magnet: string | null;
  details: string | null;
  publishedAt: number | null;
  size: number;
  seeders: number | null;
  peers: number | null;
  infohash: string | null;
  indexerId: string | null;
  indexerName: string | null;
  categories: number[];
  attrs: Record<string, string | string[]>;
};

export type TorznabIndexer = { id: string; name: string; categories: number[] };

export type TorznabErrorCode = 'auth' | 'network' | 'timeout' | 'bad' | 'http';
export class TorznabError extends Error {
  constructor(
    message: string,
    readonly code: TorznabErrorCode,
  ) {
    super(message);
  }
}

const ARRAYS = new Set(['item', 'category', 'torznab:attr', 'indexer', 'subcat']);
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', isArray: (name) => ARRAYS.has(name), parseTagValue: false });

type Node = Record<string, unknown>;
const text = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'object') return text((v as Node)['#text']);
  const s = String(v).trim();
  return s || null;
};
const num = (v: unknown): number | null => {
  const s = text(v);
  const n = s === null ? NaN : Number(s);
  return Number.isFinite(n) ? n : null;
};

export function torznabUrl(base: string, params: Record<string, string>): string {
  return `${base}${base.includes('?') ? '&' : '?'}${new URLSearchParams(params).toString()}`;
}

async function request(src: TorznabSource, params: Record<string, string>, fetchImpl: typeof fetch): Promise<Node> {
  const url = torznabUrl(src.url.trim(), { ...params, apikey: src.apiKey });
  let res: Response;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(src.timeoutMs) });
  } catch (e) {
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError'))
      throw new TorznabError(`Нет ответа за ${String(src.timeoutMs / 1000).replace('.', ',')} с`, 'timeout');
    throw new TorznabError(`Источник не отвечает: ${e instanceof Error ? e.message : String(e)}`, 'network');
  }
  if (!res.ok) throw new TorznabError(`HTTP ${res.status}`, 'http');
  const body = await res.text();
  let doc: Node;
  try {
    doc = parser.parse(body) as Node;
  } catch {
    throw new TorznabError('Ответ не похож на Torznab', 'bad');
  }
  const err = doc.error as Node | undefined;
  if (err) {
    if (String(err['@_code']) === '100') throw new TorznabError('Неверный API-ключ', 'auth');
    throw new TorznabError(`Источник ответил ошибкой: ${String(err['@_description'] ?? err['@_code'])}`, 'bad');
  }
  return doc;
}

function toItem(it: Node): TorznabItem {
  const attrs: Record<string, string | string[]> = {};
  for (const a of (it['torznab:attr'] as Node[] | undefined) ?? []) {
    const k = String(a['@_name']);
    const v = String(a['@_value']);
    const prev = attrs[k];
    attrs[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  const attr = (k: string) => {
    const v = attrs[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const jackett = it.jackettindexer as Node | string | undefined;
  const prowlarr = it.prowlarrindexer as Node | string | undefined;
  const indexerNode = jackett ?? prowlarr;
  const indexerId =
    (typeof indexerNode === 'object' ? text(indexerNode['@_id']) : null) ?? attr('indexer') ?? null;
  const enclosure = it.enclosure as Node | undefined;
  const categories = ((it.category as unknown[] | undefined) ?? []).map(num).filter((n): n is number => n !== null);
  const pub = text(it.pubDate);
  const hash = attr('infohash');
  return {
    title: text(it.title) ?? '',
    guid: text(it.guid) ?? '',
    link: text(it.link) ?? (enclosure ? text(enclosure['@_url']) : null),
    magnet: attr('magneturl') ?? null,
    details: text(it.comments),
    publishedAt: pub ? Date.parse(pub) || null : null,
    size: num(it.size) ?? (enclosure ? num(enclosure['@_length']) : null) ?? Number(attr('size') ?? 0),
    seeders: num(attr('seeders')),
    peers: num(attr('peers')),
    infohash: hash ? hash.toLowerCase() : null,
    indexerId,
    indexerName: text(indexerNode) ?? attr('indexer') ?? null,
    categories,
    attrs,
  };
}

export async function torznabSearch(src: TorznabSource, q: string, cats: number[], fetchImpl: typeof fetch = fetch): Promise<TorznabItem[]> {
  const doc = await request(src, { t: 'search', q, cat: cats.join(',') }, fetchImpl);
  const channel = (doc.rss as Node | undefined)?.channel as Node | undefined;
  if (!channel) throw new TorznabError('Ответ не похож на Torznab', 'bad');
  return ((channel.item as Node[] | undefined) ?? []).map(toItem).filter((i) => i.title);
}

/** Трекеры источника; null — источник не умеет t=indexers. */
export async function torznabIndexers(src: TorznabSource, fetchImpl: typeof fetch = fetch): Promise<TorznabIndexer[] | null> {
  let doc: Node;
  try {
    doc = await request(src, { t: 'indexers', configured: 'true' }, fetchImpl);
  } catch (e) {
    if (e instanceof TorznabError && e.code === 'bad') return null;
    throw e;
  }
  const list = (doc.indexers as Node | undefined)?.indexer as Node[] | undefined;
  if (!list) return null;
  return list.map((ix) => {
    const cats: number[] = [];
    const walk = (nodes: unknown) => {
      for (const c of (nodes as Node[] | undefined) ?? []) {
        const id = num(c['@_id']);
        if (id !== null) cats.push(id);
        walk(c.subcat);
      }
    };
    walk(((ix.caps as Node | undefined)?.categories as Node | undefined)?.category);
    return { id: String(ix['@_id']), name: text(ix.title) ?? String(ix['@_id']), categories: cats };
  });
}

export async function torznabCaps(src: TorznabSource, fetchImpl: typeof fetch = fetch): Promise<{ categories: number }> {
  const doc = await request(src, { t: 'caps' }, fetchImpl);
  const caps = doc.caps as Node | undefined;
  if (!caps) throw new TorznabError('Ответ не похож на Torznab', 'bad');
  return { categories: ((caps.categories as Node | undefined)?.category as unknown[] | undefined)?.length ?? 0 };
}
