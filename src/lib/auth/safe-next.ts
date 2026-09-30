/** Куда вернуть после входа: только относительный путь внутри Dublyarr, иначе на главную. */
export function safeNext(n: string | null | undefined): string {
  if (!n || !n.startsWith('/') || n.startsWith('//') || n.startsWith('/\\') || n.startsWith('/login')) return '/';
  return n;
}
