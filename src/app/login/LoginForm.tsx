'use client';

import { useActionState } from 'react';
import { Field, PasswordField } from '@/components/ui/Field';
import { Checkbox } from '@/components/ui/Checkbox';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/shell/AuthFrame';
import { loginAction, type FormState } from './actions';

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, {});
  return (
    <form action={action} className="flex flex-col gap-[22px]">
      <input type="hidden" name="next" value={next} />
      <Field label="Логин" name="username" autoComplete="username" defaultValue="admin" required autoCapitalize="none" spellCheck={false} />
      <PasswordField label="Пароль" name="password" autoComplete="current-password" required autoFocus />
      <Checkbox label="Запомнить это устройство" name="remember" defaultChecked />
      <FormError message={state.error} />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Входим…' : 'Войти'}
      </Button>
    </form>
  );
}
