'use server';

import QRCode from 'qrcode';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { requireSession, DENIED, guard } from '@/lib/auth/current';
import { getUser, setPassword, setTotpSecret } from '@/lib/auth/users';
import { verifyPassword, validateNewPassword } from '@/lib/auth/password';
import { startTotpSetup, confirmTotpSetup, disableTotp } from '@/lib/auth/twofa';
import { revokeAllSessions, revokeSessionById, revokeTrustedDevices } from '@/lib/auth/sessions';
import { createApiToken, revokeApiToken, setApiEnabled } from '@/lib/api/tokens';

export type TwoFaState = { mode: 'off' | 'setup' | 'on' | 'disabling'; secret?: string; qr?: string; error?: string };
export type PasswordState = { error?: string; ok?: string };

async function qrFor(uri: string) {
  return QRCode.toDataURL(uri, { margin: 1, width: 200, color: { dark: '#121110', light: '#F3EFE8' } });
}

export async function twoFactorAction(prev: TwoFaState, form: FormData): Promise<TwoFaState> {
  const { user } = await requireSession();
  const db = getDb();
  const fresh = getUser(db, user.id)!;
  switch (form.get('intent')) {
    case 'start': {
      if (fresh.totpEnabled) return { mode: 'on' };
      const { secret, uri } = startTotpSetup(db, user.id);
      return { mode: 'setup', secret, qr: await qrFor(uri) };
    }
    case 'confirm': {
      if (fresh.totpEnabled) return { mode: 'on' };
      if (!confirmTotpSetup(db, user.id, String(form.get('code') ?? ''))) return { ...prev, mode: 'setup', error: 'Неверный код — проверьте время на телефоне' };
      revalidatePath('/settings/security');
      return { mode: 'on' };
    }
    case 'cancel': {
      if (!fresh.totpEnabled) setTotpSecret(db, user.id, null);
      return { mode: fresh.totpEnabled ? 'on' : 'off' };
    }
    case 'ask-disable':
      return { mode: 'disabling' };
    case 'disable': {
      if (!(await verifyPassword(fresh.passwordHash, String(form.get('password') ?? '')))) return { mode: 'disabling', error: 'Неверный пароль' };
      disableTotp(db, user.id);
      revalidatePath('/settings/security');
      return { mode: 'off' };
    }
    default:
      return prev;
  }
}

export async function changePasswordAction(_prev: PasswordState, form: FormData): Promise<PasswordState> {
  const { user, session } = await requireSession();
  const db = getDb();
  const current = String(form.get('current') ?? '');
  const next = String(form.get('next') ?? '');
  if (!(await verifyPassword(getUser(db, user.id)!.passwordHash, current))) return { error: 'Текущий пароль неверный' };
  const err = validateNewPassword(next);
  if (err) return { error: err };
  if (next !== String(form.get('next2') ?? '')) return { error: 'Пароли не совпадают' };
  await setPassword(db, user.id, next);
  revokeAllSessions(db, user.id, session.id);
  revokeTrustedDevices(db, user.id);
  revalidatePath('/settings/security');
  return { ok: 'Пароль изменён. Остальные сеансы завершены.' };
}

export async function revokeSessionAction(form: FormData) {
  const { user, session } = await requireSession();
  const id = String(form.get('id') ?? '');
  const db = getDb();
  // Только свои сеансы и не текущий (для текущего есть «Выйти»).
  const target = db.query.sessions.findFirst({ where: (s, { eq }) => eq(s.id, id) }).sync();
  if (target && target.userId === user.id && target.id !== session.id) revokeSessionById(db, id);
  revalidatePath('/settings/security');
}

export async function logoutEverywhereAction() {
  const { user, session } = await requireSession();
  const db = getDb();
  revokeAllSessions(db, user.id, session.id);
  revokeTrustedDevices(db, user.id);
  revalidatePath('/settings/security');
}

export type ApiState = { ok?: string; error?: string; token?: string };

/** «API включён»: доступ по токену только из локальной сети. */
export async function saveApiAccessAction(_prev: ApiState, form: FormData): Promise<ApiState> {
  if (!(await guard('admin'))) return { error: DENIED };
  setApiEnabled(getDb(), form.get('enabled') === 'on');
  revalidatePath('/settings/security');
  return { ok: form.get('enabled') === 'on' ? 'API включён' : 'API выключен' };
}

/** Новый токен — показывается один раз, в базе остаётся только хэш. */
export async function createApiTokenAction(_prev: ApiState, form: FormData): Promise<ApiState> {
  if (!(await guard('admin'))) return { error: DENIED };
  const name = String(form.get('name') ?? '').trim();
  if (!name) return { error: 'Назовите токен — например, «Claude»' };
  const { token } = createApiToken(getDb(), name);
  revalidatePath('/settings/security');
  return { token };
}

export async function revokeApiTokenAction(form: FormData) {
  if (!(await guard('admin'))) return;
  const id = Number(form.get('id'));
  if (Number.isInteger(id) && id > 0) revokeApiToken(getDb(), id);
  revalidatePath('/settings/security');
}
