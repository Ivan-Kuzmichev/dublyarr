import type { HTMLAttributes } from 'react';

export function Card({ tone, className = '', ...rest }: HTMLAttributes<HTMLElement> & { tone?: 'danger' }) {
  const colors = tone === 'danger' ? 'bg-danger-bg border-danger-line' : 'bg-surface border-line';
  return <section className={`rounded-2xl border p-5 ${colors} ${className}`} {...rest} />;
}

export function CardTitle({ children, note }: { children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="m-0 text-base font-semibold">{children}</h3>
      {note && <span className="text-[13px] text-muted">{note}</span>}
    </div>
  );
}

export function SectionHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-5">
      <div className="flex flex-col gap-1.5">
        <h2 className="m-0 text-2xl font-semibold">{title}</h2>
        {description && <p className="m-0 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
