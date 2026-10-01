'use client';

import { useState } from 'react';

type Props<T extends string> = {
  name: string;
  options: { value: T; label: string }[];
  defaultValue: T;
  onChange?: (v: T) => void;
  'aria-label'?: string;
};

/** Сегментный переключатель из макетов; внутри — радиокнопки, поэтому работает в обычной форме. */
export function Segmented<T extends string>({ name, options, defaultValue, onChange, ...aria }: Props<T>) {
  const [value, setValue] = useState<T>(defaultValue);
  return (
    <div role="radiogroup" aria-label={aria['aria-label']} className="inline-flex gap-1 rounded-[10px] bg-surface-2 p-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <label
            key={o.value}
            className={`relative flex h-9 shrink-0 cursor-pointer items-center rounded-[7px] px-3 text-[13px] whitespace-nowrap ${on ? 'bg-text font-semibold text-bg' : 'text-muted hover:text-text-2'}`}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={on}
              onChange={() => {
                setValue(o.value);
                onChange?.(o.value);
              }}
              className="sr-only"
            />
            {o.label}
          </label>
        );
      })}
    </div>
  );
}
