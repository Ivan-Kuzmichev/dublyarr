'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { formatSize } from '@/lib/format';
import { confirmRetentionAction, type ActionState } from './actions';

type Item = { key: string; label: string; why: string; size: number };
const RULE = { seasons: 'сезонов', oldCopy: 'старых копий', age: '«через N дней»' } as const;

/** Первое срабатывание правила: список с галочками, «Освободится», удаление только после подтверждения. */
export function FirstCleanup({ items, rule }: { items: Item[]; rule: keyof typeof RULE }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(confirmRetentionAction, {});
  const [checked, setChecked] = useState(() => new Set(items.map((i) => i.key)));
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const freed = items.filter((i) => checked.has(i.key)).reduce((n, i) => n + i.size, 0);
  return (
    <section className="flex flex-col gap-4 rounded-[18px] border border-danger-line bg-danger-bg p-5">
      <h2 className="m-0 text-lg font-semibold">Первая уборка по правилу {RULE[rule]}</h2>
      <span className="text-[13px] text-text-2">Правило только что включено. Перед первым запуском проверьте, что уйдёт.</span>
      <form action={action} className="flex flex-col gap-3">
        {items.map((i) => (
          <label key={i.key} className="flex min-h-11 cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              name="key"
              value={i.key}
              checked={checked.has(i.key)}
              onChange={() =>
                setChecked((s) => {
                  const n = new Set(s);
                  if (n.has(i.key)) n.delete(i.key);
                  else n.add(i.key);
                  return n;
                })
              }
              className="mt-0.5 h-[18px] w-[18px] accent-accent"
            />
            <span className="flex min-w-0 grow flex-col gap-0.5">
              <span className="text-sm font-medium">{i.label}</span>
              <span className="text-xs text-faint">{i.why}</span>
            </span>
            <span className="font-mono text-[13px] whitespace-nowrap text-muted">{formatSize(i.size)}</span>
          </label>
        ))}
        <div className="flex justify-between border-t border-danger-line pt-3 text-sm">
          <span>Освободится</span>
          <span className="font-semibold text-accent">{formatSize(freed)}</span>
        </div>
        {state.error && (
          <p role="alert" className="m-0 text-sm text-danger">
            {state.error}
          </p>
        )}
        {state.ok && <p className="m-0 text-sm text-progress">{state.ok}</p>}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" variant="destructive" disabled={pending || checked.size === 0}>
            Удалить отмеченное
          </Button>
          <Button type="button" variant="secondary" onClick={() => setHidden(true)}>
            Позже
          </Button>
        </div>
      </form>
    </section>
  );
}
