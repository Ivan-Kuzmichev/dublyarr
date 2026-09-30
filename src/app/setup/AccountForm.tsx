'use client';

import { useActionState } from 'react';
import { Field, PasswordField } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { createAccountAction, type StepState } from './actions';

export function AccountForm() {
  const [state, action, pending] = useActionState<StepState, FormData>(createAccountAction, {});
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-[22px]">
      <Field label="Логин" name="username" defaultValue={state.values?.username ?? 'admin'} autoComplete="username" required autoCapitalize="none" spellCheck={false} error={fe.username} />
      <PasswordField label="Пароль" name="password" autoComplete="new-password" required hint="Не короче 10 символов" error={fe.password} />
      <PasswordField label="Повторите пароль" name="password2" autoComplete="new-password" required error={fe.password2} />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Создаём…' : 'Создать аккаунт'}
      </Button>
    </form>
  );
}
