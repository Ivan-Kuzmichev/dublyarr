'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';

const SEARCH = 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4';
const CLOSE = 'M6 6l12 12M18 6L6 18';

export function SearchBox({ initial }: { initial: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      const q = value.trim();
      router.replace(q ? `/discover?q=${encodeURIComponent(q)}` : '/discover', { scroll: false });
    }, 400);
    return () => clearTimeout(t);
  }, [value, router]);

  return (
    <div className="relative max-w-[640px]">
      <Icon d={SEARCH} className="pointer-events-none absolute top-[15px] left-4 text-faint" />
      <input
        type="search"
        aria-label="Поиск сериала"
        placeholder="Название сериала"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus={!initial}
        className="box-border h-[50px] w-full rounded-xl border border-field-line bg-surface pr-12 pl-12 text-base text-text outline-none placeholder:text-dim focus:border-accent [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          aria-label="Очистить"
          onClick={() => setValue('')}
          className="absolute top-1.5 right-1.5 flex h-[38px] w-[38px] cursor-pointer items-center justify-center text-faint hover:text-text-2"
        >
          <Icon d={CLOSE} size={18} />
        </button>
      )}
    </div>
  );
}
