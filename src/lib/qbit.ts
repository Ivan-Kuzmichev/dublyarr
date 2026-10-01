import type { Db } from './db/client';
import { tryGetSecretSetting } from './settings';
import type { QbitConfig } from './integrations/qbittorrent';

// Клиент qBittorrent WebAPI v2 (v4 и v5). Файлы с диска не удаляет никогда.

export type QbitTorrent = {
  hash: string;
  name: string;
  state: string;
  progress: number;
  dlspeed: number;
  eta: number;
  size: number;
  num_seeds: number;
  save_path: string;
  content_path: string;
  category: string;
};
export type QbitFile = { index: number; name: string; size: number; progress: number; priority: number };
export type QbitErrorCode = 'auth' | 'network' | 'http' | 'banned';
export class QbitError extends Error {
  constructor(
    message: string,
    readonly code: QbitErrorCode,
  ) {
    super(message);
  }
}

export type Qbit = {
  version(): Promise<string>;
  add(torrent: Buffer | { magnet: string }, opts: { savePath: string; category: string; paused: boolean }): Promise<void>;
  list(category: string): Promise<QbitTorrent[]>;
  files(hash: string): Promise<QbitFile[]>;
  setFilePriority(hash: string, indexes: number[], priority: 0 | 1 | 6 | 7): Promise<void>;
  start(hashes: string[]): Promise<void>;
  stop(hashes: string[]): Promise<void>;
  remove(hashes: string[]): Promise<void>;
  ensureCategory(name: string, savePath: string): Promise<void>;
};

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createQbit(cfg: QbitConfig, opts: { fetchImpl?: typeof fetch } = {}): Qbit {
  const base = cfg.url.trim().replace(/\/+$/, '');
  const doFetch = opts.fetchImpl ?? fetch;
  let sid: string | null = null;
  let modern: boolean | null = null; // WebAPI ≥ 2.11: start/stop вместо resume/pause

  async function raw(path: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await doFetch(`${base}${path}`, { ...init, headers: { Referer: base, ...(sid ? { Cookie: `SID=${sid}` } : {}), ...(init.headers as object) }, signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      throw new QbitError(`qBittorrent не отвечает: ${reason(e)}`, 'network');
    }
  }

  async function login() {
    sid = null;
    const res = await raw('/api/v2/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: cfg.username, password: cfg.password }).toString(),
    });
    if (res.status === 403) throw new QbitError('IP заблокирован qBittorrent после неудачных входов', 'banned');
    const text = (await res.text()).trim();
    const cookie = /SID=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
    if (text !== 'Ok.' || !cookie) throw new QbitError('Неверный логин или пароль qBittorrent', 'auth');
    sid = cookie;
  }

  /** Запрос с сессией: при 403 — один повторный вход. */
  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    if (!sid) await login();
    let res = await raw(path, init);
    if (res.status === 403) {
      await login();
      res = await raw(path, init);
      if (res.status === 403) throw new QbitError('qBittorrent не пускает: сессия не принята', 'auth');
    }
    return res;
  }

  const form = (data: Record<string, string>) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(data).toString(),
  });

  async function ok(path: string, init?: RequestInit, allow: number[] = []) {
    const res = await call(path, init);
    if (!res.ok && !allow.includes(res.status)) throw new QbitError(`qBittorrent ответил ошибкой ${res.status}`, 'http');
    return res;
  }

  async function isModern() {
    if (modern === null) {
      const v = (await (await ok('/api/v2/app/webapiVersion')).text()).trim();
      const [maj, min] = v.split('.').map(Number);
      modern = maj > 2 || (maj === 2 && min >= 11);
    }
    return modern;
  }

  return {
    async version() {
      return (await (await ok('/api/v2/app/version')).text()).trim();
    },
    async add(torrent, o) {
      const fd = new FormData();
      if (Buffer.isBuffer(torrent)) fd.append('torrents', new Blob([new Uint8Array(torrent)], { type: 'application/x-bittorrent' }), 'x.torrent');
      else fd.append('urls', torrent.magnet);
      fd.append('savepath', o.savePath);
      fd.append('category', o.category);
      fd.append('paused', String(o.paused));
      fd.append('stopped', String(o.paused));
      const res = await ok('/api/v2/torrents/add', { method: 'POST', body: fd });
      const text = (await res.text()).trim();
      if (text && text !== 'Ok.') throw new QbitError(`qBittorrent не принял торрент: ${text}`, 'http');
    },
    async list(category) {
      return (await (await ok(`/api/v2/torrents/info?${new URLSearchParams({ category })}`)).json()) as QbitTorrent[];
    },
    async files(hash) {
      const list = (await (await ok(`/api/v2/torrents/files?${new URLSearchParams({ hash })}`)).json()) as Partial<QbitFile>[];
      return list.map((f, i) => ({ index: f.index ?? i, name: f.name ?? '', size: f.size ?? 0, progress: f.progress ?? 0, priority: f.priority ?? 0 }));
    },
    async setFilePriority(hash, indexes, priority) {
      if (!indexes.length) return;
      await ok('/api/v2/torrents/filePrio', form({ hash, id: indexes.join('|'), priority: String(priority) }));
    },
    async start(hashes) {
      await ok(`/api/v2/torrents/${(await isModern()) ? 'start' : 'resume'}`, form({ hashes: hashes.join('|') }));
    },
    async stop(hashes) {
      await ok(`/api/v2/torrents/${(await isModern()) ? 'stop' : 'pause'}`, form({ hashes: hashes.join('|') }));
    },
    async remove(hashes) {
      await ok('/api/v2/torrents/delete', form({ hashes: hashes.join('|'), deleteFiles: 'false' }));
    },
    async ensureCategory(name, savePath) {
      await ok('/api/v2/torrents/createCategory', form({ category: name, savePath }), [409]);
    },
  };
}

export function getQbit(db: Db): Qbit | null {
  const cfg = tryGetSecretSetting<QbitConfig>(db, 'qbittorrent');
  return cfg?.url ? createQbit(cfg) : null;
}
