import { requireSession } from '@/lib/auth/current';
import { AppShell } from '@/components/shell/AppShell';
import { getDb } from '@/lib/db/client';
import { serviceStatuses } from '@/lib/heartbeat';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  return <AppShell services={serviceStatuses(getDb())}>{children}</AppShell>;
}
