import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
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
