'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { describeMovieProfile, type MovieProfile } from '@/lib/movie-profile';
import { MovieProfileEditor } from './MovieProfileEditor';
import type { DialogState } from './SubscribeDialog';

type Props = {
  onClose: () => void;
  mode: 'subscribe' | 'edit' | 'default';
  title: string;
  subtitle?: string;
  initial: MovieProfile;
  hidden: Record<string, string>;
  action: (prev: DialogState, form: FormData) => Promise<DialogState>;
};

/** Окно подписки на фильм (модалка на компьютере, шторка на телефоне). */
export function MovieSubscribeDialog({ onClose, mode, title, subtitle, initial, hidden, action }: Props) {
  const titleId = useId();
  const [profile, setProfile] = useState(initial);
  const [confirmUnsub, setConfirmUnsub] = useState(false);
  const [state, formAction, pending] = useActionState<DialogState, FormData>(action, {});
  useEffect(() => {
    if (state.ok) onClose();
  }, [state, onClose]);
  return (
    <Modal open onClose={onClose} labelledBy={titleId} width={720}>
      <form action={formAction} className="flex min-h-0 flex-col">
        {Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <input type="hidden" name="profile" value={JSON.stringify(profile)} />
        <header className="flex items-start gap-4 border-b border-line px-5 pt-5 pb-4 md:px-7 md:pt-6">
          <div className="flex min-w-0 grow flex-col gap-1">
            <h2 id={titleId} className="m-0 font-display text-[22px] font-semibold tracking-[-0.01em] md:text-[26px]">
              {title}
            </h2>
            {subtitle && <span className="text-[13px] text-muted">{subtitle}</span>}
          </div>
          <button type="button" aria-label="Закрыть" onClick={onClose} className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-[10px] text-muted hover:bg-surface-2 hover:text-text">
            <Icon d="M6 6l12 12M18 6L6 18" />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto px-5 py-5 md:px-7">
          <MovieProfileEditor value={profile} onChange={setProfile} />
        </div>
        <footer className="flex flex-col gap-3 border-t border-line px-5 py-4 md:px-7">
          <p className="m-0 text-[13px] leading-normal text-muted">{describeMovieProfile(profile).slice(0, 3).join('. ')}.</p>
          {state.error && (
            <p role="alert" className="m-0 text-sm text-danger">
              {state.error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {mode === 'edit' &&
              (confirmUnsub ? (
                <>
                  <Button type="submit" name="intent" value="unsubscribe" variant="destructive" disabled={pending}>
                    Точно отписаться
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setConfirmUnsub(false)}>
                    Нет
                  </Button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmUnsub(true)} className="h-11 cursor-pointer rounded-[11px] px-3 text-sm text-danger hover:bg-surface-2">
                  Отписаться
                </button>
              ))}
            <span className="hidden grow sm:block" />
            <Button type="button" variant="secondary" onClick={onClose} className="grow sm:grow-0">
              Отмена
            </Button>
            <Button type="submit" name="intent" value={mode === 'subscribe' ? 'subscribe' : 'save'} disabled={pending} className="grow sm:grow-0">
              {pending ? 'Сохраняю…' : mode === 'subscribe' ? 'Подписаться' : 'Сохранить'}
            </Button>
          </div>
        </footer>
      </form>
    </Modal>
  );
}
