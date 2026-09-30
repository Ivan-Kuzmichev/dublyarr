import { Icon, ICONS } from './Icon';

export function Logo({ size = 'sm' }: { size?: 'sm' | 'md' | 'lg' }) {
  const s = { sm: [26, 'text-[18px] gap-2.5'], md: [28, 'text-[22px] gap-2.5'], lg: [36, 'text-[34px] gap-3'] } as const;
  const [icon, cls] = s[size];
  return (
    <span className={`flex items-center ${cls}`}>
      <Icon d={ICONS.flame} size={icon} className="text-accent" />
      <span className="font-display font-semibold tracking-[-0.01em] text-text">Dublyarr</span>
    </span>
  );
}
