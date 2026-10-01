'use client';

import { useActionState, useCallback, useEffect, useId, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, PasswordField } from '@/components/ui/Field';
import { deleteSourceAction, saveSourceAction, type SourceFormState } from './source-actions';

type Source = { id: number; name: string; url: string; timeoutMs: number };

function Body({ source, onClose }: { source?: Source; onClose: () => void }) {
  const titleId = useId();
  const [state, action, pending] = useActionState<SourceFormState, FormData>(saveSourceAction, {});
  const [del, delAction, deleting] = useActionState<SourceFormState, FormData>(deleteSourceAction, {});
  useEffect(() => {
    if (state.ok || del.ok) onClose();
  }, [state, del, onClose]);
  const v = state.values;
  return (
    <Modal open onClose={onClose} labelledBy={titleId} width={560}>
      <div className="flex flex-col gap-5 overflow-y-auto p-5 md:p-7">
        <h2 id={titleId} className="m-0 font-display text-[22px] font-semibold">
          {source ? source.name : 'Новый источник'}
        </h2>
        <form action={action} id="source-form" className="flex flex-col gap-4">
          {source && <input type="hidden" name="id" value={source.id} />}
          <Field label="Название" name="name" defaultValue={v?.name ?? source?.name ?? 'Jackett'} />
          <Field
            label="Адрес Torznab"
            name="url"
            mono
            inputMode="url"
            required
            defaultValue={v?.url ?? source?.url ?? ''}
            placeholder="http://jackett:9117/api/v2.0/indexers/all/results/torznab/"
            hint="Jackett: http://<адрес>:9117/api/v2.0/indexers/all/results/torznab/"
          />
          <PasswordField label="API-ключ" name="apiKey" autoComplete="off" placeholder={source ? 'сохранён — оставьте пустым' : ''} hint="Хранится в базе зашифрованным" />
          <Field label="Таймаут, с" name="timeout" type="number" min={3} max={60} defaultValue={v?.timeout ?? String((source?.timeoutMs ?? 15000) / 1000)} />
        </form>
        {(state.error || del.error) && (
          <p role="alert" className="m-0 text-sm text-danger">
            {state.error ?? del.error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {source && (
            <form action={delAction}>
              <input type="hidden" name="id" value={source.id} />
              <Button type="submit" variant="destructive" disabled={deleting}>
                Удалить
              </Button>
            </form>
          )}
          <span className="grow" />
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" form="source-form" disabled={pending}>
            {pending ? 'Проверяю…' : 'Проверить и сохранить'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function SourceEditor({ source, className, children }: { source?: Source; className?: string; children: React.ReactNode }) {
  const [session, setSession] = useState(0);
  const close = useCallback(() => setSession(0), []);
  return (
    <>
      <button type="button" className={className} onClick={() => setSession((n) => n + 1)} aria-label={source ? `Настроить источник ${source.name}` : undefined}>
        {children}
      </button>
      {session > 0 && <Body key={session} source={source} onClose={close} />}
    </>
  );
}
