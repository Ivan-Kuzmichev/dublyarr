'use client';

import { useActionState, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Stepper } from '@/components/ui/Stepper';
import type { LayaSettings } from '@/lib/laya/settings';
import { checkLayaAction, saveLayaAction, type FormState } from './actions';

const TASKS = [
  { id: 'studio', title: 'Разбирать нераспознанные студии', sub: 'Подпись озвучки, которой нет в словаре, — к какой студии она относится; результат уходит в словарь' },
  { id: 'match', title: 'Проверять, тот ли это сериал', sub: 'Когда название похоже, но год или состав не совпадают' },
  { id: 'anime', title: 'Сопоставлять нумерацию аниме', sub: 'Сквозная серия 27 → сезон 2, серия 3 по TMDB' },
  { id: 'final', title: 'Проверять раздачу перед загрузкой', sub: '«Это серия 3 сезона 1 в озвучке LostFilm?» — до трёх лучших раздач' },
] as const;

export function LayaStatus({ ok, title, sub }: { ok: boolean; title: string; sub: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(checkLayaAction, {});
  return (
    <Card className="flex min-w-0 flex-wrap items-center gap-4">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${ok ? 'bg-[#7FD49B]' : 'bg-accent'}`} />
      <span className="flex min-w-0 grow flex-col gap-1">
        <span className="text-[15px] font-semibold">{title}</span>
        <span className="text-[13px] text-muted">{state.ok ?? sub}</span>
        {state.error && (
          <span role="alert" className="text-[13px] text-danger">
            {state.error}
          </span>
        )}
      </span>
      <form action={action}>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? 'Проверяю…' : 'Проверить'}
        </Button>
      </form>
    </Card>
  );
}

export function LayaForm({ value }: { value: LayaSettings }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveLayaAction, {});
  const [threshold, setThreshold] = useState(Math.round(value.threshold * 100));
  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="threshold" value={threshold} />
      <Card className="flex min-w-0 flex-col gap-1">
        {TASKS.map((t) => (
          <Checkbox key={t.id} name={t.id} label={t.title} description={t.sub} defaultChecked={value.tasks[t.id]} />
        ))}
      </Card>
      <Card className="flex min-w-0 flex-wrap items-center justify-between gap-4">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-[15px] font-medium">Принимать решение без меня, если уверенность выше</span>
          <span className="text-[13px] text-faint">Ниже порога — вопрос в «Требует внимания» и Telegram</span>
        </span>
        <Stepper label="Порог уверенности" value={threshold} min={50} max={99} suffix="%" onChange={setThreshold} />
      </Card>
      {state.error && (
        <p role="alert" className="m-0 text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.ok && <p className="m-0 text-sm text-progress">{state.ok}</p>}
      <div>
        <Button type="submit" disabled={pending}>
          Сохранить
        </Button>
      </div>
    </form>
  );
}
