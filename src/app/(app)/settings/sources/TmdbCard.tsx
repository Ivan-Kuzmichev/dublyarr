'use client';

import { useActionState } from 'react';
import { Card, CardTitle } from '@/components/ui/Card';
import { Field, PasswordField } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import type { TmdbFormState } from '@/lib/tmdb/form';
import { saveTmdbAction } from './actions';

export function TmdbCard({ hasKey, proxy }: { hasKey: boolean; proxy: string }) {
  const [state, action, pending] = useActionState<TmdbFormState, FormData>(saveTmdbAction, {});
  return (
    <Card className="flex flex-col gap-4">
      <CardTitle note={hasKey ? 'Ключ сохранён' : <span className="text-accent">Ключ не задан</span>}>TMDB</CardTitle>
      <p className="m-0 text-sm leading-normal text-muted">Названия, сезоны, даты выхода серий и постеры.</p>
      <form action={action} className="flex max-w-[480px] flex-col gap-4">
        <PasswordField label="Ключ API" name="apiKey" autoComplete="off" placeholder={hasKey ? 'сохранён — оставьте пустым' : ''} />
        <Field
          label="Прокси (необязательно)"
          name="proxy"
          defaultValue={state.values?.proxy ?? proxy}
          mono
          inputMode="url"
          placeholder="http://192.168.1.10:3128"
          hint="Если TMDB не открывается с NAS"
        />
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
