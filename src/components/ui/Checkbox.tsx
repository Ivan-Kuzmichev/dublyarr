import type { InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string; description?: string };

export function Checkbox({ label, description, className = '', ...rest }: Props) {
  return (
    <label className={`flex min-h-11 cursor-pointer gap-3 ${description ? 'items-start py-1' : 'items-center'} ${className}`}>
      <input type="checkbox" className={`m-0 h-[18px] w-[18px] shrink-0 accent-accent ${description ? 'mt-px' : ''}`} {...rest} />
      <span className="flex flex-col gap-[3px]">
        <span className="text-sm text-text-2">{label}</span>
        {description && <span className="text-[13px] text-faint">{description}</span>}
      </span>
    </label>
  );
}
