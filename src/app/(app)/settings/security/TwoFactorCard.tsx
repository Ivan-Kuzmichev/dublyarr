'use client';

import { useActionState } from 'react';
import { Card, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { CodeInput } from '@/components/ui/CodeInput';
import { PasswordField } from '@/components/ui/Field';
import { twoFactorAction, type TwoFaState } from './actions';

const groups = (s: string) => s.match(/.{1,4}/g)?.join(' ') ?? s;

export function TwoFactorCard({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState<TwoFaState, FormData>(twoFactorAction, { mode: enabled ? 'on' : 'off' });
  return (
    <Card className="flex flex-col gap-4">
      <CardTitle note={state.mode === 'on' || state.mode === 'disabling' ? <span className="text-accent">Включена</span> : 'Выключена'}>
        Двухфакторная защита
      </CardTitle>
      <form action={action} className="flex flex-col gap-4">
        {state.mode === 'off' && (
          <>
            <p className="m-0 text-sm leading-normal text-muted">
              Код из приложения-аутентификатора при входе с нового устройства. Подойдёт любое: Google Authenticator, 1Password, Aegis.
            </p>
            <Button type="submit" name="intent" value="start" className="self-start" disabled={pending}>
              Включить
            </Button>
          </>
        )}
        {state.mode === 'setup' && state.secret && (
          <>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
              {state.qr && (
                // eslint-disable-next-line @next/next/no-img-element -- data: URL QR-кода
                <img src={state.qr} alt="QR-код для приложения-аутентификатора" width={200} height={200} className="shrink-0 rounded-xl" />
              )}
              <div className="flex flex-col gap-2 text-sm">
                <span className="text-muted">1. Отсканируй QR-код в приложении.</span>
                <span className="text-muted">Или введи ключ вручную:</span>
                <span data-testid="totp-secret" className="font-mono text-[15px] break-all text-text">
                  {groups(state.secret)}
                </span>
                <span className="mt-2 text-muted">2. Введи 6 цифр из приложения.</span>
              </div>
            </div>
            <input type="hidden" name="intent" value="confirm" />
            <div className="max-w-[400px]">
              <CodeInput name="code" />
            </div>
            {state.error && <p className="m-0 text-sm text-danger">{state.error}</p>}
            <div className="flex gap-3">
              <Button type="submit" disabled={pending}>
                Подтвердить
              </Button>
              <Button type="submit" name="intent" value="cancel" variant="ghost" formNoValidate disabled={pending}>
                Отмена
              </Button>
            </div>
          </>
        )}
        {state.mode === 'on' && (
          <>
            <p className="m-0 text-sm leading-normal text-muted">
              При входе с нового устройства Dublyarr спросит код. Потерял телефон — <span className="font-mono text-xs text-text-3">dublyarr reset-password --disable-2fa</span> в контейнере.
            </p>
            <Button type="submit" name="intent" value="ask-disable" variant="secondary" className="self-start" disabled={pending}>
              Выключить
            </Button>
          </>
        )}
        {state.mode === 'disabling' && (
          <>
            <input type="hidden" name="intent" value="disable" />
            <div className="max-w-[400px]">
              <PasswordField label="Текущий пароль" name="password" autoComplete="current-password" required error={state.error} />
            </div>
            <div className="flex gap-3">
              <Button type="submit" variant="destructive" disabled={pending}>
                Выключить защиту
              </Button>
              <Button type="submit" name="intent" value="cancel" variant="ghost" formNoValidate disabled={pending}>
                Отмена
              </Button>
            </div>
          </>
        )}
      </form>
    </Card>
  );
}
