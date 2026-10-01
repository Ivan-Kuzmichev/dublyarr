'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Segmented } from '@/components/ui/Segmented';
import { Stepper } from '@/components/ui/Stepper';
import { Button } from '@/components/ui/Button';
import type { RetentionSettings } from '@/lib/retention-settings';
import { runNowAction, saveRetentionAction, type SaveState } from './actions';

type Props = { value: RetentionSettings; next: string; freeable: string; diskPct: number | null };

function RuleCard({ name, on, title, sub, children }: { name?: string; on?: boolean; title: string; sub: string; children?: React.ReactNode }) {
  return (
    <Card className="flex min-w-0 flex-col gap-3">
      <label className="flex min-h-11 cursor-pointer items-center gap-3">
        {name && <input type="checkbox" name={name} defaultChecked={on} className="h-[18px] w-[18px] accent-accent" />}
        <span className="text-[15px] font-semibold">{title}</span>
      </label>
      <span className="text-[13px] text-faint">{sub}</span>
      {children}
    </Card>
  );
}

const row = 'flex flex-wrap items-center justify-between gap-3 text-sm text-text-2';

export function RetentionForm({ value: v, next, freeable, diskPct }: Props) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveRetentionAction, {});
  const [run, runAction, running] = useActionState<SaveState, FormData>(runNowAction, {});
  const [keep, setKeep] = useState(v.seasons.keep);
  const [days, setDays] = useState(v.age.days);
  const [warn, setWarn] = useState(v.overflow.warn);
  const [pause, setPause] = useState(v.overflow.pause);
  return (
    <div className="flex flex-col gap-5">
      <Card className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="m-0 text-base font-semibold">Уборка</h3>
          <Link href="/storage" className="text-sm no-underline">
            Открыть хранилище →
          </Link>
        </div>
        <span className="text-[13px] text-muted">
          {next} · освободит <span className="text-accent">{freeable}</span>
        </span>
        <form action={runAction} className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="secondary" disabled={running}>
            Запустить сейчас
          </Button>
          {run.ok && <span className="text-sm text-progress">{run.ok}</span>}
        </form>
      </Card>
      <form action={action} className="flex flex-col gap-5">
        <input type="hidden" name="keep" value={keep} />
        <input type="hidden" name="days" value={days} />
        <input type="hidden" name="warn" value={warn} />
        <input type="hidden" name="pause" value={pause} />
        <Card className="flex min-w-0 flex-col gap-2">
          <span className="text-sm text-text-2">Когда убирать</span>
          <div className="max-w-full overflow-x-auto">
            <Segmented name="schedule" defaultValue={v.schedule} aria-label="Когда убирать" options={[{ value: 'daily', label: 'каждый день' }, { value: 'weekly', label: 'раз в неделю' }, { value: 'manual', label: 'вручную' }]} />
          </div>
        </Card>
        <RuleCard name="seasonsOn" on={v.seasons.on} title="Сезоны: последний + выходящий" sub="Когда выходящий сезон скачан целиком в нужной озвучке, предыдущие удаляются. Первая уборка — через подтверждение.">
          <div className={row}>
            Хранить вышедших сезонов <Stepper value={keep} min={1} max={10} onChange={setKeep} label="Хранить вышедших сезонов" />
          </div>
          <div className={row}>
            Завершённые сериалы
            <div className="max-w-full overflow-x-auto">
              <Segmented name="ended" defaultValue={v.seasons.ended} aria-label="Завершённые сериалы" options={[{ value: 'keep', label: 'не трогать' }, { value: 'clean', label: 'тоже чистить' }]} />
            </div>
          </div>
        </RuleCard>
        <RuleCard title="Старая копия после улучшения" sub="Серия скачалась заново в лучшем качестве или в озвучке выше по приоритету — старый файл удаляется.">
          <div className={row}>
            Удалять старую копию
            <div className="max-w-full overflow-x-auto">
              <Segmented name="oldCopy" defaultValue={v.oldCopy} aria-label="Удалять старую копию" options={[{ value: 'now', label: 'сразу' }, { value: '3days', label: 'через 3 дня' }, { value: 'cleanup', label: 'при уборке' }]} />
            </div>
          </div>
        </RuleCard>
        <RuleCard title="Удалять через N дней после скачивания" sub="Для сериалов «посмотреть и забыть». Включается у конкретных сериалов в их карточке.">
          <div className={row}>
            Срок <Stepper value={days} min={1} max={365} onChange={setDays} label="Срок, дней" suffix=" дн" />
          </div>
        </RuleCard>
        <RuleCard name="overflowOn" on={v.overflow.on} title="Защита от переполнения" sub="Сначала предупредить в Telegram, потом поставить загрузки Dublyarr на паузу.">
          <div className={row}>
            Предупредить при <Stepper value={warn} min={50} max={98} onChange={setWarn} label="Предупредить при" suffix="%" />
          </div>
          <div className={row}>
            Пауза загрузок при <Stepper value={pause} min={warn + 1} max={99} onChange={setPause} label="Пауза загрузок при" suffix="%" />
          </div>
          {diskPct !== null && <span className="text-[13px] text-faint">Сейчас занято {diskPct} %</span>}
        </RuleCard>
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
    </div>
  );
}
