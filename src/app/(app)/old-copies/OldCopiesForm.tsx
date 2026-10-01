'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Button, buttonClass } from '@/components/ui/Button';
import { formatSize } from '@/lib/format';
import { confirmAction, type ConfirmState } from './actions';

type Row = { id: number; title: string; code: string; reason: string; size: number };

export function OldCopiesForm({ rows }: { rows: Row[] }) {
  const [state, action, pending] = useActionState<ConfirmState, FormData>(confirmAction, {});
  const [checked, setChecked] = useState(() => new Set(rows.map((r) => r.id)));
  const freed = rows.filter((r) => checked.has(r.id)).reduce((n, r) => n + r.size, 0);
  const toggle = (id: number) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <form action={action} className="flex flex-col gap-5">
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        {rows.map((r) => (
          <label key={r.id} className="flex min-h-14 cursor-pointer items-center gap-3.5 border-t border-line-soft px-4 py-3 first:border-t-0">
            <input type="checkbox" name="id" value={r.id} checked={checked.has(r.id)} onChange={() => toggle(r.id)} className="h-5 w-5 accent-[var(--color-accent)]" />
            <span className="flex min-w-0 grow flex-col gap-0.5">
              <span className="truncate text-[15px] font-medium">
                {r.title} <span className="font-mono text-[13px] font-normal text-muted">{r.code}</span>
              </span>
              <span className="text-[13px] text-faint">{r.reason}</span>
            </span>
            <span className="font-mono text-[13px] whitespace-nowrap text-muted">{formatSize(r.size)}</span>
          </label>
        ))}
      </div>
      <p className="m-0 text-[15px]">
        Освободится <span className="font-semibold text-accent">{formatSize(freed)}</span>
      </p>
      <p className="m-0 text-[13px] leading-normal text-faint">
        После подтверждения правило заработает само: старая копия будет удаляться сразу, как только новая окажется в медиатеке. Неотмеченные копии останутся в скрытой папке.
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
          Оставить все
        </Link>
      </div>
    </form>
  );
}
