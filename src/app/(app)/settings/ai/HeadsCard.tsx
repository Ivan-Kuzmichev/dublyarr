'use client';

import { useActionState } from 'react';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { Button } from '@/components/ui/Button';
import { setHeadsAction, type FormState } from './actions';

/** «Дообученная Laya»: головы, обученные на раздачах русских трекеров (лежат в Dublyarr), поверх базовой модели. */
export function HeadsCard({ on, active }: { on: boolean; active: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setHeadsAction, {});
  return (
    <form action={action}>
      <Card className="flex min-w-0 flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="m-0 text-base font-semibold">Дообученная Laya</h3>
          <span className="text-[13px] text-muted">{active ? 'работает' : 'не используется'}</span>
        </div>
        <Checkbox name="on" defaultChecked={on} label="Использовать модель, дообученную на раздачах русских трекеров" />
        <p className="m-0 text-[13px] text-faint">Учтены ремейки, спин-оффы, фильмы против сериалов и подписи студий. Выключите, чтобы вернуться к базовой Laya.</p>
        {state.error && (
          <p role="alert" className="m-0 text-sm text-danger">
            {state.error}
          </p>
        )}
        {state.ok && <p className="m-0 text-sm text-progress">{state.ok}</p>}
        <div>
          <Button type="submit" variant="secondary" disabled={pending}>
            Сохранить
          </Button>
        </div>
      </Card>
    </form>
  );
}
