'use client';

import { useActionState, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { Button } from '@/components/ui/Button';
import { Stepper } from '@/components/ui/Stepper';
import { saveEventsAction, type TgState } from './actions';

const EVENTS = [
  { key: 'downloaded', label: 'Скачана новая серия', description: 'И заметки о новых сезонах' },
  { key: 'stuck', label: 'Загрузка застряла или раздача пропала' },
  { key: 'ask', label: 'Нужно подтверждение: сомнительная раздача или новая студия', description: 'С кнопками «Это он» / «Не тот сериал»' },
  { key: 'original', label: 'Вышел оригинал, озвучки пока нет' },
  { key: 'source-down', label: 'Источник или трекер не отвечает больше часа' },
  { key: 'not-found', label: 'Серия не нашлась за N дней после выхода', description: 'Не скачана и не качается — по любой причине; одно сообщение на серию' },
] as const;

/** Свои события; N дней для «не нашлась» — общий, меняет администратор (notFoundDays). */
export function EventsCard({ value, notFoundDays, admin }: { value: Record<string, boolean>; notFoundDays: number; admin: boolean }) {
  const [state, action, pending] = useActionState<TgState, FormData>(saveEventsAction, {});
  const [days, setDays] = useState(notFoundDays);
  return (
    <Card className="flex min-w-0 flex-col gap-3">
      <h3 className="m-0 text-base font-semibold">О чём сообщать</h3>
      <form action={action} className="flex flex-col gap-1">
        {EVENTS.map((e) => (
          <Checkbox
            key={e.key}
            name={e.key}
            defaultChecked={value[e.key]}
            label={e.key === 'not-found' ? e.label.replace('N', String(days)) : e.label}
            description={'description' in e ? e.description : undefined}
          />
        ))}
        {admin && (
          <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-4">
            <span className="flex min-w-0 flex-col gap-1">
              <span className="text-sm text-text-2">Сколько дней ждать серию</span>
              <span className="text-[13px] text-faint">От выхода в эфир; если в профиле ждать запасную озвучку дольше — после конца ожидания. Общее для всех</span>
            </span>
            <input type="hidden" name="notFoundDays" value={days} />
            <Stepper label="Дней" value={days} min={1} max={90} onChange={setDays} />
          </div>
        )}
        {state.error && (
          <p role="alert" className="m-0 mt-2 text-sm text-danger">
            {state.error}
          </p>
        )}
        {state.ok && <p className="m-0 mt-2 text-sm text-progress">{state.ok}</p>}
        <div className="mt-3">
          <Button type="submit" disabled={pending}>
            Сохранить
          </Button>
        </div>
      </form>
    </Card>
  );
}
