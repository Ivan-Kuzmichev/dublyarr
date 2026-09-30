type Props = { d: string; size?: number; className?: string; strokeWidth?: number };

/** Линейная иконка 24×24 в стиле макетов: цвет берётся из currentColor. */
export function Icon({ d, size = 20, className, strokeWidth = 1.8 }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinejoin="round"
      strokeLinecap="round"
      className={className}
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

export const ICONS = {
  flame: 'M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1-3.6 2.2-4.8.2 1.6 1 2.6 2 3 0-3 .3-5.6.8-8.2z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.9 0 3.5-.6 4.9-1.4M9.9 9.9a3 3 0 0 0 4.2 4.2',
  back: 'M15 6l-6 6 6 6',
  chevron: 'M9 6l6 6-6 6',
  check: 'M5 12l5 5 9-10',
} as const;
