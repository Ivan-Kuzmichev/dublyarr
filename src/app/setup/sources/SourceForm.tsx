'use client';

import { useActionState } from 'react';
import { SourceFields } from '@/components/sources/SourceFields';
import type { SourceKind } from '@/lib/source-kinds';
import { Button } from '@/components/ui/Button';
import { addSourceAction, type StepState } from '../actions';
import { StepResult } from '../StepResult';

export function SourceForm({ hasSources }: { hasSources: boolean }) {
  const [state, action, pending] = useActionState<StepState, FormData>(addSourceAction, {});
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-[22px]">
      <SourceFields kind={state.values?.kind as SourceKind | undefined} name={state.values?.name} url={state.values?.url} urlError={fe.url} />
      <StepResult state={state} />
      <Button type="submit" name="intent" value="add" variant={hasSources ? 'secondary' : 'primary'} size="lg" disabled={pending}>
        {pending ? 'Проверяем…' : 'Проверить и добавить'}
      </Button>
      <div className="flex flex-wrap items-center gap-3">
        {hasSources && (
          <Button type="submit" name="intent" value="next" size="lg" formNoValidate className="grow" disabled={pending}>
            Дальше
          </Button>
        )}
        <Button type="submit" name="intent" value="skip" variant="ghost" formNoValidate disabled={pending}>
          Пропустить
        </Button>
      </div>
    </form>
  );
}
