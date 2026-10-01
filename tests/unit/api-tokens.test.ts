import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { checkApiAccess, createApiToken, listApiTokens, revokeApiToken, setApiEnabled } from '@/lib/api/tokens';
import { apiTokens } from '@/lib/db/schema';

const h = (token: string | null, xff = '192.168.1.5') => ({ authorization: token ? `Bearer ${token}` : null, forwardedFor: xff, realIp: null, forwarded: null });

test('выключен → 403, не трогает lastUsedAt', () => {
  const db = testDb();
  const { token } = createApiToken(db, 'claude', 1);
  expect(checkApiAccess(db, h(token), 5)).toEqual({ status: 403, error: 'API выключен' });
  expect(listApiTokens(db)[0].lastUsedAt).toBeNull();
});

test('включён: из сети с токеном — да; извне — 403; без токена/чужой — 401', () => {
  const db = testDb();
  setApiEnabled(db, true);
  const { token } = createApiToken(db, 'claude', 1);
  expect(token).toMatch(/^dy_[A-Za-z0-9_-]{43}$/);
  expect(checkApiAccess(db, h(token), 5)).toEqual({ ok: true, tokenName: 'claude' });
  expect(listApiTokens(db)[0]).toMatchObject({ name: 'claude', prefix: token.slice(0, 8), lastUsedAt: 5, lastIp: '192.168.1.5' });
  expect(checkApiAccess(db, h(token, '203.0.113.7, 172.18.0.3'))).toEqual({ status: 403, error: 'Только из локальной сети' });
  expect(checkApiAccess(db, h(null))).toEqual({ status: 401, error: 'Нужен токен API' });
  expect(checkApiAccess(db, h('dy_wrong'))).toEqual({ status: 401, error: 'Нужен токен API' });
});

test('в базе — только хэш; отозванный не работает', () => {
  const db = testDb();
  setApiEnabled(db, true);
  const { id, token } = createApiToken(db, 'x');
  expect(JSON.stringify(db.select().from(apiTokens).all())).not.toContain(token);
  revokeApiToken(db, id);
  expect(checkApiAccess(db, h(token))).toEqual({ status: 401, error: 'Нужен токен API' });
});
