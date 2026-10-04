import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { createUser } from '@/lib/auth/users';
import {
  createSession,
  validateSession,
  revokeAllSessions,
  listSessions,
  revokeSession,
  createPendingLogin,
  getPendingLogin,
  deletePendingLogin,
  createTrustedDevice,
  isTrustedDevice,
  revokeTrustedDevices,
  getPendingUsername,
  SESSION_TTL_SHORT,
  SESSION_TTL_PERSISTENT,
  PENDING_TTL,
  TRUST_TTL,
} from '@/lib/auth/sessions';
import { sessions, users } from '@/lib/db/schema';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const T0 = 1_800_000_000_000;

test('сеанс: создаётся, в БД только хэш, скользящее продление, истечение', async () => {
  const db = testDb();
  const u = await createUser(db, 'admin', 'пароль-длинный');
  const { token, expiresAt } = createSession(db, { userId: u.id, persistent: false, userAgent: 'UA', ip: '1.1.1.1' }, T0);
  expect(expiresAt).toBe(T0 + SESSION_TTL_SHORT);
  expect(db.select().from(sessions).all()[0].id).not.toBe(token);
  const later = T0 + SESSION_TTL_SHORT - 1000;
  expect(validateSession(db, token, later)?.user.username).toBe('admin');
  expect(validateSession(db, token, later + SESSION_TTL_SHORT - 1000)).not.toBeNull(); // продлился
  expect(validateSession(db, token, later + 3 * SESSION_TTL_SHORT)).toBeNull();
  expect(validateSession(db, 'неизвестный', T0)).toBeNull();
});

test('запомнить устройство — 30 дней; выйти везде кроме текущего', async () => {
  const db = testDb();
  const u = await createUser(db, 'admin', 'пароль-длинный');
  const a = createSession(db, { userId: u.id, persistent: true, userAgent: null, ip: null }, T0);
  const b = createSession(db, { userId: u.id, persistent: false, userAgent: null, ip: null }, T0);
  expect(a.expiresAt).toBe(T0 + SESSION_TTL_PERSISTENT);
  const cur = validateSession(db, a.token, T0)!;
  revokeAllSessions(db, u.id, cur.session.id);
  expect(validateSession(db, b.token, T0)).toBeNull();
  expect(listSessions(db, u.id, T0)).toHaveLength(1);
  revokeSession(db, a.token);
  expect(validateSession(db, a.token, T0)).toBeNull();
});

test('ожидающий вход живёт 5 минут', async () => {
  const db = testDb();
  const u = await createUser(db, 'admin', 'пароль-длинный');
  const p = createPendingLogin(db, u.id, true, T0);
  expect(getPendingLogin(db, p, T0 + PENDING_TTL - 1)).toEqual({ userId: u.id, remember: true });
  expect(getPendingLogin(db, p, T0 + PENDING_TTL + 1)).toBeNull();
  const p2 = createPendingLogin(db, u.id, false, T0);
  deletePendingLogin(db, p2);
  expect(getPendingLogin(db, p2, T0)).toBeNull();
});

test('доверенное устройство 30 дней, отзывается', async () => {
  const db = testDb();
  const u = await createUser(db, 'admin', 'пароль-длинный');
  const d = createTrustedDevice(db, u.id, 'UA', T0);
  expect(isTrustedDevice(db, d.token, u.id, T0 + TRUST_TTL - 1)).toBe(true);
  expect(isTrustedDevice(db, d.token, u.id, T0 + TRUST_TTL + 1)).toBe(false);
  expect(isTrustedDevice(db, d.token, u.id + 1, T0)).toBe(false);
  revokeTrustedDevices(db, u.id);
  expect(isTrustedDevice(db, d.token, u.id, T0)).toBe(false);
});

test('имя пользователя по ожидающему входу', async () => {
  const db = testDb();
  const u = await createUser(db, 'admin', 'пароль-длинный');
  const p = createPendingLogin(db, u.id, false, T0);
  expect(getPendingUsername(db, p, T0)).toBe('admin');
  expect(getPendingUsername(db, 'x', T0)).toBeNull();
});

test('выключенная учётка — сеанс недействителен и удаляется', async () => {
  const db = testDb();
  const u = await createUser(db, 'admin', 'пароль-длинный');
  const s = createSession(db, { userId: u.id, persistent: false, userAgent: null, ip: null }, T0);
  db.update(users).set({ disabled: true }).run();
  expect(validateSession(db, s.token, T0 + 1)).toBeNull();
  expect(db.select().from(sessions).all()).toEqual([]);
});
