'use client';

import { useActionState } from 'react';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { Button } from '@/components/ui/Button';
import { saveEventsAction, type TgState } from './actions';

const EVENTS = [
  { key: 'downloaded', label: 'Скачана новая серия', description: 'И заметки о новых сезонах' },
  { key: 'stuck', label: 'Загрузка застряла или раздача пропала' },
  { key: 'ask', label: 'Нужно подтверждение: сомнительная раздача или новая студия', description: 'С кнопками «Это он» / «Не тот сериал»' },
  { key: 'original', label: 'Вышел оригинал, озвучки пока нет' },
  { key: 'source-down', label: 'Источник или трекер не отвечает больше часа' },
] as const;

export function EventsCard({ value }: { value: Record<string, boolean> }) {
  const [state, action, pending] = useActionState<TgState, FormData>(saveEventsAction, {});
  return (
    <Card className="flex min-w-0 flex-col gap-3">
      <h3 className="m-0 text-base font-semibold">О чём сообщать</h3>
      <form action={action} className="flex flex-col gap-1">
        {EVENTS.map((e) => (
          <Checkbox key={e.key} name={e.key} defaultChecked={value[e.key]} label={e.label} description={'description' in e ? e.description : undefined} />
        ))}
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
