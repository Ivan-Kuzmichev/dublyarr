export function Badge({ children, tone = 'quiet' }: { children: React.ReactNode; tone?: 'quiet' | 'accent' }) {
  const cls = tone === 'accent' ? 'bg-accent text-on-accent' : 'bg-[#2A2724] text-muted';
  return (
    <span className={`flex h-[22px] min-w-[22px] items-center justify-center rounded-[11px] px-[7px] text-xs font-semibold ${cls}`}>{children}</span>
  );
}
