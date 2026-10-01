'use client';

import { useActionState } from 'react';
import { Card } from '@/components/ui/Card';
import { Segmented } from '@/components/ui/Segmented';
import { Checkbox } from '@/components/ui/Checkbox';
import { Button } from '@/components/ui/Button';
import type { ScheduleSettings, SearchEvery } from '@/lib/schedule';
import { saveScheduleAction, type SaveState } from './actions';

const EVERY: { value: SearchEvery; label: string }[] = [
  { value: '15m', label: 'каждые 15 мин' },
  { value: '1h', label: 'раз в час' },
  { value: '2h', label: 'раз в 2 часа' },
  { value: '6h', label: 'раз в 6 часов' },
  { value: 'night', label: 'только ночью' },
];

const time = 'h-11 w-[120px] rounded-[10px] border border-line bg-surface-2 px-3 text-center font-mono text-sm text-text';

export function ScheduleForm({ value, next, eagerCount }: { value: ScheduleSettings; next: string; eagerCount: number }) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveScheduleAction, {});
  return (
    <Card className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="m-0 text-base font-semibold">Как часто искать</h3>
        <span className="text-[13px] text-muted">{next}</span>
      </div>
      <form action={action} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <span className="text-sm text-text-2">Проверять трекеры</span>
          <div className="max-w-full overflow-x-auto">
            <Segmented name="every" options={EVERY} defaultValue={value.every} aria-label="Проверять трекеры" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-text-2">Ночное окно</span>
          <input type="time" name="nightFrom" defaultValue={value.nightFrom} aria-label="Начало ночного окна" className={time} required />
          <span className="text-muted">—</span>
          <input type="time" name="nightTo" defaultValue={value.nightTo} aria-label="Конец ночного окна" className={time} required />
        </div>
        <div className="h-px bg-line-soft" />
        <Checkbox
          name="eager"
          defaultChecked={value.eager}
          label="Чаще, когда ждём серию"
          description={`В день прогноза озвучки — каждые 30 минут, пока серия не найдётся. Сейчас так ждут: ${eagerCount}`}
        />
        <Checkbox
          name="packChecks"
          defaultChecked={value.packChecks}
          label="Проверять обновления паков чаще основного поиска"
          description="Проверка хэша знакомой раздачи почти не нагружает трекер — раз в 30 минут"
        />
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
    </Card>
  );
}
