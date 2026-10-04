import { Card, SectionHeader } from '@/components/ui/Card';
import { buttonClass } from '@/components/ui/Button';
import { requireAdmin } from '@/lib/auth/current';
import { getDb } from '@/lib/db/client';
import { listUsers } from '@/lib/users-admin';
import { PERMISSION_LABEL, PERMISSIONS } from '@/lib/auth/permissions';
import { UserEditor } from './UserEditor';

export const metadata = { title: 'Пользователи · Dublyarr' };
export const dynamic = 'force-dynamic';

const when = (ts: number | null) => (ts ? new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'ещё не входил');

export default async function UsersPage() {
  const { user: me } = await requireAdmin();
  const list = listUsers(getDb());
  return (
    <>
      <SectionHeader
        title="Пользователи"
        description="Библиотека и подписки общие. Администратору доступно всё, пользователю — то, что разрешено; в настройках у него только «Уведомления» и «Безопасность»."
        action={<UserEditor className={buttonClass('primary', 'md')}>+ Добавить пользователя</UserEditor>}
      />
      <div className="flex flex-col gap-3">
        {list.map((u) => (
          <Card key={u.id} className={`flex flex-wrap items-center gap-4 ${u.disabled ? 'opacity-60' : ''}`}>
            <span className="flex min-w-0 grow flex-col gap-1">
              <span className="text-[15px] font-semibold">
                {u.username}
                {u.id === me.id && <span className="ml-2 text-[13px] font-normal text-accent">это вы</span>}
              </span>
              <span className="text-[13px] text-muted">
                {u.role === 'admin' ? 'Администратор' : u.permissions && PERMISSIONS.filter((p) => u.permissions[p]).map((p) => PERMISSION_LABEL[p].title).join(', ') || 'Только просмотр'}
                {u.disabled ? ' · выключен' : ''} · 2FA {u.totpEnabled ? 'вкл' : 'выкл'} · Telegram {u.telegram ? 'привязан' : 'нет'} · вход: {when(u.lastLoginAt)}
              </span>
            </span>
            <UserEditor user={u} self={u.id === me.id} className={buttonClass('secondary', 'sm')}>
              Изменить
            </UserEditor>
          </Card>
        ))}
      </div>
    </>
  );
}
