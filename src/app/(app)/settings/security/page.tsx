import { SectionHeader, Card, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Table } from '@/components/ui/Table';
import { requireSession } from '@/lib/auth/current';
import { getDb } from '@/lib/db/client';
import { listSessions, type Session } from '@/lib/auth/sessions';
import { describeUserAgent } from '@/lib/auth/describe-ua';
import { logoutAction } from '@/app/login/actions';
import { TwoFactorCard } from './TwoFactorCard';
import { PasswordCard } from './PasswordCard';
import { ApiCard } from './ApiCard';
import { isAdmin } from '@/lib/auth/permissions';
import { getApiEnabled, listApiTokens } from '@/lib/api/tokens';
import { revokeSessionAction, logoutEverywhereAction } from './actions';

export const metadata = { title: 'Безопасность · Dublyarr' };

const rtf = new Intl.RelativeTimeFormat('ru', { numeric: 'auto' });
function ago(ts: number, now: number) {
  const min = Math.round((ts - now) / 60_000);
  if (min > -1) return 'сейчас';
  if (min > -60) return rtf.format(min, 'minute');
  const h = Math.round(min / 60);
  if (h > -24) return rtf.format(h, 'hour');
  return rtf.format(Math.round(h / 24), 'day');
}

function loadSessions(userId: number) {
  const now = Date.now();
  return { now, sessions: listSessions(getDb(), userId, now) };
}

export default async function SecurityPage() {
  const { user, session: current } = await requireSession();
  const { now, sessions } = loadSessions(user.id);
  const date = (ts: number) => new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  const tokens = listApiTokens(getDb()).map((t) => ({
    id: t.id,
    name: t.name,
    prefix: t.prefix,
    created: date(t.createdAt),
    used: t.lastUsedAt ? `использован ${ago(t.lastUsedAt, now)}${t.lastIp ? ` · ${t.lastIp}` : ''}` : 'не использовался',
  }));
  return (
    <>
      <SectionHeader title="Безопасность" description={`Вход для ${user.username}: пароль и код из приложения.`} />
      <TwoFactorCard enabled={user.totpEnabled} />
      <PasswordCard />
      {isAdmin(user) && <ApiCard enabled={getApiEnabled(getDb())} tokens={tokens} />}
      <Card className="flex flex-col gap-4">
        <CardTitle note={`${sessions.length}`}>Активные сеансы</CardTitle>
        <Table<Session>
          rowKey={(s) => s.id}
          rows={sessions}
          columns={[
            { key: 'device', label: 'Устройство', render: (s) => <span className="font-medium">{describeUserAgent(s.userAgent)}</span> },
            { key: 'ip', label: 'IP', width: '140px', render: (s) => <span className="font-mono text-[13px] text-text-3">{s.ip ?? '—'}</span> },
            { key: 'seen', label: 'Активность', width: '140px', render: (s) => <span className="text-[13px] text-text-3">{ago(s.lastSeenAt, now)}</span> },
            {
              key: 'action',
              label: '',
              width: '150px',
              render: (s) =>
                s.id === current.id ? (
                  <span className="text-[13px] text-accent">Это устройство</span>
                ) : (
                  <form action={revokeSessionAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <Button type="submit" variant="secondary" size="sm">
                      Завершить
                    </Button>
                  </form>
                ),
            },
          ]}
        />
        <div className="flex flex-wrap items-center gap-3">
          <form action={logoutEverywhereAction}>
            <Button type="submit" variant="destructive">
              Выйти везде, кроме этого устройства
            </Button>
          </form>
          <form action={logoutAction}>
            <Button type="submit" variant="secondary">
              Выйти
            </Button>
          </form>
        </div>
        <span className="text-[13px] text-faint">Доверенные устройства тоже снова будут спрашивать код.</span>
      </Card>
    </>
  );
}
