import type { Db } from '../db/client';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp';
import { setTotpSecret, enableTotp, getUser, getTotpSecret, markTotpStep } from './users';
import { revokeTrustedDevices } from './sessions';

/** Новый секрет сохраняется неактивным: 2FA включится только после верного кода. */
export function startTotpSetup(db: Db, userId: number) {
  const secret = generateTotpSecret();
  setTotpSecret(db, userId, secret);
  return { secret, uri: otpauthUri(secret, getUser(db, userId)!.username) };
}

export function confirmTotpSetup(db: Db, userId: number, code: string, now = Date.now()): boolean {
  const u = getUser(db, userId);
  const secret = u && getTotpSecret(u);
  if (!secret) return false;
  const v = verifyTotp(secret, code, now, null);
  if (!v.ok) return false;
  enableTotp(db, userId);
  markTotpStep(db, userId, v.step);
  return true;
}

export function disableTotp(db: Db, userId: number) {
  setTotpSecret(db, userId, null);
  revokeTrustedDevices(db, userId);
}
