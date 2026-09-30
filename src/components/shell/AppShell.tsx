import type { ServiceStatus } from '@/components/ui/StatusDot';
import { Sidebar } from './Sidebar';
import { MobileTabs } from './MobileTabs';

/** ≥ 1024 px — боковая навигация; уже — нижние вкладки, как в Mobile*.dc.html. */
export function AppShell({ services, children }: { services: ServiceStatus[]; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <div className="hidden lg:block">
        <Sidebar services={services} />
      </div>
      <main className="box-border min-w-0 grow px-4 pt-6 pb-28 sm:px-5 lg:p-10">{children}</main>
      <div className="lg:hidden">
        <MobileTabs />
      </div>
    </div>
  );
}
