import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/client';
import { hasAnyUser } from '@/lib/auth/users';
import { getCurrentSession } from '@/lib/auth/current';
import { getSetupState } from '@/lib/setup';
import { Steps, StepHeading } from './Steps';
import { AccountForm } from './AccountForm';

export default async function SetupAccountPage() {
  const db = getDb();
  if (hasAnyUser(db)) {
    if (!(await getCurrentSession())) redirect('/login');
    const { step } = getSetupState(db);
    redirect(step === 'done' ? '/' : `/setup/${step}`);
  }
  return (
    <>
      <Steps current="account" />
      <StepHeading title="Первый запуск">
        Создай аккаунт — Dublyarr рассчитан на одного пользователя. Двухфакторную защиту можно включить потом в настройках.
      </StepHeading>
      <AccountForm />
    </>
  );
}
