'use client';

import { useActionState } from 'react';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { foldersAction, type StepState } from '../actions';
import { StepResult } from '../StepResult';

export function FoldersForm({ downloads, media }: { downloads: string; media: string }) {
  const [state, action, pending] = useActionState<StepState, FormData>(foldersAction, {});
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-[22px]">
      <Field label="Загрузки (куда качает qBittorrent)" name="downloads" defaultValue={state.values?.downloads ?? downloads} mono required error={fe.downloads} />
      <Field label="Медиатека (где смотрит VidHub)" name="media" defaultValue={state.values?.media ?? media} mono required error={fe.media} />
      <StepResult state={state} />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Проверяем…' : 'Готово'}
      </Button>
    </form>
  );
}
