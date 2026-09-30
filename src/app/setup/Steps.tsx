import { Icon, ICONS } from '@/components/ui/Icon';

const STEPS = [
  { id: 'account', label: 'Аккаунт' },
  { id: 'tmdb', label: 'TMDB' },
  { id: 'qbittorrent', label: 'qBittorrent' },
  { id: 'sources', label: 'Источники' },
  { id: 'folders', label: 'Папки' },
] as const;

export type StepId = (typeof STEPS)[number]['id'];

export function Steps({ current }: { current: StepId }) {
  const idx = STEPS.findIndex((s) => s.id === current);
  return (
    <ol aria-label="Шаги первого запуска" className="m-0 flex list-none flex-wrap gap-x-4 gap-y-2 p-0 text-sm">
      {STEPS.map((s, i) => {
        const state = i < idx ? 'done' : i === idx ? 'current' : 'next';
        return (
          <li
            key={s.id}
            aria-current={state === 'current' ? 'step' : undefined}
            className={`flex items-center gap-1.5 ${state === 'current' ? 'font-semibold text-accent' : state === 'done' ? 'text-text-2' : 'text-faint'}`}
          >
            {state === 'done' ? (
              <Icon d={ICONS.check} size={14} strokeWidth={2.2} />
            ) : (
              <span className="font-mono text-xs">{i + 1}</span>
            )}
            {s.label}
          </li>
        );
      })}
    </ol>
  );
}

export function StepHeading({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="m-0 font-display text-[24px] font-semibold tracking-[-0.02em] lg:text-[28px]">{title}</h1>
      {children && <p className="m-0 text-[15px] leading-normal text-muted">{children}</p>}
    </div>
  );
}
