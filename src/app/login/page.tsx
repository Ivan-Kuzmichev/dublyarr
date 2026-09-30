import { redirect } from 'next/navigation';
import { AuthFrame, AuthHeading } from '@/components/shell/AuthFrame';
import { getDb } from '@/lib/db/client';
import { hasAnyUser } from '@/lib/auth/users';
import { getCurrentSession } from '@/lib/auth/current';
import { LoginForm } from './LoginForm';

export const metadata = { title: 'Вход · Dublyarr' };
export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (!hasAnyUser(getDb())) redirect('/setup');
  if (await getCurrentSession()) redirect('/');
  const { next = '' } = await searchParams;
  return (
    <AuthFrame>
      <AuthHeading title="Вход" subtitle="Твой Dublyarr на NAS" />
      <LoginForm next={next} />
      <span className="text-[13px] leading-normal text-faint">
        Забыл пароль? Сбросить можно из контейнера: <span className="font-mono text-xs text-text-3">dublyarr reset-password</span>
      </span>
    </AuthFrame>
  );
}
