'use client';

import { useActionState } from 'react';
import { Card, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Field } from '@/components/ui/Field';
import { createApiTokenAction, revokeApiTokenAction, saveApiAccessAction, type ApiState } from './actions';

export type ApiTokenRow = { id: number; name: string; prefix: string; created: string; used: string };

export function ApiCard({ enabled, tokens }: { enabled: boolean; tokens: ApiTokenRow[] }) {
  const [access, accessAction, saving] = useActionState<ApiState, FormData>(saveApiAccessAction, {});
  const [made, createAction, creating] = useActionState<ApiState, FormData>(createApiTokenAction, {});
  return (
    <Card className="flex flex-col gap-4">
      <CardTitle note={enabled ? <span className="text-accent">Включён</span> : 'Выключен'}>API</CardTitle>
      <form action={accessAction} className="flex flex-wrap items-center gap-3">
        <Checkbox
          name="enabled"
          defaultChecked={enabled}
          label="API включён"
          description="Доступ по токену только из локальной сети. Через Pangolin и другие прокси API недоступен."
          className="grow"
        />
        <Button type="submit" variant="secondary" disabled={saving}>
          Сохранить доступ
        </Button>
      </form>
      {access.ok && <p className="m-0 text-sm text-progress">{access.ok}</p>}

      <form action={createAction} className="flex flex-wrap items-end gap-3">
        <Field label="Имя токена" name="name" placeholder="Claude" className="min-w-[200px] grow" />
        <Button type="submit" disabled={creating}>
          Создать токен
        </Button>
      </form>
      {made.error && (
        <p role="alert" className="m-0 text-sm text-danger">
          {made.error}
        </p>
      )}
      {made.token && (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-4">
          <span className="text-[13px] text-muted">Скопируйте токен — он показывается один раз:</span>
          <span data-testid="api-token" className="font-mono text-[13px] break-all select-all">
            {made.token}
          </span>
          <span className="text-[13px] text-faint">Заголовок запроса: Authorization: Bearer &lt;токен&gt;</span>
        </div>
      )}

      {tokens.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {tokens.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line-soft px-4 py-3">
              <span className="flex min-w-0 grow flex-col gap-1">
                <span className="text-[15px] font-medium">{t.name}</span>
                <span className="font-mono text-xs text-faint">
                  {t.prefix}… · создан {t.created} · {t.used}
                </span>
              </span>
              <form action={revokeApiTokenAction}>
                <input type="hidden" name="id" value={t.id} />
                <Button type="submit" variant="secondary" size="sm">
                  Отозвать
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
