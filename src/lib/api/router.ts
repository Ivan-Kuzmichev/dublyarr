import type { Db } from '../db/client';
import { logger } from '../log';
import { checkApiAccess } from './tokens';
import { ApiError, type ApiDeps, type ApiRequest, type ApiResponse, type Route } from './types';
import { READ_ROUTES } from './read';
import { WRITE_ROUTES } from './write';

export { ApiError, type ApiDeps, type ApiRequest, type ApiResponse } from './types';

// API /api/v1: проверка доступа, маршруты (чтение — read.ts, изменение — write.ts), журнал запросов.

const log = logger('api');
const routes: Route[] = [...READ_ROUTES, ...WRITE_ROUTES];

function match(pattern: string, path: string[]): Record<string, string> | null {
  const parts = pattern.split('/');
  if (parts.length !== path.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith(':')) params[parts[i].slice(1)] = path[i];
    else if (parts[i] !== path[i]) return null;
  }
  return params;
}

export async function handleApi(db: Db, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const started = Date.now();
  const access = checkApiAccess(db, req.headers, deps.now);
  const done = (r: ApiResponse, token?: string): ApiResponse => {
    log.info({ method: req.method, path: `/${req.path.join('/')}`, tokenName: token, status: r.status, ms: Date.now() - started }, 'api');
    return r;
  };
  if (!('ok' in access)) return done({ status: access.status, body: { error: access.error } });
  const hits = routes.map((r) => ({ r, params: match(r.pattern, req.path) })).filter((x) => x.params);
  if (!hits.length) return done({ status: 404, body: { error: 'Нет такого адреса' } }, access.tokenName);
  const hit = hits.find((x) => x.r.method === req.method);
  if (!hit) return done({ status: 405, body: { error: 'Метод не поддерживается' } }, access.tokenName);
  try {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : {};
    const out = await hit.r.run({ db, deps, params: hit.params!, query: req.query, body });
    return done({ status: 200, body: out ?? { ok: true } }, access.tokenName);
  } catch (e) {
    if (e instanceof ApiError) return done({ status: e.status, body: { error: e.message } }, access.tokenName);
    const msg = e instanceof Error ? e.message : String(e);
    log.warn({ path: `/${req.path.join('/')}`, err: msg }, 'api failed');
    return done({ status: 500, body: { error: msg } }, access.tokenName);
  }
}
