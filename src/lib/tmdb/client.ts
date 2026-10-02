import type { TmdbPage, TmdbSeason, TmdbTvDetails, TmdbTvListItem, TmdbListItem, TmdbMovieDetails } from './types';
import { logger } from '../log';

const tlog = logger('tmdb');

export type TmdbConfig = { apiKey: string; proxy?: string };
export type TmdbErrorCode = 'auth' | 'rate' | 'network' | 'not_found' | 'http';

export class TmdbError extends Error {
  constructor(
    message: string,
    readonly code: TmdbErrorCode,
  ) {
    super(message);
  }
}

export type TmdbOptions = { fetchImpl?: typeof fetch; baseUrl?: string; sleep?: (ms: number) => Promise<void>; now?: () => number };

export type Tmdb = {
  configuration(): Promise<void>;
  details(id: number): Promise<TmdbTvDetails>;
  season(id: number, n: number): Promise<TmdbSeason>;
  search(query: string): Promise<TmdbTvListItem[]>;
  trending(): Promise<TmdbTvListItem[]>;
  movie(id: number): Promise<TmdbMovieDetails>;
  searchMulti(query: string): Promise<TmdbListItem[]>;
  trendingAll(): Promise<TmdbListItem[]>;
};

const LIST_TTL = 3_600_000;
const listCache = new Map<string, { at: number; items: unknown[] }>();
export const clearTmdbCache = () => listCache.clear();

// Ключ API v3 — 32 hex-символа; всё остальное считаем токеном v4 (Read Access Token).
const isV3Key = (k: string) => /^[0-9a-f]{32}$/i.test(k);
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createTmdb(cfg: TmdbConfig, opts: TmdbOptions = {}): Tmdb {
  const baseUrl = (opts.baseUrl ?? process.env.TMDB_BASE_URL ?? 'https://api.themoviedb.org/3').replace(/\/+$/, '');
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;

  async function get<T>(path: string, params: Record<string, string> = {}, language = 'ru-RU'): Promise<T> {
    const url = new URL(baseUrl + path);
    for (const [k, v] of Object.entries({ ...params, language })) url.searchParams.set(k, v);
    const headers: Record<string, string> = { accept: 'application/json' };
    if (isV3Key(cfg.apiKey)) url.searchParams.set('api_key', cfg.apiKey);
    else headers.authorization = `Bearer ${cfg.apiKey}`;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await doFetch(url, { headers, signal: AbortSignal.timeout(10_000) });
      } catch (e) {
        tlog.warn({ path, err: reason(e) }, 'tmdb call failed');
        throw new TmdbError(`TMDB не отвечает: ${reason(e)}`, 'network');
      }
      tlog.debug({ path, status: res.status, attempt }, 'tmdb call');
      if (res.ok) return (await res.json()) as T;
      if (res.status === 429 && attempt === 0) {
        const retry = Number(res.headers.get('retry-after')) || 1;
        await sleep(Math.min(retry * 1000, 5000));
        continue;
      }
      if (res.status === 401) throw new TmdbError('Неверный ключ TMDB', 'auth');
      if (res.status === 404) throw new TmdbError('Не найдено в TMDB', 'not_found');
      if (res.status === 429) throw new TmdbError('TMDB ограничил запросы, попробуйте позже', 'rate');
      throw new TmdbError(`TMDB ответил ошибкой ${res.status}`, 'http');
    }
  }

  async function list<T = TmdbTvListItem>(key: string, path: string, params: Record<string, string>): Promise<T[]> {
    const hit = listCache.get(key);
    if (hit && now() - hit.at < LIST_TTL) return hit.items as T[];
    const page = await get<TmdbPage<T>>(path, params);
    listCache.set(key, { at: now(), items: page.results });
    return page.results;
  }

  return {
    async configuration() {
      await get('/configuration', {}, 'en-US');
    },
    async details(id) {
      const d = await get<TmdbTvDetails>(`/tv/${id}`, { append_to_response: 'alternative_titles,external_ids,translations' });
      if (!d.overview || !d.name) {
        const en = await get<TmdbTvDetails>(`/tv/${id}`, {}, 'en-US');
        d.overview ||= en.overview;
        d.name ||= en.name;
      }
      return d;
    },
    season: (id, n) => get<TmdbSeason>(`/tv/${id}/season/${n}`),
    search(q) {
      const query = q.trim().toLowerCase();
      return list(`search:${query}`, '/search/tv', { query, include_adult: 'false' });
    },
    trending: () => list('trending', '/trending/tv/week', {}),
    async movie(id) {
      const d = await get<TmdbMovieDetails>(`/movie/${id}`, { append_to_response: 'alternative_titles,release_dates,translations' });
      if (!d.overview || !d.title) {
        const en = await get<TmdbMovieDetails>(`/movie/${id}`, {}, 'en-US');
        d.overview ||= en.overview;
        d.title ||= en.title;
      }
      return d;
    },
    async searchMulti(q) {
      const query = q.trim().toLowerCase();
      const items = await list<TmdbListItem>(`multi:${query}`, '/search/multi', { query, include_adult: 'false' });
      return items.filter((i) => i.media_type === 'tv' || i.media_type === 'movie');
    },
    async trendingAll() {
      const items = await list<TmdbListItem>('trending-all', '/trending/all/week', {});
      return items.filter((i) => i.media_type === 'tv' || i.media_type === 'movie');
    },
  };
}
