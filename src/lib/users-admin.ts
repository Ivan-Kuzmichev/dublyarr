import { and, asc, eq, ne } from 'drizzle-orm';
import type { Db } from './db/client';
import { subscriptions, trustedDevices, users } from './db/schema';
import { hashPassword, validateNewPassword } from './auth/password';
import { revokeAllSessions } from './auth/sessions';
import { setTotpSecret } from './auth/users';
import { DEFAULT_PERMISSIONS, PERMISSIONS, type Permission } from './auth/permissions';

// «Настройки → Пользователи» (только админ): учётки, роли, права. Библиотека и подписки — общие.

export class UserAdminError extends Error {}

type Role = 'admin' | 'user';
type Perms = Record<Permission, boolean>;

const cleanPerms = (p: Partial<Perms> | undefined): Perms => Object.fromEntries(PERMISSIONS.map((k) => [k, p?.[k] ?? DEFAULT_PERMISSIONS[k]])) as Perms;

export function listUsers(db: Db) {
  return db
    .select()
    .from(users)
    .orderBy(asc(users.id))
    .all()
    .map((u) => ({ id: u.id, username: u.username, role: u.role, permissions: cleanPerms(u.permissions), disabled: u.disabled, totpEnabled: u.totpEnabled, lastLoginAt: u.lastLoginAt, telegram: !!u.telegramChatId }));
}

export async function createUserByAdmin(db: Db, i: { username: string; password: string; role: Role; permissions?: Partial<Perms> }) {
  const username = i.username.trim();
  if (!/^[\p{L}\p{N}._-]{2,32}$/u.test(username)) throw new UserAdminError('Логин — 2–32 буквы, цифры, «.», «_», «-»');
  const err = validateNewPassword(i.password);
  if (err) throw new UserAdminError(err);
  if (db.select().from(users).where(eq(users.username, username)).get()) throw new UserAdminError('Логин занят');
  const now = Date.now();
  return db
    .insert(users)
    .values({ username, passwordHash: await hashPassword(i.password), role: i.role, permissions: cleanPerms(i.permissions), createdAt: now, updatedAt: now })
    .returning()
    .get();
}

/** Сколько останется активных админов, если у учётки id станут такие роль и состояние. */
function adminsLeft(db: Db, id: number, role: Role, disabled: boolean) {
  const others = db
    .select()
    .from(users)
    .where(and(ne(users.id, id), eq(users.role, 'admin'), eq(users.disabled, false)))
    .all().length;
  return others + (role === 'admin' && !disabled ? 1 : 0);
}

export function updateUser(db: Db, actorId: number, id: number, p: { role?: Role; permissions?: Partial<Perms>; disabled?: boolean }) {
  const u = db.select().from(users).where(eq(users.id, id)).get();
  if (!u) throw new UserAdminError('Учётка не найдена');
  const role = p.role ?? u.role;
  const disabled = p.disabled ?? u.disabled;
  if (adminsLeft(db, id, role, disabled) === 0) throw new UserAdminError('Нельзя оставить Dublyarr без администратора');
  if (id === actorId && disabled) throw new UserAdminError('Нельзя выключить себя');
  db.update(users)
    .set({ role, disabled, ...(p.permissions ? { permissions: cleanPerms(p.permissions) } : {}), updatedAt: Date.now() })
    .where(eq(users.id, id))
    .run();
  if (disabled && !u.disabled) revokeAllSessions(db, id);
}

export function deleteUser(db: Db, actorId: number, id: number) {
  if (id === actorId) throw new UserAdminError('Нельзя удалить себя');
  const u = db.select().from(users).where(eq(users.id, id)).get();
  if (!u) throw new UserAdminError('Учётка не найдена');
  if (adminsLeft(db, id, 'user', true) === 0) throw new UserAdminError('Нельзя оставить Dublyarr без администратора');
  db.transaction((tx) => {
    // подписки общие — остаются, без автора (FK добавлен без ON DELETE)
    tx.update(subscriptions).set({ addedBy: null }).where(eq(subscriptions.addedBy, id)).run();
    tx.delete(trustedDevices).where(eq(trustedDevices.userId, id)).run();
  });
  revokeAllSessions(db, id);
  db.delete(users).where(eq(users.id, id)).run();
}

export async function resetUserPassword(db: Db, id: number, password: string) {
  const err = validateNewPassword(password);
  if (err) throw new UserAdminError(err);
  db.update(users).set({ passwordHash: await hashPassword(password), updatedAt: Date.now() }).where(eq(users.id, id)).run();
  revokeAllSessions(db, id);
}

export function resetUser2fa(db: Db, id: number) {
  setTotpSecret(db, id, null);
  db.delete(trustedDevices).where(eq(trustedDevices.userId, id)).run();
}
