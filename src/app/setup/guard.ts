import 'server-only';
import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/auth/current';
import { getDb } from '@/lib/db/client';
import { getSetupState } from '@/lib/setup';

/** Шаги после аккаунта: только с сеансом и только пока мастер не завершён. */
export async function requireSetupSession() {
  const s = await requireSession();
  if (getSetupState(getDb()).step === 'done') redirect('/');
  return s;
}
