import 'server-only';
import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { can, isAdmin, type Permission } from './permissions';
import { getDb } from '../db/client';
import { validateSession } from './sessions';
import { hasAnyUser } from './users';
import { COOKIE_SESSION, isSecureRequest } from './cookies';

export async function requestContext() {
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0].trim() || h.get('x-real-ip') || 'local';
  return { ip, userAgent: h.get('user-agent'), secure: isSecureRequest(h) };
}

export async function getCurrentSession() {
  const token = (await cookies()).get(COOKIE_SESSION)?.value;
  return token ? validateSession(getDb(), token) : null;
}

export async function requireSession() {
  const s = await getCurrentSession();
  if (s) return s;
  redirect(hasAnyUser(getDb()) ? '/login' : '/setup');
}

export const DENIED = 'Недостаточно прав';

/** Действие: сеанс с правом (или админ), иначе null — action отвечает DENIED и ничего не меняет. */
export async function guard(p: Permission | 'admin') {
  const s = await requireSession();
  return (p === 'admin' ? isAdmin(s.user) : can(s.user, p)) ? s : null;
}

/** Страница только для админа: пользователю — 404 (раздела для него нет). */
export async function requireAdmin() {
  const s = await requireSession();
  if (!isAdmin(s.user)) notFound();
  return s;
}
