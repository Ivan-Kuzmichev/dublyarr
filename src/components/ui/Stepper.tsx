'use client';

type Props = { value: number; min: number; max: number; onChange: (v: number) => void; label: string; suffix?: string };

/** Регулятор «− N +» из макета подписки; зона нажатия 44 px. */
export function Stepper({ value, min, max, onChange, label, suffix }: Props) {
  const btn =
    'flex h-11 w-11 cursor-pointer items-center justify-center text-lg text-text-2 disabled:cursor-default disabled:opacity-40 hover:text-text';
  return (
    <span className="inline-flex items-center rounded-[10px] bg-surface-2" role="group" aria-label={label}>
      <button type="button" aria-label="Меньше" className={btn} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        −
      </button>
      <span className="min-w-6 text-center font-mono text-sm text-text" aria-live="polite">
        {value}
        {suffix}
      </span>
      <button type="button" aria-label="Больше" className={btn} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        +
      </button>
    </span>
  );
}
