const BASE = 'http://dublyarr.local';

/** Куда вернуть после входа: только путь внутри Dublyarr, иначе на главную. */
export function safeNext(n: string | null | undefined): string {
  // Управляющие символы и обратный слэш браузер нормализует так, что путь может стать //чужой-хост.
  if (!n || !n.startsWith('/') || /[\u0000-\u001f\u007f\\]/.test(n)) return '/';
  let u: URL;
  try {
    u = new URL(n, BASE);
  } catch {
    return '/';
  }
  if (u.origin !== BASE || u.pathname.startsWith('/login')) return '/';
  return u.pathname + u.search + u.hash;
}
