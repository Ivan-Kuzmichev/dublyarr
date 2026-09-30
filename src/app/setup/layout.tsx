import { AuthFrame } from '@/components/shell/AuthFrame';

export const metadata = { title: 'Первый запуск · Dublyarr' };
export const dynamic = 'force-dynamic';

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return <AuthFrame width={480}>{children}</AuthFrame>;
}
