'use client';

import { useActionState } from 'react';
import { Field, PasswordField } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { qbittorrentAction, type StepState } from '../actions';
import { StepResult } from '../StepResult';

export function QbitForm({ url, username, hasPassword }: { url: string; username: string; hasPassword: boolean }) {
  const [state, action, pending] = useActionState<StepState, FormData>(qbittorrentAction, {});
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-[22px]">
      <Field label="Адрес" name="url" defaultValue={state.values?.url ?? url} placeholder="http://192.168.1.10:8080" mono required inputMode="url" error={fe.url} />
      <Field label="Логин" name="username" defaultValue={state.values?.username ?? username} autoComplete="off" autoCapitalize="none" spellCheck={false} />
      <PasswordField
        label="Пароль"
        name="password"
        autoComplete="off"
        placeholder={hasPassword ? 'сохранён — оставьте пустым' : ''}
        hint="Хранится в базе зашифрованным"
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
