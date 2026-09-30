'use client';

import { useActionState } from 'react';
import { Field, PasswordField } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { addSourceAction, type StepState } from '../actions';
import { StepResult } from '../StepResult';

export function SourceForm({ hasSources }: { hasSources: boolean }) {
  const [state, action, pending] = useActionState<StepState, FormData>(addSourceAction, {});
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-[22px]">
      <Field label="Название" name="name" defaultValue={state.values?.name ?? (hasSources ? '' : 'Jackett')} placeholder="Jackett" />
      <Field
        label="Адрес Torznab"
        name="url"
        defaultValue={state.values?.url}
        mono
        inputMode="url"
        placeholder="http://jackett:9117/api/v2.0/indexers/all/results/torznab/"
        hint="Для Jackett: http://<адрес>:9117/api/v2.0/indexers/all/results/torznab/"
        error={fe.url}
      />
      <PasswordField label="API-ключ" name="apiKey" autoComplete="off" hint="Хранится в базе зашифрованным" />
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
