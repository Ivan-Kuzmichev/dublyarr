import { readFileSync } from 'node:fs';
import { getCurrentSession } from '@/lib/auth/current';
import { isAdmin } from '@/lib/auth/permissions';
import { logDir, logFiles } from '@/lib/log-read';

export const dynamic = 'force-dynamic';

/** «Скачать логи»: все файлы журнала подряд (старые первыми). */
export async function GET() {
  const s = await getCurrentSession();
  if (!s) return new Response(null, { status: 401 });
  if (!isAdmin(s.user)) return new Response(null, { status: 403 });
  const body = logFiles(logDir())
    .map((f) => {
      try {
        return readFileSync(f, 'utf8');
      } catch {
        return '';
      }
    })
    .join('');
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': 'attachment; filename="dublyarr-logs.log"' } });
}
