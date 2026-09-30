export const COOKIE_SESSION = 'dy_session';
export const COOKIE_PENDING = 'dy_pending';
export const COOKIE_TRUST = 'dy_trust';

/** NAS обычно открыт по http в LAN: Secure ставим, только если запрос пришёл через https-прокси. */
export function isSecureRequest(h: { get(name: string): string | null }): boolean {
  return (h.get('x-forwarded-proto') ?? '').split(',')[0].trim() === 'https';
}

export function cookieOptions(secure: boolean, expiresAt?: number) {
  return {
    httpOnly: true as const,
    sameSite: 'lax' as const,
    path: '/',
    secure,
    ...(expiresAt ? { expires: new Date(expiresAt) } : {}),
  };
}
