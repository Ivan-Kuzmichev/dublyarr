'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SETTINGS_SECTIONS } from '@/components/shell/nav';

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Разделы настроек" className="flex w-[220px] shrink-0 flex-col gap-0.5">
      {SETTINGS_SECTIONS.map((s) => {
        const href = `/settings/${s.id}`;
        const on = pathname === href;
        return (
          <Link
            key={s.id}
            href={href}
            aria-current={on ? 'page' : undefined}
            className={`flex h-11 items-center rounded-[10px] px-3.5 text-[15px] font-medium no-underline ${
              on ? 'bg-nav-active text-text hover:text-text' : 'text-text-3 hover:bg-surface hover:text-text'
            }`}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
