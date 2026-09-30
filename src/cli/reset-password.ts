import type { Db } from '../lib/db/client';
import { users } from '../lib/db/schema';
import { validateNewPassword } from '../lib/auth/password';
import { setPassword, setTotpSecret } from '../lib/auth/users';
import { revokeAllSessions, revokeTrustedDevices } from '../lib/auth/sessions';

export async function resetPassword(db: Db, o: { password: string; disable2fa: boolean }) {
  const u = db.select().from(users).get();
  if (!u) throw new Error('Пользователь ещё не создан — откройте Dublyarr в браузере');
  const err = validateNewPassword(o.password);
  if (err) throw new Error(err);
  await setPassword(db, u.id, o.password);
  revokeAllSessions(db, u.id);
  revokeTrustedDevices(db, u.id);
  if (o.disable2fa) setTotpSecret(db, u.id, null);
  return { username: u.username };
}
