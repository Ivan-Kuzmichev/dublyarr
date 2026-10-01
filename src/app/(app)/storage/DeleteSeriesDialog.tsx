'use client';

import { useActionState, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { deleteSeriesAction, type ActionState } from './actions';

const MODES = [
  { id: 'all', title: 'Удалить файлы и отписаться', sub: 'Пропадёт из библиотеки, дальше ничего не качается', label: 'Удалить всё' },
  { id: 'files', title: 'Только файлы, подписка остаётся', sub: 'Освободит место; удалённое заново не скачается, новые серии — да', label: 'Удалить файлы' },
  { id: 'sub', title: 'Только отписаться, файлы оставить', sub: 'Скачанное останется на диске, дальше ничего не качается', label: 'Отписаться' },
] as const;

/** Удаление сериала: три варианта; торренты сериала убираются вместе с файлами в папке загрузок. */
export function DeleteSeriesDialog({ tmdbId, title, trigger = 'icon', movie = false }: { tmdbId: number; title: string; trigger?: 'icon' | 'button'; movie?: boolean }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<(typeof MODES)[number]['id']>('all');
  const [state, action, pending] = useActionState<ActionState, FormData>(deleteSeriesAction, {});
  const id = `del-${movie ? 'm' : 's'}${tmdbId}`;
  return (
    <>
      {trigger === 'icon' ? (
        <button type="button" aria-label={`Удалить «${title}»`} onClick={() => setOpen(true)} className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-faint hover:bg-surface-2 hover:text-danger">
          <Icon d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" size={18} />
        </button>
      ) : (
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          Удалить…
        </Button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} labelledBy={id} width={520}>
        <form action={action} className="flex flex-col gap-5 p-6">
          <input type="hidden" name="tmdbId" value={tmdbId} />
          <input type="hidden" name="mode" value={mode} />
          <input type="hidden" name="type" value={movie ? 'movie' : 'tv'} />
          <h2 id={id} className="m-0 text-xl font-semibold">
            Удалить «{title}»?
          </h2>
          <div role="radiogroup" aria-label="Что удалить" className="flex flex-col gap-2.5">
            {MODES.map((m) => (
              <label key={m.id} className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${mode === m.id ? 'border-destructive bg-surface-2' : 'border-line'}`}>
                <input type="radio" name="pick" checked={mode === m.id} onChange={() => setMode(m.id)} className="mt-0.5 h-[18px] w-[18px] accent-[var(--color-destructive)]" />
                <span className="flex flex-col gap-1">
                  <span className="text-[15px] font-medium">{m.title}</span>
                  <span className="text-[13px] text-faint">{m.sub}</span>
                </span>
              </label>
            ))}
          </div>
          {mode !== 'sub' && <p className="m-0 text-[13px] text-faint">Торренты сериала уберутся из qBittorrent вместе с их файлами в папке загрузок.</p>}
          {state.error && (
            <p role="alert" className="m-0 text-sm text-danger">
              {state.error}
            </p>
          )}
          {state.ok && <p className="m-0 text-sm text-progress">{state.ok}</p>}
          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {state.ok ? 'Закрыть' : 'Отмена'}
            </Button>
            {!state.ok && (
              <Button type="submit" variant="destructive" disabled={pending}>
                {MODES.find((m) => m.id === mode)!.label}
              </Button>
            )}
          </div>
        </form>
      </Modal>
    </>
  );
}
