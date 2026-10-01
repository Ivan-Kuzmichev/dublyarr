'use client';

import { useActionState, useCallback, useEffect, useId, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { assignStudioAction, type AssignState } from './actions';

type Props = { tmdbId: number; label: string; studios: { id: number; name: string }[] };

function Body({ tmdbId, label, studios, onClose }: Props & { onClose: () => void }) {
  const titleId = useId();
  const [state, action, pending] = useActionState<AssignState, FormData>(assignStudioAction, {});
  const [choice, setChoice] = useState('');
  const [filter, setFilter] = useState('');
  useEffect(() => {
    if (state.ok) onClose();
  }, [state, onClose]);
  const q = filter.trim().toLowerCase();
  return (
    <Modal open onClose={onClose} labelledBy={titleId} width={560}>
      <form action={action} className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5 md:p-7">
        <input type="hidden" name="tmdbId" value={tmdbId} />
        <input type="hidden" name="label" value={label} />
        <h2 id={titleId} className="m-0 font-display text-[22px] font-semibold">
          Чья это озвучка?
        </h2>
        <p className="m-0 text-sm text-muted">
          В заголовке написано <span className="font-mono text-text">{label}</span>. Выберите студию — это написание запомнится в словаре.
        </p>
        <input
          type="search"
          aria-label="Найти студию"
          placeholder="Найти студию"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-11 rounded-[10px] border border-field-line bg-bg px-3 text-sm text-text outline-none placeholder:text-dim focus:border-accent"
        />
        <div role="radiogroup" aria-label="Студия" className="flex max-h-[280px] flex-col gap-1 overflow-y-auto">
          {[{ id: 'new', name: `Новая студия «${label}»` }, ...studios.filter((s) => !q || s.name.toLowerCase().includes(q))].map((s) => (
            <label key={s.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] px-2 text-sm text-text-2 hover:bg-surface-2">
              <input type="radio" name="studio" value={s.id} checked={choice === String(s.id)} onChange={() => setChoice(String(s.id))} className="h-[18px] w-[18px] accent-accent" />
              {s.name}
            </label>
          ))}
        </div>
        {state.error && (
          <p role="alert" className="m-0 text-sm text-danger">
            {state.error}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" disabled={pending || !choice}>
            Назначить
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function AssignStudio(props: Props) {
  const [open, setOpen] = useState(0);
  const close = useCallback(() => setOpen(0), []);
  return (
    <>
      <button type="button" onClick={() => setOpen((n) => n + 1)} className="h-11 cursor-pointer rounded-[10px] bg-accent px-3 text-[13px] font-semibold whitespace-nowrap text-on-accent">
        Назначить студию
      </button>
      {open > 0 && <Body key={open} {...props} onClose={close} />}
    </>
  );
}
