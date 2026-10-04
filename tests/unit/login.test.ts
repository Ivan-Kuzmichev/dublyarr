import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { createUser, setTotpSecret, enableTotp } from '@/lib/auth/users';
import { passwordStep, codeStep } from '@/lib/auth/login';
import { validateSession, createTrustedDevice } from '@/lib/auth/sessions';
import { totpAt, currentStep } from '@/lib/auth/totp';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const ctx = (over: Partial<{ trustToken: string | null }> = {}) => ({
  ip: '10.0.0.2',
  userAgent: 'UA',
  trustToken: null,
  now: 1_800_000_000_000,
  ...over,
});

async function setup(twoFa: boolean) {
  const db = testDb();
  const u = await createUser(db, 'admin', 'пароль-длинный');
  if (twoFa) {
    setTotpSecret(db, u.id, SECRET);
    enableTotp(db, u.id);
  }
  return { db, u };
}

test('без 2FA: сразу сеанс; remember → persistent', async () => {
  const { db } = await setup(false);
  const r = await passwordStep(db, { username: 'admin', password: 'пароль-длинный', remember: true }, ctx());
  expect(r.kind).toBe('session');
  if (r.kind === 'session') {
    expect(r.persistent).toBe(true);
    expect(validateSession(db, r.token, ctx().now)).not.toBeNull();
  }
});

test('неверный пароль и неизвестный логин — одно сообщение', async () => {
  const { db } = await setup(false);
  const a = await passwordStep(db, { username: 'admin', password: 'нет', remember: false }, ctx());
  const b = await passwordStep(db, { username: 'кто', password: 'нет', remember: false }, ctx());
  expect(a).toEqual({ kind: 'error', message: 'Неверный логин или пароль' });
  expect(b).toEqual(a);
});

test('блокировка после 10 неудач даже при верном пароле', async () => {
  const { db } = await setup(false);
  for (let i = 0; i < 10; i++) await passwordStep(db, { username: 'admin', password: 'нет', remember: false }, ctx());
  const r = await passwordStep(db, { username: 'admin', password: 'пароль-длинный', remember: false }, ctx());
  expect(r).toEqual({ kind: 'error', message: 'Слишком много попыток. Подождите 15 минут.' });
});

test('с 2FA: шаг кода, повтор кода отклоняется, доверенное устройство', async () => {
  const { db, u } = await setup(true);
  const c = ctx();
  const r1 = await passwordStep(db, { username: 'admin', password: 'пароль-длинный', remember: false }, c);
  expect(r1.kind).toBe('need-code');
  if (r1.kind !== 'need-code') return;
  expect(codeStep(db, { pendingToken: r1.pendingToken, code: '000000', trustDevice: false }, c)).toEqual({
    kind: 'error',
    message: 'Неверный код',
  });
  const code = totpAt(SECRET, currentStep(c.now));
  const ok = codeStep(db, { pendingToken: r1.pendingToken, code, trustDevice: true }, c);
  expect(ok.kind).toBe('session');
  if (ok.kind !== 'session') return;
  expect(ok.trust).toBeDefined();
  // ожидающий вход использован — второй раз нельзя
  expect(codeStep(db, { pendingToken: r1.pendingToken, code, trustDevice: false }, c).kind).toBe('error');
  // тот же код во втором входе отклоняется (повтор)
  const r2 = await passwordStep(db, { username: 'admin', password: 'пароль-длинный', remember: false }, c);
  if (r2.kind !== 'need-code') throw new Error('ожидался need-code');
  expect(codeStep(db, { pendingToken: r2.pendingToken, code, trustDevice: false }, c)).toEqual({ kind: 'error', message: 'Неверный код' });
  // доверенное устройство пропускает шаг кода
  const trust = createTrustedDevice(db, u.id, 'UA', c.now);
  const r3 = await passwordStep(db, { username: 'admin', password: 'пароль-длинный', remember: false }, ctx({ trustToken: trust.token }));
  expect(r3.kind).toBe('session');
});

test('параллельный перебор не проскакивает мимо лимита', async () => {
  const { db } = await setup(false);
  const results = await Promise.all(
    Array.from({ length: 25 }, () => passwordStep(db, { username: 'admin', password: 'нет', remember: false }, ctx())),
  );
  const tried = results.filter((r) => r.kind === 'error' && r.message === 'Неверный логин или пароль').length;
  expect(tried).toBe(10);
});

test('секрет 2FA зашифрован другим ключом — понятная ошибка, а не падение', async () => {
  const { db, u } = await setup(true);
  const { users } = await import('@/lib/db/schema');
  const { encrypt } = await import('@/lib/crypto/secretbox');
  const { eq } = await import('drizzle-orm');
  db.update(users).set({ totpSecretEnc: encrypt(SECRET, randomBytes(32)) }).where(eq(users.id, u.id)).run();
  const r1 = await passwordStep(db, { username: 'admin', password: 'пароль-длинный', remember: false }, ctx());
  if (r1.kind !== 'need-code') throw new Error('ожидался need-code');
  const r = codeStep(db, { pendingToken: r1.pendingToken, code: '123456', trustDevice: false }, ctx());
  expect(r).toEqual({ kind: 'error', message: 'Ключ шифрования не подходит к базе. Выключите 2FA: dublyarr reset-password --disable-2fa' });
});

test('выключенная учётка не входит; вход отмечает время', async () => {
  const { db, u } = await setup(false);
  const ok = await passwordStep(db, { username: 'admin', password: 'пароль-длинный', remember: false }, ctx());
  expect(ok.kind).toBe('session');
  expect(db.select().from(users).get()!.lastLoginAt).toBe(1_800_000_000_000);
  db.update(users).set({ disabled: true }).where(eq(users.id, u.id)).run();
  expect(await passwordStep(db, { username: 'admin', password: 'пароль-длинный', remember: false }, ctx())).toEqual({ kind: 'error', message: 'Учётка выключена' });
});
