'use client';

import { useActionState, useCallback, useEffect, useId, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Field, PasswordField } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { PERMISSION_LABEL, PERMISSIONS, type Permission } from '@/lib/auth/permissions';
import { userAction, type UserFormState } from './actions';

export type UserRow = { id: number; username: string; role: 'admin' | 'user'; permissions: Record<Permission, boolean>; disabled: boolean; totpEnabled: boolean };

function Body({ user, self, onClose }: { user?: UserRow; self: boolean; onClose: () => void }) {
  const titleId = useId();
  const [state, action, pending] = useActionState<UserFormState, FormData>(userAction, {});
  const [role, setRole] = useState<'admin' | 'user'>(user?.role ?? 'user');
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (state.ok && (!user || state.ok === 'Учётка удалена' || state.ok === 'Сохранено' || state.ok === 'Учётка создана')) onClose();
  }, [state, user, onClose]);
  return (
    <Modal open onClose={onClose} labelledBy={titleId} width={560}>
      <form action={action} className="flex flex-col gap-5 overflow-y-auto p-5 md:p-7">
        <h2 id={titleId} className="m-0 font-display text-[22px] font-semibold">
          {user ? user.username : 'Новый пользователь'}
        </h2>
        {user && <input type="hidden" name="id" value={user.id} />}
        {!user && <Field label="Логин" name="username" required autoComplete="off" />}
        <PasswordField
          label={user ? 'Новый пароль' : 'Временный пароль'}
          name="password"
          autoComplete="new-password"
          hint={user ? 'Для «Сменить пароль»: сеансы пользователя завершатся' : 'Не короче 10 символов; пользователь сменит его в «Безопасности»'}
        />
        <div className="flex flex-col gap-2">
          <span className="text-sm text-muted">Роль</span>
          <Segmented<'admin' | 'user'>
            name="role"
            aria-label="Роль"
            defaultValue={role}
            onChange={setRole}
            options={[
              { value: 'user', label: 'Пользователь' },
              { value: 'admin', label: 'Администратор' },
            ]}
          />
        </div>
        {role === 'user' && (
          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted">Что разрешено</span>
            {PERMISSIONS.map((p) => (
              <Checkbox key={p} name={`perm.${p}`} label={PERMISSION_LABEL[p].title} description={PERMISSION_LABEL[p].sub} defaultChecked={user ? user.permissions[p] : p === 'subscribe' || p === 'search' || p === 'answer'} />
            ))}
          </div>
        )}
        {state.error && (
          <p role="alert" className="m-0 text-sm text-danger">
            {state.error}
          </p>
        )}
        {state.ok && <p className="m-0 text-sm text-progress">{state.ok}</p>}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" name="intent" value={user ? 'save' : 'create'} disabled={pending}>
            {user ? 'Сохранить' : 'Создать'}
          </Button>
          {user && (
            <>
              <Button type="submit" name="intent" value="password" variant="secondary" disabled={pending}>
                Сменить пароль
              </Button>
              {user.totpEnabled && (
                <Button type="submit" name="intent" value="2fa" variant="secondary" disabled={pending}>
                  Сбросить 2FA
                </Button>
              )}
              {!self && (
                <Button type="submit" name="intent" value={user.disabled ? 'enable' : 'disable'} variant="secondary" disabled={pending}>
                  {user.disabled ? 'Включить' : 'Выключить'}
                </Button>
              )}
              {!self &&
                (confirmDelete ? (
                  <Button type="submit" name="intent" value="delete" variant="destructive" disabled={pending}>
                    Точно удалить
                  </Button>
                ) : (
                  <Button type="button" variant="destructive" onClick={() => setConfirmDelete(true)}>
                    Удалить
                  </Button>
                ))}
            </>
          )}
          <span className="grow" />
          <Button type="button" variant="ghost" onClick={onClose}>
            Закрыть
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function UserEditor({ user, self = false, className, children }: { user?: UserRow; self?: boolean; className?: string; children: React.ReactNode }) {
  const [session, setSession] = useState(0);
  const close = useCallback(() => setSession(0), []);
  return (
    <>
      <button type="button" className={className} onClick={() => setSession((n) => n + 1)}>
        {children}
      </button>
      {session > 0 && <Body key={session} user={user} self={self} onClose={close} />}
    </>
  );
}
