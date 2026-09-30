import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { createUser, getUser } from '@/lib/auth/users';
import { startTotpSetup, confirmTotpSetup, disableTotp } from '@/lib/auth/twofa';
import { createTrustedDevice, isTrustedDevice } from '@/lib/auth/sessions';
import { totpAt, currentStep } from '@/lib/auth/totp';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const now = 1_800_000_000_000;

test('включение 2FA только после верного кода; выключение отзывает доверенные устройства', async () => {
  const db = testDb();
  const u = await createUser(db, 'admin', 'пароль-длинный');
  const { secret, uri } = startTotpSetup(db, u.id);
  expect(uri).toContain(secret);
  expect(getUser(db, u.id)!.totpEnabled).toBe(false);
  expect(confirmTotpSetup(db, u.id, '000000', now)).toBe(false);
  expect(confirmTotpSetup(db, u.id, totpAt(secret, currentStep(now)), now)).toBe(true);
  expect(getUser(db, u.id)!.totpEnabled).toBe(true);
  const d = createTrustedDevice(db, u.id, null, now);
  disableTotp(db, u.id);
  expect(getUser(db, u.id)!.totpEnabled).toBe(false);
  expect(isTrustedDevice(db, d.token, u.id, now)).toBe(false);
});
