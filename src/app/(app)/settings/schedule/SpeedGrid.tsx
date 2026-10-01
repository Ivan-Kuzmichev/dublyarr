'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Stepper } from '@/components/ui/Stepper';
import { Button } from '@/components/ui/Button';
import type { SpeedSettings, SpeedState } from '@/lib/schedule';
import { saveSpeedAction, type SaveState } from './actions';

const DAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const BRUSH: { value: SpeedState; label: string; cls: string }[] = [
  { value: 'full', label: 'Полная скорость', cls: 'bg-progress/70' },
  { value: 'limit', label: 'Ограничено', cls: 'bg-accent/80' },
  { value: 'pause', label: 'Пауза', cls: 'bg-surface-2 border border-line-strong' },
];
const cellCls = (s: SpeedState) => BRUSH.find((b) => b.value === s)!.cls;

/** Сетка 7×24: выбрать кисть и провести по ячейкам (или нажимать по одной). */
export function SpeedGrid({ value, summary }: { value: SpeedSettings; summary: string }) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveSpeedAction, {});
  const [grid, setGrid] = useState(value.grid);
  const [limit, setLimit] = useState(value.limitMb);
  const [brush, setBrush] = useState<SpeedState>('limit');
  const painting = useRef(false);
  useEffect(() => {
    const stop = () => (painting.current = false);
    window.addEventListener('pointerup', stop);
    return () => window.removeEventListener('pointerup', stop);
  }, []);
  const paint = (d: number, h: number) => setGrid((g) => (g[d][h] === brush ? g : g.map((row, i) => (i === d ? row.map((c, j) => (j === h ? brush : c)) : row))));
  return (
    <Card className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="m-0 text-base font-semibold">Расписание скорости</h3>
        <span className="text-[13px] text-muted">{summary}</span>
      </div>
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="grid" value={grid.flat().map((c) => c[0]).join('')} />
        <input type="hidden" name="limitMb" value={limit} />
        <div className="flex flex-wrap items-center gap-3 text-sm text-text-2">
          Ограничение <Stepper value={limit} min={1} max={1000} onChange={setLimit} label="Ограничение скорости" suffix=" МБ/с" />
          <span className="text-[13px] text-faint">только для раздач Dublyarr</span>
        </div>
        <div role="radiogroup" aria-label="Кисть" className="flex flex-wrap gap-2">
          {BRUSH.map((b) => (
            <button
              key={b.value}
              type="button"
              role="radio"
              aria-checked={brush === b.value}
              onClick={() => setBrush(b.value)}
              className={`flex h-11 cursor-pointer items-center gap-2 rounded-[10px] border px-3 text-[13px] ${brush === b.value ? 'border-text text-text' : 'border-line text-muted'}`}
            >
              <span className={`h-3.5 w-3.5 rounded ${b.cls}`} />
              {b.label}
            </button>
          ))}
        </div>
        <div className="max-w-full overflow-x-auto pb-1">
          <div className="grid min-w-[620px] touch-none grid-cols-[28px_repeat(24,minmax(0,1fr))] gap-[3px] select-none" onPointerLeave={() => (painting.current = false)}>
            <span />
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="text-center font-mono text-[10px] text-faint">
                {h % 3 === 0 ? h : ''}
              </span>
            ))}
            {grid.map((row, d) => [
              <span key={`d${d}`} className="flex items-center text-xs text-muted">
                {DAYS[d]}
              </span>,
              ...row.map((c, h) => (
                <button
                  key={`${d}-${h}`}
                  type="button"
                  aria-label={`${DAYS[d]} ${h}:00 — ${BRUSH.find((b) => b.value === c)!.label}`}
                  className={`h-6 cursor-pointer rounded-[3px] ${cellCls(c)}`}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    painting.current = true;
                    paint(d, h);
                  }}
                  onPointerEnter={() => painting.current && paint(d, h)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && paint(d, h)}
                />
              )),
            ])}
          </div>
        </div>
        <span className="text-xs text-faint">Выберите состояние и проведите по ячейкам, чтобы поменять</span>
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
