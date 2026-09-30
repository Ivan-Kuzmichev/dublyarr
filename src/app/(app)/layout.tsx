import { requireSession } from '@/lib/auth/current';
import { AppShell } from '@/components/shell/AppShell';
import { getDb } from '@/lib/db/client';
import { serviceStatuses } from '@/lib/heartbeat';
import { getSetupState } from '@/lib/setup';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  const { step } = getSetupState(getDb());
  if (step !== 'done') redirect(`/setup/${step === 'account' ? '' : step}`);
  return <AppShell services={serviceStatuses(getDb())}>{children}</AppShell>;
}
