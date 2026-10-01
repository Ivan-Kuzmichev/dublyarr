'use client';

import { useActionState } from 'react';
import { Card } from '@/components/ui/Card';
import { Field, PasswordField } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { saveQbitAction, type FormState } from './actions';

export function QbitCard({ url, username, hasPassword, status }: { url: string; username: string; hasPassword: boolean; status: { text: string; tone: 'ok' | 'warn' | 'off' } }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveQbitAction, {});
  const dot = { ok: 'bg-progress', warn: 'bg-accent', off: 'bg-dim' }[status.tone];
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <h3 className="m-0 grow text-base font-semibold">qBittorrent</h3>
        <span className="text-[13px] text-muted">{status.text}</span>
      </div>
      <form action={action} className="flex max-w-[560px] flex-col gap-4">
        <Field label="Адрес" name="url" mono inputMode="url" defaultValue={state.values?.url ?? url} placeholder="http://192.168.1.10:8080" required />
        <Field label="Логин" name="username" defaultValue={state.values?.username ?? username} autoComplete="off" autoCapitalize="none" spellCheck={false} />
        <PasswordField label="Пароль" name="password" autoComplete="off" placeholder={hasPassword ? 'сохранён — оставьте пустым' : ''} hint="Хранится в базе зашифрованным" />
        <p className="m-0 text-[13px] text-faint">
          Раздачи Dublyarr — в категории <span className="font-mono">dublyarr</span>; чужие торренты он не трогает.
        </p>
        {state.error && (
          <p role="alert" className="m-0 text-sm text-danger">
            {state.error}
          </p>
        )}
        {state.ok && <p className="m-0 text-sm text-progress">{state.ok}</p>}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" name="intent" value="save" disabled={pending}>
            Сохранить
          </Button>
          <Button type="submit" name="intent" value="check" variant="secondary" disabled={pending}>
            Проверить
          </Button>
        </div>
      </form>
    </Card>
  );
}
