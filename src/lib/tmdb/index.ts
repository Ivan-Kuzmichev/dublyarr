import { fetch as undiciFetch, ProxyAgent } from 'undici';
import type { Db } from '../db/client';
import { setSecretSetting, tryGetSecretSetting } from '../settings';
import { createTmdb, TmdbError, type Tmdb } from './client';

export type TmdbSettings = { apiKey: string; proxy?: string };

export const getTmdbSettings = (db: Db) => tryGetSecretSetting<TmdbSettings>(db, 'tmdb');

export function saveTmdbSettings(db: Db, s: TmdbSettings) {
  const apiKey = s.apiKey.trim();
  const proxy = s.proxy?.trim();
  setSecretSetting(db, 'tmdb', proxy ? { apiKey, proxy } : { apiKey });
}

const agents = new Map<string, ProxyAgent>();

/** fetch через HTTP(S)-прокси — для TMDB, если он недоступен с NAS напрямую. */
export function proxiedFetch(proxy?: string): typeof fetch {
  if (!proxy) return fetch;
  let agent = agents.get(proxy);
  if (!agent) agents.set(proxy, (agent = new ProxyAgent(proxy)));
  const dispatcher = agent;
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    undiciFetch(input instanceof Request ? input.url : String(input), {
      ...(init as Parameters<typeof undiciFetch>[1]),
      dispatcher,
    })) as unknown as typeof fetch;
}

export const tmdbFor = (s: TmdbSettings): Tmdb => createTmdb(s, { fetchImpl: proxiedFetch(s.proxy) });

export function getTmdb(db: Db): Tmdb | null {
  const s = getTmdbSettings(db);
  return s ? tmdbFor(s) : null;
}

export async function checkTmdb(s: TmdbSettings): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await tmdbFor(s).configuration();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof TmdbError ? e.message : `TMDB не отвечает: ${e instanceof Error ? e.message : String(e)}` };
  }
}
