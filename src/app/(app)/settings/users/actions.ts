'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { DENIED, guard } from '@/lib/auth/current';
import { PERMISSIONS, type Permission } from '@/lib/auth/permissions';
import { createUserByAdmin, deleteUser, resetUser2fa, resetUserPassword, updateUser, UserAdminError } from '@/lib/users-admin';

export type UserFormState = { ok?: string; error?: string };

const perms = (form: FormData) => Object.fromEntries(PERMISSIONS.map((p) => [p, form.get(`perm.${p}`) === 'on'])) as Record<Permission, boolean>;
const role = (form: FormData) => (form.get('role') === 'admin' ? 'admin' : 'user');
const idOf = (form: FormData) => Number(form.get('id'));

async function run(fn: () => Promise<string> | string): Promise<UserFormState> {
  try {
    const ok = await fn();
    revalidatePath('/settings/users');
    return { ok };
  } catch (e) {
    if (e instanceof UserAdminError) return { error: e.message };
    throw e;
  }
}

/** Одна форма учётки: создать / сохранить / выключить / сбросить пароль, 2FA / удалить (intent). */
export async function userAction(_prev: UserFormState, form: FormData): Promise<UserFormState> {
  const s = await guard('admin');
  if (!s) return { error: DENIED };
  const db = getDb();
  const id = idOf(form);
  const password = String(form.get('password') ?? '');
  switch (form.get('intent')) {
    case 'create':
      return run(async () => {
        await createUserByAdmin(db, { username: String(form.get('username') ?? ''), password, role: role(form), permissions: perms(form) });
        return 'Учётка создана';
      });
    case 'save':
      return run(() => {
        updateUser(db, s.user.id, id, { role: role(form), permissions: perms(form) });
        return 'Сохранено';
      });
    case 'disable':
    case 'enable':
      return run(() => {
        updateUser(db, s.user.id, id, { disabled: form.get('intent') === 'disable' });
        return form.get('intent') === 'disable' ? 'Учётка выключена' : 'Учётка включена';
      });
    case 'password':
      return run(async () => {
        await resetUserPassword(db, id, password);
        return 'Пароль изменён, сеансы завершены';
      });
    case '2fa':
      return run(() => {
        resetUser2fa(db, id);
        return '2FA выключена';
      });
    case 'delete':
      return run(() => {
        deleteUser(db, s.user.id, id);
        return 'Учётка удалена';
      });
    default:
      return { error: 'Неизвестное действие' };
  }
}
