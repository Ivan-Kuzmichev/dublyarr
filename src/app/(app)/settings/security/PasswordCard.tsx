'use client';

import { useActionState } from 'react';
import { Card, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { PasswordField } from '@/components/ui/Field';
import { changePasswordAction, type PasswordState } from './actions';

export function PasswordCard() {
  const [state, action, pending] = useActionState<PasswordState, FormData>(changePasswordAction, {});
  return (
    <Card className="flex flex-col gap-4">
      <CardTitle>Пароль</CardTitle>
      <form action={action} className="flex max-w-[400px] flex-col gap-4">
        <PasswordField label="Текущий пароль" name="current" autoComplete="current-password" required />
        <PasswordField label="Новый пароль" name="next" autoComplete="new-password" required hint="Не короче 10 символов" />
        <PasswordField label="Повторите новый пароль" name="next2" autoComplete="new-password" required />
        {state.error && <p className="m-0 text-sm text-danger">{state.error}</p>}
        {state.ok && <p className="m-0 text-sm text-progress">{state.ok}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="secondary" disabled={pending}>
            Сменить пароль
          </Button>
          <span className="text-[13px] text-faint">Все остальные сеансы завершатся</span>
        </div>
      </form>
    </Card>
  );
}
