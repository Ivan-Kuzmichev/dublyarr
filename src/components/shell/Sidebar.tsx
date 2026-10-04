'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '@/components/ui/Logo';
import { Icon } from '@/components/ui/Icon';
import { ServiceRow, type ServiceStatus } from '@/components/ui/StatusDot';
import { DESKTOP_NAV, activeNavId } from './nav';

export function Sidebar({ services, storage = true }: { services: ServiceStatus[]; storage?: boolean }) {
  const active = activeNavId(usePathname());
  return (
    <aside className="sticky top-0 flex h-dvh w-[232px] shrink-0 flex-col gap-7 border-r border-line-nav bg-sidebar px-3.5 py-[22px] box-border">
      <Link href="/" className="px-2 no-underline">
        <Logo />
      </Link>
      <nav aria-label="Основная навигация" className="flex flex-col gap-0.5">
        {DESKTOP_NAV.filter((item) => storage || item.id !== 'storage').map((item) => {
          const on = item.id === active;
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={on ? 'page' : undefined}
              className={`flex h-11 items-center gap-3 rounded-[10px] px-3 text-[15px] font-medium no-underline ${
                on ? 'bg-nav-active text-text hover:text-text' : 'text-text-3 hover:bg-surface hover:text-text'
              }`}
            >
              <Icon d={item.icon} className={on ? 'text-accent' : 'text-faint'} />
              <span className="grow">{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="grow" />
      {services.length > 0 && (
        <section aria-label="Сервисы" className="flex flex-col gap-2.5 px-2.5">
          <div className="text-xs font-semibold tracking-[0.08em] text-faint uppercase">Сервисы</div>
          {services.map((s) => (
            <ServiceRow key={s.name} s={s} className="text-[13px]" />
          ))}
        </section>
      )}
    </aside>
  );
}
