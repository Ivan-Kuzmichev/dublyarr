'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import type { Studio } from '@/lib/db/schema';
import { deleteStudioAction, saveStudioAction, type StudioFormState } from './actions';

type Props = { studio?: Pick<Studio, 'id' | 'name' | 'aliases' | 'kind' | 'trackers'> };

function EditorBody({ studio, onClose }: Props & { onClose: () => void }) {
  const titleId = useId();
  const [state, action, pending] = useActionState<StudioFormState, FormData>(saveStudioAction, {});
  const [delState, delAction, deleting] = useActionState<StudioFormState, FormData>(deleteStudioAction, {});
  useEffect(() => {
    if (state.ok || delState.ok) onClose();
  }, [state, delState, onClose]);
  const v = state.values;
  const error = state.error ?? delState.error;
  return (
    <Modal open onClose={onClose} labelledBy={titleId} width={560}>
      <div className="flex flex-col gap-5 overflow-y-auto p-5 md:p-7">
        <h2 id={titleId} className="m-0 font-display text-[22px] font-semibold">
          {studio ? studio.name : 'Новая студия'}
        </h2>
        <form action={action} id="studio-form" className="flex flex-col gap-4">
          {studio && <input type="hidden" name="id" value={studio.id} />}
          <Field label="Название" name="name" defaultValue={v?.name ?? studio?.name ?? ''} required />
          <Field label="Варианты написания" name="aliases" defaultValue={v?.aliases ?? studio?.aliases.join(', ') ?? ''} hint="Через запятую: как студию пишут в названиях раздач" />
          <div className="flex flex-col gap-2">
            <span className="text-sm text-text-3">Тип</span>
            <Segmented
              name="kind"
              aria-label="Тип"
              defaultValue={(v?.kind as Studio['kind']) ?? studio?.kind ?? 'series'}
              options={[
                { value: 'series', label: 'Сериалы' },
                { value: 'anime', label: 'Аниме' },
                { value: 'both', label: 'Оба' },
              ]}
            />
          </div>
          <Field
            label="Свой трекер"
            name="trackers"
            mono
            defaultValue={v?.trackers ?? studio?.trackers.join(', ') ?? ''}
            hint="Имя трекера в Jackett: раздачи с него — всегда эта студия"
          />
        </form>
        {error && (
          <p role="alert" className="m-0 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {studio && (
            <form action={delAction}>
              <input type="hidden" name="id" value={studio.id} />
              <Button type="submit" variant="destructive" disabled={deleting}>
                Удалить
              </Button>
            </form>
          )}
          <span className="grow" />
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" form="studio-form" disabled={pending}>
            Сохранить
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function StudioEditor({ studio, children, className }: Props & { children: React.ReactNode; className?: string }) {
  const [session, setSession] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setSession((n) => n + 1)} className={className}>
        {children}
      </button>
      {session > 0 && <EditorBody key={session} studio={studio} onClose={() => setSession(0)} />}
    </>
  );
}
