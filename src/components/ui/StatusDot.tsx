export type ServiceState = 'ok' | 'warn' | 'off';
export type ServiceStatus = { name: string; state: ServiceState; note: string };

const DOT: Record<ServiceState, string> = { ok: 'bg-dim', warn: 'bg-accent', off: 'bg-danger' };
const NOTE: Record<ServiceState, string> = { ok: 'text-faint', warn: 'text-accent', off: 'text-danger' };

export function ServiceRow({ s, className = '' }: { s: ServiceStatus; className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <span className={`h-2 w-2 rounded-full ${DOT[s.state]}`} />
      <span className="grow text-text-2">{s.name}</span>
      <span className={`font-mono text-xs ${NOTE[s.state]}`}>{s.note}</span>
    </div>
  );
}
