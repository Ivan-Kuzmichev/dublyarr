import Link from 'next/link';
import { PageTitle } from '@/components/shell/PageTitle';
import { Icon, ICONS } from '@/components/ui/Icon';
import { ServiceRow } from '@/components/ui/StatusDot';
import { SETTINGS_SECTIONS } from '@/components/shell/nav';
import { getDb } from '@/lib/db/client';
import { serviceStatuses } from '@/lib/heartbeat';

export const metadata = { title: 'Ещё · Dublyarr' };

const sectionLabel = 'px-1 text-xs font-semibold tracking-[0.08em] text-faint uppercase';

function Row({ href, children, icon, first }: { href: string; children: React.ReactNode; icon?: string; first?: boolean }) {
  return (
    <Link
      href={href}
      className={`flex h-[52px] items-center gap-3 px-4 text-[15px] text-text no-underline hover:bg-surface-2 hover:text-text ${first ? '' : 'border-t border-line-soft'}`}
    >
      {icon && <Icon d={icon} className="text-accent" />}
      <span className="grow">{children}</span>
      <Icon d={ICONS.chevron} size={16} strokeWidth={2} className="text-dim" />
    </Link>
  );
}

/** Мобильное меню «Ещё» (MobileMore.dc.html). На десктопе те же пункты есть в боковой навигации. */
export default function MorePage() {
  const services = serviceStatuses(getDb());
  return (
    <div className="flex flex-col gap-[18px]">
      <PageTitle>Ещё</PageTitle>
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <Row href="/storage" icon={DESKTOP_ICONS.storage} first>
          Хранилище
        </Row>
        <Row href="/discover" icon={DESKTOP_ICONS.discover}>
          Поиск и тренды
        </Row>
      </div>
      <span className={sectionLabel}>Настройки</span>
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        {SETTINGS_SECTIONS.map((s, i) => (
          <Row key={s.id} href={`/settings/${s.id}`} first={i === 0}>
            {s.label}
          </Row>
        ))}
      </div>
      {services.length > 0 && (
        <>
          <span className={sectionLabel}>Сервисы</span>
          <div className="flex flex-col rounded-2xl border border-line bg-surface px-4 py-1.5">
            {services.map((s) => (
              <ServiceRow key={s.name} s={s} className="h-10 text-sm" />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const DESKTOP_ICONS = {
  storage: 'M4 5h16v6H4zM4 13h16v6H4zM8 8h.01M8 16h.01',
  discover: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
};
