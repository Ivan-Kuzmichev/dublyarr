'use client';

import { useActionState, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Segmented } from '@/components/ui/Segmented';
import { Checkbox } from '@/components/ui/Checkbox';
import { Stepper } from '@/components/ui/Stepper';
import { Button } from '@/components/ui/Button';
import type { CleanupSettings } from '@/lib/cleanup';
import { saveCleanupAction, type FormState } from './actions';

export function CleanupCard({ value }: { value: CleanupSettings }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveCleanupAction, {});
  const [remove, setRemove] = useState(value.remove);
  const [days, setDays] = useState(value.seedDays);
  return (
    <Card className="flex min-w-0 flex-col gap-5">
      <h3 className="m-0 text-base font-semibold">Уборка в qBittorrent</h3>
      <form action={action} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-sm text-text-2">Убирать торрент</span>
          <div className="max-w-full overflow-x-auto">
            <Segmented
              name="remove"
              defaultValue={value.remove}
              onChange={setRemove}
              aria-label="Убирать торрент"
              options={[
                { value: 'import', label: 'сразу после импорта' },
                { value: 'seeded', label: 'после раздачи' },
                { value: 'never', label: 'никогда' },
              ]}
            />
          </div>
        </div>
        <input type="hidden" name="seedDays" value={days} />
        {remove !== 'seeded' && <input type="hidden" name="seedRatio" value={value.seedRatio} />}
        {remove === 'seeded' && (
          <div className="flex flex-wrap items-center gap-3 text-sm text-text-2">
            Раздавать <Stepper value={days} min={0} max={365} onChange={setDays} label="Дней раздачи" suffix=" дн" /> или до рейтинга
            <input
              name="seedRatio"
              inputMode="decimal"
              aria-label="Рейтинг раздачи"
              defaultValue={String(value.seedRatio).replace('.', ',')}
              className="h-11 w-20 rounded-[10px] border border-line bg-surface-2 px-3 text-center font-mono text-sm text-text"
            />
          </div>
        )}
        <Checkbox name="deleteFiles" defaultChecked={value.deleteFiles} label="Удалять файлы из папки загрузок вместе с торрентом" description="В медиатеке лежит своя копия. Первая уборка — через подтверждение" />
        <Checkbox name="replaced" defaultChecked={value.replaced} label="Убирать заменённые раздачи" description="Обновлённые паки и раздачи, вместо которых взяли другие из-за нехватки сидов" />
        <Checkbox name="orphans" defaultChecked={value.orphans} label="Чистить брошенные файлы в папке загрузок" description="Остатки в папке dublyarr, которые не принадлежат ни одному торренту" />
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
