'use client';

import { useActionState, useState, useTransition } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Stepper } from '@/components/ui/Stepper';
import { Switch } from '@/components/ui/Switch';
import type { LayaSettings } from '@/lib/laya/settings';
import { checkLayaAction, saveLayaAction, setLayaOnAction, type FormState } from './actions';

const TASKS = [
  { id: 'studio', title: 'Разбирать нераспознанные студии', sub: 'Подпись озвучки, которой нет в словаре, — к какой студии она относится; результат уходит в словарь' },
  { id: 'match', title: 'Проверять, тот ли это сериал', sub: 'Когда название похоже, но год или состав не совпадают' },
  { id: 'anime', title: 'Сопоставлять нумерацию аниме', sub: 'Сквозная серия 27 → сезон 2, серия 3 по TMDB' },
  { id: 'final', title: 'Проверять раздачу перед загрузкой', sub: '«Это серия 3 сезона 1 в озвучке LostFilm?» — до трёх лучших раздач' },
] as const;

/** Статус и главный выключатель: выключена — laya-serve остановлен, решают словарь и правила. */
export function LayaStatus({ on, ok, sub }: { on: boolean; ok: boolean; sub: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(checkLayaAction, {});
  const [power, setPower] = useState<FormState>({});
  const [switching, startSwitch] = useTransition();
  const toggle = (next: boolean) =>
    startSwitch(async () => {
      const fd = new FormData();
      if (next) fd.set('on', 'on');
      setPower(await setLayaOnAction({}, fd));
    });
  const note = power.error ?? power.ok ?? (on ? (state.ok ?? sub) : 'Модель выгружена из памяти. Dublyarr работает на словаре студий и правилах: сомнительные раздачи не берёт; серия не нашлась — сообщение в Telegram.');
  return (
    <Card className="flex min-w-0 flex-wrap items-center gap-4">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${!on ? 'bg-faint' : ok ? 'bg-[#7FD49B]' : 'bg-accent'}`} />
      <span className="flex min-w-0 basis-60 grow flex-col gap-1">
        <span className="text-[15px] font-semibold">{on ? 'Laya включена' : 'Laya выключена'}</span>
        <span className={`text-[13px] ${power.error ? 'text-danger' : 'text-muted'}`}>{note}</span>
        {on && state.error && (
          <span role="alert" className="text-[13px] text-danger">
            {state.error}
          </span>
        )}
      </span>
      <span className="flex items-center gap-2">
        {on && (
          <form action={action}>
            <Button type="submit" variant="secondary" disabled={pending || switching}>
              {pending ? 'Проверяю…' : 'Проверить'}
            </Button>
          </form>
        )}
        <Switch checked={on} onChange={toggle} disabled={switching} label="Laya включена" />
      </span>
    </Card>
  );
}

export function LayaForm({ value, off }: { value: LayaSettings; off?: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveLayaAction, {});
  const [threshold, setThreshold] = useState(Math.round(value.threshold * 100));
  return (
    <form action={action} className={`flex flex-col gap-5 ${off ? 'opacity-45' : ''}`} inert={off}>
      <input type="hidden" name="threshold" value={threshold} />
      <Card className="flex min-w-0 flex-col gap-1">
        <span className="text-[15px] font-semibold">Что решает Laya</span>
        <span className="mb-2 text-[13px] text-faint">Каждую задачу можно включать отдельно</span>
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
