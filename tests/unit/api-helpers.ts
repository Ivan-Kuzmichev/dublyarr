import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { fakeQbit } from './fake-qbit';
import { handleApi } from '@/lib/api/router';
import { createApiToken, setApiEnabled } from '@/lib/api/tokens';

process.env.DUBLYARR_SECRET_KEY ??= randomBytes(32).toString('base64');

/** API поверх тестовой базы: включён, токен создан, запросы — «из локальной сети». */
export function api(o: { fetchImpl?: typeof fetch } = {}) {
  const db = testDb();
  setApiEnabled(db, true);
  const { token } = createApiToken(db, 'claude');
  const fq = fakeQbit();
  const deps = { qbit: fq.qbit, logDir: '/nonexistent', today: '2026-10-01', now: 1, version: '2.1.0', fetchImpl: o.fetchImpl };
  const call = (method: string, p: string, body?: unknown) => {
    const u = new URL(`http://x/api/v1/${p}`);
    return handleApi(
      db,
      { method, path: u.pathname.split('/').slice(3).filter(Boolean).map(decodeURIComponent), query: u.searchParams, body, headers: { authorization: `Bearer ${token}`, forwardedFor: '127.0.0.1', realIp: null, forwarded: null } },
      deps,
    );
  };
  return { db, fq, call, token };
}
