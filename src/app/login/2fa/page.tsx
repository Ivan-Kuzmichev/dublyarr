import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthFrame, AuthHeading } from '@/components/shell/AuthFrame';
import { Icon, ICONS } from '@/components/ui/Icon';
import { getDb } from '@/lib/db/client';
import { getPendingUsername } from '@/lib/auth/sessions';
import { COOKIE_PENDING } from '@/lib/auth/cookies';
import { CodeForm } from './CodeForm';

export const metadata = { title: 'Код подтверждения · Dublyarr' };
export const dynamic = 'force-dynamic';

export default async function CodePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const pending = (await cookies()).get(COOKIE_PENDING)?.value;
  const username = pending ? getPendingUsername(getDb(), pending) : null;
  if (!username) redirect('/login');
  const { next = '' } = await searchParams;
  return (
    <AuthFrame>
      <Link href="/login" className="flex min-h-11 items-center gap-1 self-start text-sm text-muted no-underline hover:text-text-2">
        <Icon d={ICONS.back} size={16} strokeWidth={2} />
        {username}
      </Link>
      <AuthHeading title="Код подтверждения" subtitle="Открой приложение-аутентификатор и введи 6 цифр для Dublyarr." />
      <CodeForm next={next} />
    </AuthFrame>
  );
}
