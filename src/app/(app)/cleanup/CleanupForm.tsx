'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Button, buttonClass } from '@/components/ui/Button';
import { formatSize } from '@/lib/format';
import { confirmCleanupAction, type ConfirmState } from './actions';

type Row = { key: string; title: string; detail: string; size: number };

export function CleanupForm({ rows }: { rows: Row[] }) {
  const [state, action, pending] = useActionState<ConfirmState, FormData>(confirmCleanupAction, {});
  const [checked, setChecked] = useState(() => new Set(rows.map((r) => r.key)));
  const freed = rows.filter((r) => checked.has(r.key)).reduce((n, r) => n + r.size, 0);
  const toggle = (k: string) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  return (
    <form action={action} className="flex flex-col gap-5">
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        {rows.map((r) => (
          <label key={r.key} className="flex min-h-14 cursor-pointer items-center gap-3.5 border-t border-line-soft px-4 py-3 first:border-t-0">
            <input type="checkbox" name="key" value={r.key} checked={checked.has(r.key)} onChange={() => toggle(r.key)} className="h-5 w-5 accent-[var(--color-accent)]" />
            <span className="flex min-w-0 grow flex-col gap-0.5">
              <span className="truncate text-[15px] font-medium">{r.title}</span>
              <span className="truncate text-[13px] text-faint">{r.detail}</span>
            </span>
            <span className="font-mono text-[13px] whitespace-nowrap text-muted">{formatSize(r.size)}</span>
          </label>
        ))}
      </div>
      <p className="m-0 text-[15px]">
        Освободится <span className="font-semibold text-accent">{formatSize(freed)}</span>
      </p>
      <p className="m-0 text-[13px] leading-normal text-faint">
        Торренты уберутся из qBittorrent, их файлы — из папки загрузок. Серии в медиатеке остаются. После подтверждения уборка будет идти сама раз в час.
      </p>
      {state.error && (
        <p role="alert" className="m-0 text-sm text-danger">
          {state.error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="destructive" disabled={pending || checked.size === 0}>
          Удалить отмеченные
        </Button>
        <Link href="/" className={buttonClass('secondary', 'md', 'no-underline hover:text-text')}>
          Не сейчас
        </Link>
      </div>
    </form>
  );
}
