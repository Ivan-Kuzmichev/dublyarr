'use client';

import { useId, useState, type InputHTMLAttributes } from 'react';
import { Icon, ICONS } from './Icon';

type Props = InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string; mono?: boolean };

const inputClass = (mono?: boolean, extra = '') =>
  `h-[50px] w-full box-border px-3.5 bg-surface border border-field-line rounded-xl text-text text-base outline-none focus:border-accent placeholder:text-dim ${mono ? 'font-mono text-[15px]' : ''} ${extra}`;

function Frame({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm text-text-3">
        {label}
      </label>
      {children}
      {error ? <span className="text-[13px] text-danger">{error}</span> : hint ? <span className="text-[13px] leading-[1.45] text-faint">{hint}</span> : null}
    </div>
  );
}

export function Field({ label, hint, error, mono, id, className, ...rest }: Props) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Frame id={fid} label={label} hint={hint} error={error}>
      <input id={fid} className={inputClass(mono, className)} aria-invalid={!!error} {...rest} />
    </Frame>
  );
}

export function PasswordField({ label, hint, error, id, className, ...rest }: Omit<Props, 'type' | 'mono'>) {
  const auto = useId();
  const fid = id ?? auto;
  const [shown, setShown] = useState(false);
  return (
    <Frame id={fid} label={label} hint={hint} error={error}>
      <span className="relative flex flex-col">
        <input id={fid} type={shown ? 'text' : 'password'} className={inputClass(false, `pr-12 ${className ?? ''}`)} aria-invalid={!!error} {...rest} />
        <button
          type="button"
          aria-label={shown ? 'Скрыть пароль' : 'Показать пароль'}
          onClick={() => setShown((v) => !v)}
          className="absolute right-1.5 top-1.5 flex h-[38px] w-[38px] cursor-pointer items-center justify-center text-faint hover:text-text-2"
        >
          <Icon d={shown ? ICONS.eyeOff : ICONS.eye} size={18} />
        </button>
      </span>
    </Frame>
  );
}
