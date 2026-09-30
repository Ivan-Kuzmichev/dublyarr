'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/client';
import { passwordStep, codeStep } from '@/lib/auth/login';
import { revokeSession, PENDING_TTL } from '@/lib/auth/sessions';
import { COOKIE_PENDING, COOKIE_SESSION, COOKIE_TRUST, cookieOptions } from '@/lib/auth/cookies';
import { requestContext } from '@/lib/auth/current';
import { safeNext } from '@/lib/auth/safe-next';

export type FormState = { error?: string };

const str = (form: FormData, k: string) => String(form.get(k) ?? '');

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await requestContext();
  const jar = await cookies();
  const next = str(form, 'next');
  const r = await passwordStep(
    getDb(),
    { username: str(form, 'username'), password: str(form, 'password'), remember: form.get('remember') === 'on' },
    { ...ctx, trustToken: jar.get(COOKIE_TRUST)?.value ?? null },
  );
  if (r.kind === 'error') return { error: r.message };
  if (r.kind === 'need-code') {
    jar.set(COOKIE_PENDING, r.pendingToken, cookieOptions(ctx.secure, Date.now() + PENDING_TTL));
    redirect(next ? `/login/2fa?next=${encodeURIComponent(next)}` : '/login/2fa');
  }
  jar.set(COOKIE_SESSION, r.token, cookieOptions(ctx.secure, r.persistent ? r.expiresAt : undefined));
  redirect(safeNext(next));
}

export async function codeAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await requestContext();
  const jar = await cookies();
  const pending = jar.get(COOKIE_PENDING)?.value;
  if (!pending) redirect('/login');
  const r = codeStep(getDb(), { pendingToken: pending, code: str(form, 'code'), trustDevice: form.get('trust') === 'on' }, { ...ctx, trustToken: null });
  if (r.kind === 'error') return { error: r.message };
  jar.set(COOKIE_SESSION, r.token, cookieOptions(ctx.secure, r.persistent ? r.expiresAt : undefined));
  if (r.trust) jar.set(COOKIE_TRUST, r.trust.token, cookieOptions(ctx.secure, r.trust.expiresAt));
  jar.delete(COOKIE_PENDING);
  redirect(safeNext(str(form, 'next')));
}

export async function logoutAction() {
  const jar = await cookies();
  const token = jar.get(COOKIE_SESSION)?.value;
  if (token) revokeSession(getDb(), token);
  jar.delete(COOKIE_SESSION);
  redirect('/login');
}
