import Link from 'next/link';
import { PageTitle } from '@/components/shell/PageTitle';
import { Icon, ICONS } from '@/components/ui/Icon';
import { SettingsNav } from './SettingsNav';
import { requireSession } from '@/lib/auth/current';
import { isAdmin } from '@/lib/auth/permissions';

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireSession();
  return (
    <div className="flex flex-col gap-7">
      <div className="hidden lg:block">
        <PageTitle>Настройки</PageTitle>
      </div>
      <Link href="/more" className="flex min-h-11 items-center gap-1 self-start text-sm text-muted no-underline lg:hidden">
        <Icon d={ICONS.back} size={16} strokeWidth={2} />
        Ещё
      </Link>
      <div className="flex items-start gap-8">
        <div className="hidden lg:block">
          <SettingsNav admin={isAdmin(user)} />
        </div>
        <div className="flex min-w-0 grow flex-col gap-5">{children}</div>
      </div>
    </div>
  );
}
