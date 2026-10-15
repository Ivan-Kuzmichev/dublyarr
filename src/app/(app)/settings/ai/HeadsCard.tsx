'use client';

import { useActionState } from 'react';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { Button } from '@/components/ui/Button';
import { setHeadsAction, type FormState } from './actions';

/** «Дообученная Laya»: головы, обученные на раздачах русских трекеров (лежат в Dublyarr), поверх базовой модели. */
export function HeadsCard({ on, active, available }: { on: boolean; active: boolean; available: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setHeadsAction, {});
  if (!available)
    return (
      <Card className="flex min-w-0 flex-col gap-1">
        <h3 className="m-0 text-base font-semibold">Дообученная Laya</h3>
        <p className="m-0 text-[13px] text-muted">В этой версии Dublyarr дообученной модели нет — работает базовая. Ваши ответы копятся в «Примерах» для следующих версий.</p>
      </Card>
    );
  return (
    <form action={action}>
      <Card className="flex min-w-0 flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="m-0 text-base font-semibold">Дообученная Laya</h3>
          <span className="text-[13px] text-muted">{active ? 'работает' : 'не используется'}</span>
        </div>
        <Checkbox name="on" defaultChecked={on} label="Использовать Laya, дообученную на ваших ответах" />
        <p className="m-0 text-[13px] text-faint">«Тот ли сериал»: поверх Laya — надстройка, обученная на «Это он» / «Не тот сериал», поэтому сомнительные раздачи чаще решаются без вопроса. Выключите, чтобы вернуться к базовой Laya.</p>
        {state.error && (
          <p role="alert" className="m-0 text-sm text-danger">
            {state.error}
          </p>
        )}
        {state.ok && <p className="m-0 text-sm text-progress">{state.ok}</p>}
        <div>
          <Button type="submit" variant="secondary" disabled={pending}>
            Применить
          </Button>
        </div>
      </Card>
    </form>
  );
}
