'use client';

import { useActionState } from 'react';
import { Field, PasswordField } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { tmdbSetupAction, type StepState } from '../actions';
import { StepResult } from '../StepResult';

export function TmdbForm({ hasKey, proxy }: { hasKey: boolean; proxy: string }) {
  const [state, action, pending] = useActionState<StepState, FormData>(tmdbSetupAction, {});
  return (
    <form action={action} className="flex flex-col gap-[22px]">
      <PasswordField label="Ключ API" name="apiKey" autoComplete="off" placeholder={hasKey ? 'сохранён — оставьте пустым' : ''} hint="Хранится в базе зашифрованным" />
      <Field
        label="Прокси (необязательно)"
        name="proxy"
        defaultValue={state.values?.proxy ?? proxy}
        mono
        inputMode="url"
        placeholder="http://192.168.1.10:3128"
        hint="Если TMDB не открывается с NAS"
      />
      <StepResult state={state} />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" name="intent" value="save" size="lg" className="grow" disabled={pending}>
          Сохранить и дальше
        </Button>
        <Button type="submit" name="intent" value="check" variant="secondary" size="lg" disabled={pending}>
          Проверить
        </Button>
      </div>
      <Button type="submit" name="intent" value="skip" variant="ghost" formNoValidate className="self-start" disabled={pending}>
        Пропустить
      </Button>
    </form>
  );
}
