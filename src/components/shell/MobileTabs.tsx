'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { MOBILE_TABS } from './nav';

function activeTab(pathname: string) {
  const seg = pathname.split('/')[1] ?? '';
  if (seg === 'more' || seg === 'settings' || seg === 'storage' || seg === 'discover') return 'more';
  return MOBILE_TABS.find((t) => t.href !== '/' && t.href === `/${seg}`)?.id ?? 'today';
}

export function MobileTabs() {
  const active = activeTab(usePathname());
  return (
    <nav
      aria-label="Навигация"
      className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line-nav bg-sidebar px-2 pt-2 pb-[max(22px,env(safe-area-inset-bottom))]"
    >
      {MOBILE_TABS.map((t) => {
        const on = t.id === active;
        return (
          <Link
            key={t.id}
            href={t.href}
            aria-current={on ? 'page' : undefined}
            className={`flex min-h-11 flex-1 basis-0 flex-col items-center justify-center gap-1 text-[11px] font-medium no-underline ${
              on ? 'text-accent hover:text-accent' : 'text-faint hover:text-text-2'
            }`}
          >
            <Icon d={t.icon} size={22} strokeWidth={t.id === 'more' ? 3 : 1.8} />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
