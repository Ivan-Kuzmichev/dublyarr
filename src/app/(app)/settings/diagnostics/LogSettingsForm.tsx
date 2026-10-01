'use client';

import { useActionState } from 'react';
import { Card, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Segmented';
import type { LogArea, LogSettings } from '@/lib/log';
import { saveLogSettingsAction, type LogFormState } from './actions';

const LEVELS = [
  { value: 'debug', label: 'Подробно' },
  { value: 'info', label: 'Обычно' },
  { value: 'warn', label: 'Только предупреждения' },
] as const;
const AREA_LEVELS = [{ value: 'inherit', label: 'Как общий' }, ...LEVELS, { value: 'off', label: 'Выкл.' }];

export function LogSettingsForm({ value, areas }: { value: LogSettings; areas: { id: LogArea; label: string }[] }) {
  const [state, action, pending] = useActionState<LogFormState, FormData>(saveLogSettingsAction, {});
  return (
    <Card className="flex min-w-0 flex-col gap-4">
      <CardTitle>Логирование</CardTitle>
      <form action={action} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[15px] font-medium">Общий уровень</span>
          <Segmented name="level" aria-label="Общий уровень" defaultValue={value.level} options={[...LEVELS]} />
        </div>
        <p className="m-0 text-[13px] text-faint">«Подробно» — каждый запрос к qBittorrent, источникам и TMDB, причины, почему серия не качается. Журнал хранится в /data/logs (до 50 МБ).</p>
        <div className="grid gap-x-6 gap-y-2 md:grid-cols-2">
          {areas.map((a) => (
            <label key={a.id} className="flex min-h-11 items-center justify-between gap-3 border-b border-line-soft text-sm text-text-2">
              {a.label}
              <select
                name={`area.${a.id}`}
                defaultValue={value.areas[a.id] ?? 'inherit'}
                aria-label={`Уровень: ${a.label}`}
                className="h-9 rounded-lg border border-line bg-surface-2 px-2 text-[13px] text-text"
              >
                {AREA_LEVELS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
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
