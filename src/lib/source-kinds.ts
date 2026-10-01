// Типы источников и адреса запросов (без node-модулей: годится и для формы).

export type SourceKind = 'jackett' | 'jacred' | 'torznab';
export const SOURCE_KINDS: readonly SourceKind[] = ['jackett', 'jacred', 'torznab'];
export const SOURCE_KIND_LABEL: Record<SourceKind, string> = { jackett: 'Jackett', jacred: 'JacRed', torznab: 'Torznab' };

const JACKETT = /^(.*?)\/api\/v2\.0\/indexers\/([^/?#]+)\/results\/torznab/;

/** База Jackett из адреса Torznab «все трекеры»; адрес одного трекера и чужие адреса — null. */
export function jackettBase(url: string): string | null {
  const m = JACKETT.exec(url.trim());
  return m && m[2] === 'all' ? m[1] : null;
}

/** Адрес Torznab Jackett: из базы — «все трекеры»; вставленный путь одного трекера сохраняется. */
export function jackettEndpoint(url: string): string {
  const u = url.trim();
  const m = JACKETT.exec(u);
  if (m) return `${m[1]}/api/v2.0/indexers/${m[2]}/results/torznab/api`;
  return `${u.replace(/\/+$/, '')}/api/v2.0/indexers/all/results/torznab/api`;
}

export const endpointFor = (s: { kind: SourceKind; url: string }) => (s.kind === 'jackett' ? jackettEndpoint(s.url) : s.url.trim());
