import { requireSession } from '@/lib/auth/current';
import { AppShell } from '@/components/shell/AppShell';
import { getDb } from '@/lib/db/client';
import { serviceStatuses } from '@/lib/heartbeat';
import { getSetupState } from '@/lib/setup';
import { redirect } from 'next/navigation';
import { can } from '@/lib/auth/permissions';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireSession();
  const { step } = getSetupState(getDb());
  if (step !== 'done') redirect(`/setup/${step === 'account' ? '' : step}`);
  return (
    <AppShell services={serviceStatuses(getDb())} storage={can(user, 'storage')}>
      {children}
    </AppShell>
  );
}
